import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";

const rootDir = resolve(import.meta.dirname, "..");

function readArgument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const pageUid = readArgument("--page-uid");
if (!pageUid) throw new Error("Missing --page-uid");

const configPath = resolve(rootDir, readArgument("--config", "config.local.json"));
const config = JSON.parse(await readFile(configPath, "utf8"));
const authPath = resolve(rootDir, config.authStatePath ?? ".auth/roam.json");
await access(authPath);

const candidate = config.variants.find((variant) => variant.type === "disable-style");
if (!candidate?.styleTextIncludes || candidate.expectedMatches !== 1) {
  throw new Error("Page style inspection requires one fingerprinted disable-style candidate");
}

const graphUrl = `https://roamresearch.com/#/app/${encodeURIComponent(config.graphSlug)}/page/${encodeURIComponent(pageUid)}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: authPath });
const page = await context.newPage();

try {
  await page.goto(graphUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (uid) => location.hash.includes(`/page/${uid}`)
      && Boolean(window.roamAlphaAPI)
      && Boolean(document.querySelector(".roam-article")),
    pageUid,
    { timeout: 60_000 },
  );
  if ((config.runtimeReadyGlobals ?? []).length > 0) {
    await page.waitForFunction(
      (globals) => globals.every((key) => Boolean(window[key])),
      config.runtimeReadyGlobals,
      { timeout: 60_000 },
    );
  }
  await page.waitForTimeout(config.runtimeSettleMs ?? 0);

  const result = await page.evaluate(({ marker, rounds }) => {
    const article = document.querySelector(".roam-article");
    const matches = [...document.querySelectorAll("style")]
      .filter((style) => (style.textContent ?? "").includes(marker));
    if (matches.length !== 1) {
      throw new Error(`Custom CSS style matched ${matches.length} nodes; expected 1`);
    }
    const [style] = matches;
    const originalMedia = style.getAttribute("media");
    const elements = [...article.querySelectorAll("*")];
    const samples = [];

    const forceStyleResolution = (enabled, index) => {
      if (enabled) {
        if (originalMedia === null) style.removeAttribute("media");
        else style.setAttribute("media", originalMedia);
      } else {
        style.setAttribute("media", "not all");
      }
      const startedAt = performance.now();
      let checksum = 0;
      for (const element of elements) {
        const computed = getComputedStyle(element);
        checksum += computed.display.length;
        checksum += computed.fontFamily.length;
        checksum += computed.color.length;
      }
      samples.push({
        enabled,
        index,
        durationMs: performance.now() - startedAt,
        checksum,
      });
    };

    try {
      for (let round = 0; round < rounds; round += 1) {
        const sequence = round % 2 === 0
          ? [true, false, false, true]
          : [false, true, true, false];
        sequence.forEach((enabled, index) => {
          forceStyleResolution(enabled, round * sequence.length + index);
        });
      }
    } finally {
      if (originalMedia === null) style.removeAttribute("media");
      else style.setAttribute("media", originalMedia);
    }

    const summarize = (enabled) => {
      const values = samples
        .filter((sample) => sample.enabled === enabled)
        .map((sample) => sample.durationMs)
        .sort((left, right) => left - right);
      const middle = Math.floor(values.length / 2);
      const medianMs = values.length % 2 === 0
        ? (values[middle - 1] + values[middle]) / 2
        : values[middle];
      return {
        count: values.length,
        medianMs,
        minMs: values[0],
        maxMs: values.at(-1),
      };
    };

    return {
      pageTitle: document.querySelector("h1.rm-title-display")?.textContent?.trim() ?? null,
      articleElementCount: elements.length,
      articleBlockCount: article.querySelectorAll("[data-block-uid]").length,
      enabled: summarize(true),
      disabled: summarize(false),
      samples,
    };
  }, {
    marker: candidate.styleTextIncludes,
    rounds: 5,
  });

  process.stdout.write(`${JSON.stringify({ pageUid, ...result }, null, 2)}\n`);
} finally {
  await context.close();
  await browser.close();
}
