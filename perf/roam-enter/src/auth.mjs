import { chmod, mkdir, readFile } from "node:fs/promises";
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

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
const prompt = createInterface({ input, output });

try {
  await page.goto(graphUrl, { waitUntil: "domcontentloaded" });
  output.write("\n请在这个独立 Playwright 窗口中手动完成 Roam 登录。\n");
  output.write("确认已经打开 CSS Performance Lab 页面后，回到终端按 Enter。\n\n");
  await prompt.question("");

  await page.waitForFunction(
    () => Boolean(document.querySelector(".roam-app") && window.roamAlphaAPI),
    undefined,
    { timeout: 30_000 },
  );

  await context.storageState({ path: authPath, indexedDB: true });
  await chmod(authPath, 0o600);
  output.write(`认证状态已保存到 ${authPath}\n`);
} finally {
  prompt.close();
  await context.close();
  await browser.close();
}
