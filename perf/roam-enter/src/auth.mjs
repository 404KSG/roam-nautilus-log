import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { chromium } from "playwright";

import { validateConfig } from "./core.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const configPath = resolve(rootDir, process.env.ROAM_PERF_CONFIG ?? "config.local.json");
const config = validateConfig(JSON.parse(await readFile(configPath, "utf8")));
const authPath = resolve(rootDir, config.authStatePath ?? ".auth/roam.json");
const graphUrl = `https://roamresearch.com/#/app/${encodeURIComponent(config.graphSlug)}/page/${encodeURIComponent(config.pageUid)}`;

await mkdir(dirname(authPath), { recursive: true });

async function saveCompactAuthState(context) {
  const state = await context.storageState({ indexedDB: true });
  const compact = {
    cookies: state.cookies ?? [],
    origins: (state.origins ?? []).map((origin) => ({
      ...origin,
      indexedDB: (origin.indexedDB ?? [])
        .filter((database) => database.name.startsWith("firebase")),
    })),
  };
  await writeFile(authPath, JSON.stringify(compact), { mode: 0o600 });
  await chmod(authPath, 0o600);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
const prompt = createInterface({ input, output });

try {
  await page.goto(graphUrl, { waitUntil: "domcontentloaded" });
  output.write("\n请在这个独立 Playwright 窗口中手动完成 Roam 登录。\n");
  output.write("确认已经打开 CSS Performance Lab 页面后，回到终端按 Enter。\n\n");
  await prompt.question("");

  // Save the authenticated browser state before route validation. If Roam's
  // page structure changes, the user should not have to log in again merely
  // because the lab-page assertion needs maintenance.
  await saveCompactAuthState(context);

  await page.goto(graphUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (targetUid) => Boolean(
      window.roamAlphaAPI
      && (document.getElementById(`block-input-${targetUid}`)
        || document.querySelector(`[data-block-uid="${CSS.escape(targetUid)}"]`)),
    ),
    config.targetUid,
    { timeout: 60_000 },
  );

  await saveCompactAuthState(context);
  output.write(`认证状态已保存到 ${authPath}\n`);
} finally {
  prompt.close();
  await context.close();
  await browser.close();
}
