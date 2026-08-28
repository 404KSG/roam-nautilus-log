import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { chromium } from "playwright";

import {
  buildAbbaSchedule,
  summarizeSamples,
  validateConfig,
} from "./core.mjs";

const rootDir = resolve(import.meta.dirname, "..");

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const mode = readArgument("--mode", "smoke");
const configPath = resolve(rootDir, readArgument(
  "--config",
  process.env.ROAM_PERF_CONFIG ?? "config.local.json",
));
const config = validateConfig(JSON.parse(await readFile(configPath, "utf8")));
const authPath = resolve(rootDir, config.authStatePath ?? ".auth/roam.json");
const resultsDir = resolve(rootDir, config.resultsDir ?? "results");
const sampleTimeoutMs = config.sampleTimeoutMs ?? 8000;
const graphUrl = `https://roamresearch.com/#/app/${encodeURIComponent(config.graphSlug)}/page/${encodeURIComponent(config.pageUid)}`;

if (!new Set(["inspect", "smoke", "benchmark"]).has(mode)) {
  throw new Error(`Unsupported mode: ${mode}`);
}

try {
  await access(authPath);
} catch {
  throw new Error(
    `Missing local Roam authentication state at ${authPath}. Run \"npm run perf:enter:auth\" from the repository root once.`,
  );
}

if (mode === "benchmark") {
  const candidate = config.variants.find((variant) => variant.type === "disable-style");
  if (
    candidate.expectedMatches !== 1
    || !candidate.expectedTextHash
    || !Number.isInteger(candidate.expectedRuleCount)
  ) {
    throw new Error(
      "A formal benchmark requires one exact candidate style plus expectedTextHash and expectedRuleCount from inspect mode.",
    );
  }
}

function createTimestamp() {
  return new Date().toISOString().replaceAll(":", "-");
}

async function restoreStyles(page) {
  return page.evaluate(() => {
    let restored = 0;
    for (const style of document.querySelectorAll("style[data-roam-perf-original-media]")) {
      const original = style.dataset.roamPerfOriginalMedia;
      if (original === "__NONE__") {
        style.removeAttribute("media");
      } else {
        style.setAttribute("media", original);
      }
      delete style.dataset.roamPerfOriginalMedia;
      restored += 1;
    }
    return restored;
  });
}

async function applyVariant(page, variant) {
  await restoreStyles(page);

  if (variant.type === "baseline") {
    return { id: variant.id, matchedStyles: 0 };
  }

  const result = await page.evaluate(({
    marker,
    expectedMatches,
    expectedTextHash,
    expectedRuleCount,
  }) => {
    const hashText = (text) => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    };
    const matches = [...document.querySelectorAll("style")]
      .filter((style) => (style.textContent ?? "").includes(marker));

    if (matches.length !== expectedMatches) {
      throw new Error(
        `CSS marker matched ${matches.length} style nodes; expected ${expectedMatches}`,
      );
    }

    if (expectedTextHash || Number.isInteger(expectedRuleCount)) {
      const style = matches[0];
      const actualHash = hashText(style.textContent ?? "");
      let actualRuleCount = null;
      try {
        actualRuleCount = style.sheet?.cssRules?.length ?? null;
      } catch {
        actualRuleCount = null;
      }
      if (expectedTextHash && actualHash !== expectedTextHash) {
        throw new Error(
          `CSS style hash changed: ${actualHash}; expected ${expectedTextHash}. Run inspect again.`,
        );
      }
      if (Number.isInteger(expectedRuleCount) && actualRuleCount !== expectedRuleCount) {
        throw new Error(
          `CSS rule count changed: ${actualRuleCount}; expected ${expectedRuleCount}. Run inspect again.`,
        );
      }
    }

    for (const style of matches) {
      style.dataset.roamPerfOriginalMedia = style.getAttribute("media") ?? "__NONE__";
      style.setAttribute("media", "not all");
    }

    return { matchedStyles: matches.length };
  }, {
    marker: variant.styleTextIncludes,
    expectedMatches: variant.expectedMatches,
    expectedTextHash: variant.expectedTextHash,
    expectedRuleCount: variant.expectedRuleCount,
  });

  return { id: variant.id, ...result };
}

async function waitForLab(page) {
  await page.goto(graphUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    ({ pageUid, targetUid }) => {
      const routeMatches = location.hash.includes(`/page/${pageUid}`);
      return Boolean(
        routeMatches
        && document.querySelector(".roam-app")
        && window.roamAlphaAPI
        && (document.getElementById(`block-input-${targetUid}`)
          || document.querySelector(`[data-uid="${CSS.escape(targetUid)}"]`)),
      );
    },
    { pageUid: config.pageUid, targetUid: config.targetUid },
    { timeout: 30_000 },
  );
}

async function focusTarget(page) {
  const target = page.locator(`#block-input-${config.targetUid}`);
  if (await target.count() !== 1) {
    throw new Error(`Expected one target textarea for ${config.targetUid}`);
  }
  await target.click();
  await page.waitForFunction(
    (targetUid) => document.activeElement?.id === `block-input-${targetUid}`,
    config.targetUid,
  );
}

async function installMeasurementProbe(page) {
  await page.evaluate(({ targetUid, timeoutMs }) => {
    const root = document.querySelector(".roam-article");
    if (!root) throw new Error("Missing .roam-article root");

    const uniqueUids = () => new Set(
      [...root.querySelectorAll("[data-uid]")]
        .map((element) => element.getAttribute("data-uid"))
        .filter(Boolean),
    );

    const initialUids = uniqueUids();
    const initialCount = initialUids.size;
    window.__roamEnterPerfInitialUids = [...initialUids];
    let keydownAt = null;
    let keydownTrusted = false;
    let eventTiming = null;
    let observer = null;
    let settled = false;

    try {
      observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const candidate = entries.find((entry) => entry.name === "keydown");
        if (candidate) {
          eventTiming = {
            durationMs: candidate.duration,
            inputDelayMs: candidate.processingStart - candidate.startTime,
            processingMs: candidate.processingEnd - candidate.processingStart,
            presentationMs: Math.max(0, candidate.duration - (
              candidate.processingEnd - candidate.startTime
            )),
          };
        }
      });
      observer.observe({ type: "event", buffered: false, durationThreshold: 0 });
    } catch {
      observer = null;
    }

    const completion = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        observer?.disconnect();
        reject(new Error(`Enter milestone timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        observer?.disconnect();
        resolve(value);
      };

      const poll = () => {
        if (keydownAt === null) {
          requestAnimationFrame(poll);
          return;
        }

        const active = document.activeElement;
        const activeUid = active?.id?.startsWith("block-input-")
          ? active.id.slice("block-input-".length)
          : active?.closest?.("[data-uid]")?.getAttribute("data-uid");

        if (activeUid && activeUid !== targetUid && !initialUids.has(activeUid)) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const afterUids = uniqueUids();
            finish({
              appDurationMs: performance.now() - keydownAt,
              keydownTrusted,
              oldUid: targetUid,
              newUid: activeUid,
              beforeCount: initialCount,
              afterCreateCount: afterUids.size,
              eventTiming,
            });
          }));
          return;
        }

        requestAnimationFrame(poll);
      };

      addEventListener("keydown", (event) => {
        if (event.key === "Enter" && keydownAt === null) {
          keydownTrusted = event.isTrusted;
          keydownAt = performance.now();
        }
      }, { capture: true, once: true });

      requestAnimationFrame(poll);
    });

    window.__roamEnterPerfCompletion = completion;
  }, { targetUid: config.targetUid, timeoutMs: sampleTimeoutMs });
}

async function cleanupSample(page, newUid, expectedCount) {
  await page.evaluate(async (uid) => {
    await window.roamAlphaAPI.deleteBlock({ block: { uid } });
  }, newUid);

  await page.waitForFunction(({ uid, expected }) => {
    const graphBlock = window.roamAlphaAPI.pull("[:block/uid]", [":block/uid", uid]);
    const root = document.querySelector(".roam-article");
    const count = new Set(
      [...(root?.querySelectorAll("[data-uid]") ?? [])]
        .map((element) => element.getAttribute("data-uid"))
        .filter(Boolean),
    ).size;
    return !graphBlock && count === expected;
  }, { uid: newUid, expected: expectedCount }, { timeout: sampleTimeoutMs });

  return page.evaluate(({ uid, expected }) => {
    const graphBlock = window.roamAlphaAPI.pull("[:block/uid]", [":block/uid", uid]);
    const root = document.querySelector(".roam-article");
    const afterCleanupCount = new Set(
      [...(root?.querySelectorAll("[data-uid]") ?? [])]
        .map((element) => element.getAttribute("data-uid"))
        .filter(Boolean),
    ).size;
    return {
      cleanupVerified: !graphBlock && afterCleanupCount === expected,
      afterCleanupCount,
    };
  }, { uid: newUid, expected: expectedCount });
}

async function recoverCreatedBlock(page) {
  return page.evaluate((targetUid) => {
    const root = document.querySelector(".roam-article");
    const initialUids = new Set(window.__roamEnterPerfInitialUids ?? []);
    const currentUids = new Set(
      [...(root?.querySelectorAll("[data-uid]") ?? [])]
        .map((element) => element.getAttribute("data-uid"))
        .filter(Boolean),
    );
    const createdUids = [...currentUids]
      .filter((uid) => uid !== targetUid && !initialUids.has(uid));
    const active = document.activeElement;
    const activeUid = active?.id?.startsWith("block-input-")
      ? active.id.slice("block-input-".length)
      : active?.closest?.("[data-uid]")?.getAttribute("data-uid");

    if (activeUid && createdUids.includes(activeUid)) {
      return { newUid: activeUid, beforeCount: initialUids.size };
    }
    if (createdUids.length === 1) {
      return { newUid: createdUids[0], beforeCount: initialUids.size };
    }
    return { newUid: null, beforeCount: initialUids.size };
  }, config.targetUid);
}

async function takeSample(page, variant, phase, index) {
  let measurement = null;
  let actionError = null;

  try {
    await applyVariant(page, variant);
    await focusTarget(page);
    await installMeasurementProbe(page);
    await page.keyboard.press("Enter");
    measurement = await page.evaluate(() => window.__roamEnterPerfCompletion);
  } catch (error) {
    actionError = error;
  }

  const recovered = measurement ?? await recoverCreatedBlock(page);
  let cleanup = null;
  let cleanupError = null;
  if (recovered.newUid) {
    try {
      cleanup = await cleanupSample(page, recovered.newUid, recovered.beforeCount);
    } catch (error) {
      cleanupError = error;
    }
  }

  if (cleanupError || (recovered.newUid && cleanup?.cleanupVerified !== true)) {
    const errors = [actionError, cleanupError].filter(Boolean);
    throw new AggregateError(
      errors,
      `Cleanup failed; temporary Roam block may remain: ${recovered.newUid}`,
    );
  }
  if (actionError) {
    throw actionError;
  }
  if (!measurement.keydownTrusted) {
    throw new Error("Measurement did not observe a trusted Enter keydown");
  }
  if (measurement.afterCreateCount !== measurement.beforeCount + 1) {
    throw new Error(
      `Unexpected block count after Enter: ${measurement.beforeCount} -> ${measurement.afterCreateCount}`,
    );
  }

  return {
    variant: variant.id,
    phase,
    index,
    ...measurement,
    ...cleanup,
  };
}

async function inspectStyles(page) {
  return page.evaluate(() => {
    const hashText = (text) => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    };

    return [...document.querySelectorAll("style")].map((style, index) => {
      const text = style.textContent ?? "";
      const comments = [...text.matchAll(/\/\*([^*]|\*(?!\/))*\*\//g)]
        .slice(0, 3)
        .map((match) => match[0].replace(/\s+/g, " ").slice(0, 120));
      let ruleCount = null;
      try {
        ruleCount = style.sheet?.cssRules?.length ?? null;
      } catch {
        ruleCount = null;
      }
      return {
        index,
        id: style.id || null,
        media: style.getAttribute("media"),
        dataAttributes: Object.fromEntries(
          [...style.attributes]
            .filter((attribute) => attribute.name.startsWith("data-"))
            .map((attribute) => [attribute.name, attribute.value]),
        ),
        ruleCount,
        textLength: text.length,
        textHash: hashText(text),
        comments,
      };
    });
  });
}

async function writeResult(kind, result) {
  await mkdir(resultsDir, { recursive: true });
  const path = resolve(resultsDir, `${createTimestamp()}-${kind}.json`);
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return path;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: authPath });
const page = await context.newPage();
let outputPath;

try {
  await waitForLab(page);

  if (mode === "inspect") {
    const inventory = await inspectStyles(page);
    outputPath = await writeResult("style-inventory", {
      generatedAt: new Date().toISOString(),
      graphSlug: config.graphSlug,
      pageUid: config.pageUid,
      targetUid: config.targetUid,
      styles: inventory,
    });
  } else {
    const baseline = config.variants.find((variant) => variant.type === "baseline");
    const candidate = config.variants.find((variant) => variant.type !== "baseline");
    const samples = [];

    if (mode === "smoke") {
      samples.push(await takeSample(page, baseline, "smoke", 0));
    } else {
      for (let index = 0; index < config.warmups; index += 1) {
        const variant = index % 2 === 0 ? baseline : candidate;
        await takeSample(page, variant, "warmup", index);
      }

      const variants = new Map(config.variants.map((variant) => [variant.id, variant]));
      const schedule = buildAbbaSchedule(baseline.id, candidate.id, config.rounds);
      for (let index = 0; index < schedule.length; index += 1) {
        samples.push(await takeSample(page, variants.get(schedule[index]), "measure", index));
      }
    }

    const result = {
      generatedAt: new Date().toISOString(),
      mode,
      graphSlug: config.graphSlug,
      pageUid: config.pageUid,
      targetUid: config.targetUid,
      configFile: basename(configPath),
      summary: summarizeSamples(samples),
      samples,
    };
    outputPath = await writeResult(mode, result);
    process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  }
} finally {
  try {
    await restoreStyles(page);
  } finally {
    await context.close();
    await browser.close();
  }
}

process.stdout.write(`Result: ${outputPath}\n`);
