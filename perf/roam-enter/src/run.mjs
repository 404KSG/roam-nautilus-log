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
const runtimeDestroyGlobal = readArgument("--destroy-global", null);
const runtimeRemoveKeydownListener = readArgument(
  "--remove-keydown-listener",
  null,
);
const domStressCopies = Number(readArgument("--dom-stress-copies", "0"));
const smokeSamples = Number(readArgument("--smoke-samples", "1"));
const blockedResourceSubstring = readArgument(
  "--block-resource-substring",
  null,
);
const configPath = resolve(rootDir, readArgument(
  "--config",
  process.env.ROAM_PERF_CONFIG ?? "config.local.json",
));
const config = validateConfig(JSON.parse(await readFile(configPath, "utf8")));
const authPath = resolve(rootDir, config.authStatePath ?? ".auth/roam.json");
const resultsDir = resolve(rootDir, config.resultsDir ?? "results");
const sampleTimeoutMs = config.sampleTimeoutMs ?? 8000;
const runtimeReadyGlobals = config.runtimeReadyGlobals ?? [];
const runtimeSettleMs = config.runtimeSettleMs ?? 0;
const graphUrl = `https://roamresearch.com/#/app/${encodeURIComponent(config.graphSlug)}/page/${encodeURIComponent(config.pageUid)}`;

if (!new Set(["inspect", "smoke", "benchmark"]).has(mode)) {
  throw new Error(`Unsupported mode: ${mode}`);
}
if (!Number.isInteger(smokeSamples) || smokeSamples < 1) {
  throw new Error(`--smoke-samples must be a positive integer; received ${smokeSamples}`);
}

try {
  await access(authPath);
} catch {
  throw new Error(
    `Missing local Roam authentication state at ${authPath}. Run \"npm run perf:enter:auth\" from the repository root once.`,
  );
}

if (mode === "benchmark") {
  const candidate = config.variants.find((variant) => variant.type !== "baseline");
  const safeDisable = candidate.type === "disable-style"
    && candidate.expectedMatches === 1
    && candidate.expectedTextHash
    && Number.isInteger(candidate.expectedRuleCount);
  const safeInjection = candidate.type === "inject-roam-css-block"
    && candidate.sourceBlockUid
    && candidate.expectedSourceHash;
  const safeExclusion = candidate.type === "exclude-roam-css-block"
    && candidate.sourceBlockUid
    && candidate.expectedSourceHash
    && candidate.expectedMatches === 1;
  if (!safeDisable && !safeInjection && !safeExclusion) {
    throw new Error(
      "A formal benchmark requires an exact fingerprint for its CSS candidate.",
    );
  }
}

function createTimestamp() {
  return new Date().toISOString().replaceAll(":", "-");
}

async function restoreStyles(page) {
  return page.evaluate(() => {
    let restored = 0;
    for (const style of document.querySelectorAll("style[data-roam-perf-injected]")) {
      style.remove();
      restored += 1;
    }
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

  if (variant.type === "inject-roam-css-block") {
    const result = await page.evaluate(({
      sourceBlockUid,
      expectedSourceHash,
      marker,
    }) => {
      const hashText = (text) => {
        let hash = 0x811c9dc5;
        for (let index = 0; index < text.length; index += 1) {
          hash ^= text.charCodeAt(index);
          hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
      };
      const pulled = window.roamAlphaAPI.pull(
        "[:block/string]",
        [":block/uid", sourceBlockUid],
      );
      const source = pulled?.[":block/string"] ?? "";
      const sourceHash = hashText(source);
      if (!source || sourceHash !== expectedSourceHash) {
        throw new Error(
          `CSS source block changed: ${sourceHash}; expected ${expectedSourceHash}`,
        );
      }
      const css = source
        .replace(/^```[^\n]*\n?/, "")
        .replace(/\n?```\s*$/, "");
      if (!css.includes(marker)) {
        throw new Error(`CSS source block no longer contains marker: ${marker}`);
      }
      const style = document.createElement("style");
      style.dataset.roamPerfInjected = sourceBlockUid;
      style.textContent = css;
      document.head.append(style);
      return {
        sourceBlockUid,
        sourceHash,
        injectedLength: css.length,
      };
    }, {
      sourceBlockUid: variant.sourceBlockUid,
      expectedSourceHash: variant.expectedSourceHash,
      marker: variant.styleTextIncludes,
    });
    return { id: variant.id, ...result };
  }

  if (variant.type === "exclude-roam-css-block") {
    const result = await page.evaluate(({
      sourceBlockUid,
      expectedSourceHash,
      marker,
      expectedMatches,
    }) => {
      const hashText = (text) => {
        let hash = 0x811c9dc5;
        for (let index = 0; index < text.length; index += 1) {
          hash ^= text.charCodeAt(index);
          hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
      };
      const pulled = window.roamAlphaAPI.pull(
        "[:block/string]",
        [":block/uid", sourceBlockUid],
      );
      const source = pulled?.[":block/string"] ?? "";
      const sourceHash = hashText(source);
      if (!source || sourceHash !== expectedSourceHash) {
        throw new Error(
          `CSS source block changed: ${sourceHash}; expected ${expectedSourceHash}`,
        );
      }
      const css = source
        .replace(/^```[^\n]*\n?/, "")
        .replace(/\n?```\s*$/, "");
      if (!css.includes(marker)) {
        throw new Error(`CSS source block no longer contains marker: ${marker}`);
      }

      const matches = [...document.querySelectorAll("style")]
        .filter((style) => (style.textContent ?? "").includes(css));
      if (matches.length !== expectedMatches) {
        throw new Error(
          `Exact CSS block matched ${matches.length} style nodes; expected ${expectedMatches}`,
        );
      }

      const original = matches[0];
      const originalText = original.textContent ?? "";
      const firstIndex = originalText.indexOf(css);
      const secondIndex = originalText.indexOf(css, firstIndex + css.length);
      if (firstIndex < 0 || secondIndex >= 0) {
        throw new Error("CSS block must occur exactly once inside the matched style");
      }

      const replacement = document.createElement("style");
      replacement.dataset.roamPerfInjected = `without:${sourceBlockUid}`;
      replacement.textContent = `${originalText.slice(0, firstIndex)}${originalText.slice(firstIndex + css.length)}`;
      original.insertAdjacentElement("afterend", replacement);
      original.dataset.roamPerfOriginalMedia = original.getAttribute("media") ?? "__NONE__";
      original.setAttribute("media", "not all");

      return {
        sourceBlockUid,
        sourceHash,
        excludedLength: css.length,
        matchedStyles: matches.length,
      };
    }, {
      sourceBlockUid: variant.sourceBlockUid,
      expectedSourceHash: variant.expectedSourceHash,
      marker: variant.styleTextIncludes,
      expectedMatches: variant.expectedMatches,
    });
    return { id: variant.id, ...result };
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
        && window.roamAlphaAPI
        && (document.getElementById(`block-input-${targetUid}`)
          || document.querySelector(`[data-block-uid="${CSS.escape(targetUid)}"]`)),
      );
    },
    { pageUid: config.pageUid, targetUid: config.targetUid },
    { timeout: 60_000 },
  );
  if (runtimeReadyGlobals.length > 0) {
    await page.waitForFunction(
      (globals) => globals.every((key) => Boolean(window[key])),
      runtimeReadyGlobals,
      { timeout: 60_000 },
    );
  }
  if (runtimeSettleMs > 0) {
    await page.waitForTimeout(runtimeSettleMs);
  }
}

async function focusTarget(page) {
  const target = page.locator(
    `[data-block-uid="${config.targetUid}"] .rm-block__input`,
  );
  if (await target.count() !== 1) {
    throw new Error(`Expected one target block input for ${config.targetUid}`);
  }
  await target.click();
  await page.waitForFunction(
    (targetUid) => document.activeElement
      ?.closest("[data-block-uid]")
      ?.getAttribute("data-block-uid") === targetUid,
    config.targetUid,
  );
}

async function installDomStress(page, copies) {
  if (!Number.isInteger(copies) || copies < 1) return null;
  return page.evaluate(({ targetUid, count }) => {
    document.getElementById("roam-enter-perf-dom-stress")?.remove();
    const article = document.querySelector(".roam-article");
    const source = article?.querySelector(`[data-block-uid="${CSS.escape(targetUid)}"]`);
    if (!article || !source) throw new Error("Missing DOM stress source block");

    const host = document.createElement("div");
    host.id = "roam-enter-perf-dom-stress";
    host.setAttribute("aria-hidden", "true");
    host.style.pointerEvents = "none";
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const clone = source.cloneNode(true);
      clone.dataset.blockUid = `perf-stress-${index}`;
      clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      clone.querySelectorAll("textarea, input, button, a").forEach((element) => {
        element.tabIndex = -1;
      });
      fragment.append(clone);
    }
    host.append(fragment);
    article.append(host);
    return {
      copies: count,
      elementCount: host.querySelectorAll("*").length,
    };
  }, { targetUid: config.targetUid, count: copies });
}

async function removeDomStress(page) {
  return page.evaluate(() => {
    const host = document.getElementById("roam-enter-perf-dom-stress");
    if (!host) return false;
    host.remove();
    return true;
  });
}

async function destroyRuntimeGlobal(page, globalKey) {
  return page.evaluate((key) => {
    const runtime = window[key];
    if (!runtime || typeof runtime.destroy !== "function") {
      throw new Error(`Runtime global is not destroyable: ${key}`);
    }
    runtime.destroy();
    return {
      globalKey: key,
      removed: !window[key],
    };
  }, globalKey);
}

async function removeRuntimeKeydownListener(page, candidate) {
  return page.evaluate((candidateId) => {
    const entries = (window.__roamEnterListenerRegistry ?? [])
      .filter((entry) => entry.target === document && entry.type === "keydown");
    const matches = entries.filter((entry) => {
      const source = String(entry.listener);
      if (candidateId === "todo-trigger") {
        return source.includes('startsWith("{{[[DONE]]}}")')
          && source.includes('startsWith("{{[[TODO]]}}")');
      }
      return false;
    });
    if (matches.length !== 1) {
      throw new Error(
        `Keydown candidate ${candidateId} matched ${matches.length} listeners; expected 1`,
      );
    }
    const [entry] = matches;
    document.removeEventListener("keydown", entry.listener, entry.options);
    return {
      candidateId,
      matched: matches.length,
      listener: String(entry.listener).replaceAll(/\s+/g, " ").slice(0, 240),
    };
  }, candidate);
}

async function installMeasurementProbe(page) {
  await page.evaluate(({ targetUid, timeoutMs }) => {
    const root = document.querySelector(".roam-article");
    if (!root) throw new Error("Missing .roam-article root");

    const uniqueUids = () => new Set(
      [...root.querySelectorAll("[data-block-uid]")]
        .map((element) => element.getAttribute("data-block-uid"))
        .filter(Boolean),
    );

    const initialUids = uniqueUids();
    const initialCount = initialUids.size;
    window.__roamEnterPerfInitialUids = [...initialUids];
    let keydownAt = null;
    let keydownTrusted = false;
    let eventDispatchCompletedAt = null;
    let eventTiming = null;
    let eventObserver = null;
    let longTaskObserver = null;
    let animationFrameObserver = null;
    const longTasks = [];
    const longAnimationFrames = [];
    let settled = false;

    const collectEventTiming = (entries) => {
      const candidates = entries
        .filter((entry) => entry.name === "keydown")
        .filter((entry) => keydownAt === null || entry.startTime >= keydownAt - 5);
      const candidate = candidates.at(-1);
      if (!candidate) return;
      eventTiming = {
        durationMs: candidate.duration,
        inputDelayMs: candidate.processingStart - candidate.startTime,
        processingMs: candidate.processingEnd - candidate.processingStart,
        presentationMs: Math.max(0, candidate.duration - (
          candidate.processingEnd - candidate.startTime
        )),
      };
    };

    try {
      eventObserver = new PerformanceObserver((list) => {
        collectEventTiming(list.getEntries());
      });
      eventObserver.observe({ type: "event", buffered: false, durationThreshold: 0 });
    } catch {
      eventObserver = null;
    }

    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            startTimeMs: entry.startTime,
            durationMs: entry.duration,
          });
        }
      });
      longTaskObserver.observe({ type: "longtask", buffered: false });
    } catch {
      longTaskObserver = null;
    }

    try {
      animationFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longAnimationFrames.push({
            startTimeMs: entry.startTime,
            durationMs: entry.duration,
            blockingDurationMs: entry.blockingDuration,
            renderStartMs: entry.renderStart,
            styleAndLayoutStartMs: entry.styleAndLayoutStart,
            scripts: (entry.scripts ?? []).map((script) => {
              let sourceURL = script.sourceURL || null;
              try {
                if (sourceURL) {
                  const url = new URL(sourceURL, location.href);
                  sourceURL = `${url.origin}${url.pathname}`;
                }
              } catch {
                sourceURL = null;
              }
              return {
                durationMs: script.duration,
                forcedStyleAndLayoutDurationMs: script.forcedStyleAndLayoutDuration,
                invoker: script.invoker,
                invokerType: script.invokerType,
                functionName: script.functionName,
                sourceURL,
              };
            }),
          });
        }
      });
      animationFrameObserver.observe({
        type: "long-animation-frame",
        buffered: false,
      });
    } catch {
      animationFrameObserver = null;
    }

    const completion = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        eventObserver?.disconnect();
        longTaskObserver?.disconnect();
        animationFrameObserver?.disconnect();
        reject(new Error(`Enter milestone timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        eventObserver?.disconnect();
        longTaskObserver?.disconnect();
        animationFrameObserver?.disconnect();
        resolve(value);
      };

      const poll = () => {
        if (keydownAt === null) {
          requestAnimationFrame(poll);
          return;
        }

        const active = document.activeElement;
        const activeUid = active
          ?.closest?.("[data-block-uid]")
          ?.getAttribute("data-block-uid");

        if (activeUid && activeUid !== targetUid && !initialUids.has(activeUid)) {
          const focusDetectedAt = performance.now();
          requestAnimationFrame(() => {
            const firstPaintFrameAt = performance.now();
            requestAnimationFrame(() => {
              const secondPaintFrameAt = performance.now();
              collectEventTiming(eventObserver?.takeRecords?.() ?? []);
              for (const entry of longTaskObserver?.takeRecords?.() ?? []) {
                longTasks.push({
                  startTimeMs: entry.startTime,
                  durationMs: entry.duration,
                });
              }
              for (const entry of animationFrameObserver?.takeRecords?.() ?? []) {
                longAnimationFrames.push({
                  startTimeMs: entry.startTime,
                  durationMs: entry.duration,
                  blockingDurationMs: entry.blockingDuration,
                  renderStartMs: entry.renderStart,
                  styleAndLayoutStartMs: entry.styleAndLayoutStart,
                  scripts: (entry.scripts ?? []).map((script) => ({
                    durationMs: script.duration,
                    forcedStyleAndLayoutDurationMs: script.forcedStyleAndLayoutDuration,
                    invoker: script.invoker,
                    invokerType: script.invokerType,
                    functionName: script.functionName,
                    sourceURL: script.sourceURL || null,
                  })),
                });
              }
              const afterUids = uniqueUids();
              finish({
                appDurationMs: secondPaintFrameAt - keydownAt,
                eventDispatchCompletedMs: eventDispatchCompletedAt === null
                  ? null
                  : eventDispatchCompletedAt - keydownAt,
                focusDetectedMs: focusDetectedAt - keydownAt,
                firstPaintFrameMs: firstPaintFrameAt - keydownAt,
                secondPaintFrameMs: secondPaintFrameAt - keydownAt,
                keydownTrusted,
                oldUid: targetUid,
                newUid: activeUid,
                beforeCount: initialCount,
                afterCreateCount: afterUids.size,
                eventTiming,
                longTasks: longTasks.filter((entry) => (
                  entry.startTimeMs + entry.durationMs >= keydownAt
                  && entry.startTimeMs <= secondPaintFrameAt
                )),
                longAnimationFrames: longAnimationFrames.filter((entry) => (
                  entry.startTimeMs + entry.durationMs >= keydownAt
                  && entry.startTimeMs <= secondPaintFrameAt
                )),
              });
            });
          });
          return;
        }

        requestAnimationFrame(poll);
      };

      addEventListener("keydown", (event) => {
        if (event.key === "Enter" && keydownAt === null) {
          keydownTrusted = event.isTrusted;
          keydownAt = performance.now();
          queueMicrotask(() => {
            eventDispatchCompletedAt = performance.now();
          });
        }
      }, { capture: true, once: true });

      requestAnimationFrame(poll);
    });

    window.__roamEnterPerfCompletion = completion;
  }, { targetUid: config.targetUid, timeoutMs: sampleTimeoutMs });
}

async function cleanupSample(page, newUid, expectedCount) {
  const undoShortcut = process.platform === "darwin" ? "Meta+KeyZ" : "Control+KeyZ";
  let cleanupMethod = "undo";

  // Revert the user-level Enter transaction instead of racing a second graph
  // delete transaction against Roam sync. The newly created blank is still the
  // active editor here, so native Undo restores the exact pre-sample state.
  await page.keyboard.press(undoShortcut);

  try {
    await page.waitForFunction(({ uid, expected }) => {
      const graphBlock = window.roamAlphaAPI.pull("[:block/uid]", [":block/uid", uid]);
      const root = document.querySelector(".roam-article");
      const count = new Set(
        [...(root?.querySelectorAll("[data-block-uid]") ?? [])]
          .map((element) => element.getAttribute("data-block-uid"))
          .filter(Boolean),
      ).size;
      return !graphBlock && count === expected;
    }, { uid: newUid, expected: expectedCount }, { timeout: 2000 });
  } catch {
    // Defensive fallback for a browser/platform where the Roam undo shortcut
    // is unavailable. Focus a stable block before the exact API deletion.
    cleanupMethod = "delete-fallback";
    await focusTarget(page);
    await page.evaluate(async (uid) => {
      await window.roamAlphaAPI.deleteBlock({ block: { uid } });
    }, newUid);
    await page.waitForFunction(({ uid, expected }) => {
      const graphBlock = window.roamAlphaAPI.pull("[:block/uid]", [":block/uid", uid]);
      const root = document.querySelector(".roam-article");
      const count = new Set(
        [...(root?.querySelectorAll("[data-block-uid]") ?? [])]
          .map((element) => element.getAttribute("data-block-uid"))
          .filter(Boolean),
      ).size;
      return !graphBlock && count === expected;
    }, { uid: newUid, expected: expectedCount }, { timeout: sampleTimeoutMs });
  }

  return page.evaluate(({ uid, expected }) => {
    const graphBlock = window.roamAlphaAPI.pull("[:block/uid]", [":block/uid", uid]);
    const root = document.querySelector(".roam-article");
    const afterCleanupCount = new Set(
      [...(root?.querySelectorAll("[data-block-uid]") ?? [])]
        .map((element) => element.getAttribute("data-block-uid"))
        .filter(Boolean),
    ).size;
    return {
      cleanupVerified: !graphBlock && afterCleanupCount === expected,
      afterCleanupCount,
    };
  }, { uid: newUid, expected: expectedCount }).then((result) => ({
    ...result,
    cleanupMethod,
  }));
}

async function readDirectPageChildren(page) {
  return page.evaluate((pageUid) => {
    const pulled = window.roamAlphaAPI.pull(
      "[:block/uid {:block/children [:block/uid :block/string {:block/children [:block/uid]}]}]",
      [":block/uid", pageUid],
    );
    return (pulled?.[":block/children"] ?? []).map((child) => ({
      uid: child[":block/uid"],
      string: child[":block/string"] ?? "",
      childCount: (child[":block/children"] ?? []).length,
    }));
  }, config.pageUid);
}

async function cleanupSessionArtifacts(page, initialChildren) {
  const initialUids = new Set(initialChildren.map((child) => child.uid));
  const removedUids = [];
  let stablePasses = 0;

  await focusTarget(page);

  for (let pass = 0; pass < 8 && stablePasses < 2; pass += 1) {
    await page.waitForTimeout(300);
    const currentChildren = await readDirectPageChildren(page);
    const currentUids = new Set(currentChildren.map((child) => child.uid));
    const missingInitial = [...initialUids].filter((uid) => !currentUids.has(uid));
    if (missingInitial.length > 0) {
      throw new Error(
        `Session cleanup detected missing fixture blocks: ${missingInitial.join(", ")}`,
      );
    }

    const unexpected = currentChildren.filter((child) => !initialUids.has(child.uid));
    const unsafe = unexpected.filter(
      (child) => child.string.trim() !== "" || child.childCount !== 0,
    );
    if (unsafe.length > 0) {
      throw new Error(
        `Session cleanup refused non-empty unexpected blocks: ${unsafe.map((child) => child.uid).join(", ")}`,
      );
    }

    if (unexpected.length === 0) {
      stablePasses += 1;
      continue;
    }

    stablePasses = 0;
    for (const child of unexpected) {
      await page.evaluate(async (uid) => {
        await window.roamAlphaAPI.deleteBlock({ block: { uid } });
      }, child.uid);
      removedUids.push(child.uid);
    }
    await focusTarget(page);
  }

  const finalChildren = await readDirectPageChildren(page);
  const finalUids = new Set(finalChildren.map((child) => child.uid));
  const unexpectedFinal = finalChildren.filter((child) => !initialUids.has(child.uid));
  const missingFinal = [...initialUids].filter((uid) => !finalUids.has(uid));
  const cleanupVerified = stablePasses >= 2
    && unexpectedFinal.length === 0
    && missingFinal.length === 0;
  if (!cleanupVerified) {
    throw new Error(
      `Session cleanup did not stabilize; unexpected=${unexpectedFinal.map((child) => child.uid).join(",")}; missing=${missingFinal.join(",")}`,
    );
  }

  return {
    cleanupVerified,
    initialDirectChildCount: initialChildren.length,
    finalDirectChildCount: finalChildren.length,
    removedUids: [...new Set(removedUids)],
  };
}

async function recoverCreatedBlock(page) {
  return page.evaluate((targetUid) => {
    const root = document.querySelector(".roam-article");
    const initialUids = new Set(window.__roamEnterPerfInitialUids ?? []);
    const currentUids = new Set(
      [...(root?.querySelectorAll("[data-block-uid]") ?? [])]
        .map((element) => element.getAttribute("data-block-uid"))
        .filter(Boolean),
    );
    const createdUids = [...currentUids]
      .filter((uid) => uid !== targetUid && !initialUids.has(uid));
    const active = document.activeElement;
    const activeUid = active
      ?.closest?.("[data-block-uid]")
      ?.getAttribute("data-block-uid");

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
    // Keep stylesheet parsing/recalculation outside the trusted Enter window.
    // Two animation frames allow the replacement stylesheet to become the
    // browser's settled render state before focus and keydown measurement.
    await page.evaluate(() => new Promise((resolveFrame) => {
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
    }));
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

async function inspectRuntime(page) {
  return page.evaluate(() => {
    const sanitizeUrl = (value) => {
      try {
        const url = new URL(value, location.href);
        return `${url.origin}${url.pathname}`;
      } catch {
        return null;
      }
    };

    const resources = performance.getEntriesByType("resource")
      .filter((entry) => [
        "script",
        "fetch",
        "xmlhttprequest",
      ].includes(entry.initiatorType))
      .map((entry) => ({
        type: entry.initiatorType,
        url: sanitizeUrl(entry.name),
        durationMs: entry.duration,
        transferSize: entry.transferSize,
      }))
      .filter((entry) => Boolean(entry.url));

    return {
      supportedPerformanceEntryTypes: PerformanceObserver.supportedEntryTypes ?? [],
      scriptTags: [...document.scripts]
        .map((script) => sanitizeUrl(script.src))
        .filter(Boolean),
      resources,
      diagnosticGlobals: Object.keys(window)
        .filter((key) => /(?:roam|nautilus|scroll|sidebar|extension)/i.test(key))
        .filter((key) => !key.startsWith("webpack"))
        .sort(),
      documentKeydownListeners: (window.__roamEnterListenerRegistry ?? [])
        .filter((entry) => entry.target === document && entry.type === "keydown")
        .map((entry, index) => ({
          index,
          capture: typeof entry.options === "boolean"
            ? entry.options
            : Boolean(entry.options?.capture),
          listener: String(entry.listener).replaceAll(/\s+/g, " ").slice(0, 800),
        })),
    };
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
const blockedResources = [];
if (blockedResourceSubstring) {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.includes(blockedResourceSubstring)) {
      blockedResources.push(url);
      const stylesheet = /extension\.css(?:$|\?)/.test(url);
      await route.fulfill({
        status: 200,
        contentType: stylesheet ? "text/css" : "application/javascript",
        body: stylesheet
          ? ""
          : "export default { onload() {}, onunload() {} };",
      });
      return;
    }
    await route.continue();
  });
}
if (mode === "inspect" || runtimeRemoveKeydownListener) {
  await context.addInitScript(() => {
    const registry = [];
    const original = EventTarget.prototype.addEventListener;
    Object.defineProperty(window, "__roamEnterListenerRegistry", {
      value: registry,
      configurable: true,
    });
    EventTarget.prototype.addEventListener = function addEventListener(
      type,
      listener,
      options,
    ) {
      registry.push({ target: this, type, listener, options });
      return original.call(this, type, listener, options);
    };
  });
}
const page = await context.newPage();
let outputPath;
let initialPageChildren = null;
let sessionGuard = null;
let sessionGuardError = null;
let runError = null;

try {
  await waitForLab(page);
  let runtimeDestroy = null;
  let removedKeydownListener = null;
  if (runtimeDestroyGlobal) {
    runtimeDestroy = await destroyRuntimeGlobal(page, runtimeDestroyGlobal);
    await page.evaluate(() => new Promise((resolveFrame) => {
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
    }));
  }
  if (runtimeRemoveKeydownListener) {
    removedKeydownListener = await removeRuntimeKeydownListener(
      page,
      runtimeRemoveKeydownListener,
    );
    await page.evaluate(() => new Promise((resolveFrame) => {
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
    }));
  }
  const domStress = await installDomStress(page, domStressCopies);
  if (domStress) {
    await page.evaluate(() => new Promise((resolveFrame) => {
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
    }));
  }
  initialPageChildren = await readDirectPageChildren(page);

  if (mode === "inspect") {
    const inventory = await inspectStyles(page);
    const runtimeAtReady = await inspectRuntime(page);
    await page.waitForTimeout(10_000);
    const runtimeAfterTenSeconds = await inspectRuntime(page);
    outputPath = await writeResult("style-inventory", {
      generatedAt: new Date().toISOString(),
      graphSlug: config.graphSlug,
      pageUid: config.pageUid,
      targetUid: config.targetUid,
      styles: inventory,
      runtimeAtReady,
      runtimeAfterTenSeconds,
    });
  } else {
    if (blockedResourceSubstring && blockedResources.length === 0) {
      throw new Error(
        `Blocked resource fingerprint did not match any request: ${blockedResourceSubstring}`,
      );
    }
    const baseline = config.variants.find((variant) => variant.type === "baseline");
    const candidate = config.variants.find((variant) => variant.type !== "baseline");
    const samples = [];

    if (mode === "smoke") {
      for (let index = 0; index < smokeSamples; index += 1) {
        samples.push(await takeSample(page, baseline, "smoke", index));
      }
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

    sessionGuard = await cleanupSessionArtifacts(page, initialPageChildren);

    const result = {
      generatedAt: new Date().toISOString(),
      mode,
      graphSlug: config.graphSlug,
      pageUid: config.pageUid,
      targetUid: config.targetUid,
      runtimeDestroy,
      removedKeydownListener,
      blockedResourceSubstring,
      blockedResources: [...new Set(blockedResources)],
      domStress,
      configFile: basename(configPath),
      summary: summarizeSamples(samples),
      samples,
      sessionGuard,
    };
    outputPath = await writeResult(mode, result);
    process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  }
} catch (error) {
  runError = error;
} finally {
  try {
    if (mode !== "inspect" && initialPageChildren) {
      try {
        sessionGuard = await cleanupSessionArtifacts(page, initialPageChildren);
      } catch (error) {
        sessionGuardError = error;
      }
    }
    await restoreStyles(page);
    await removeDomStress(page);
  } finally {
    await context.close();
    await browser.close();
  }
}

let postContextGuard = null;
let postContextGuardError = null;
if (mode !== "inspect" && initialPageChildren) {
  const verificationBrowser = await chromium.launch({ headless: true });
  const verificationPasses = [];
  const removedUids = [];
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const verificationContext = await verificationBrowser.newContext({
        storageState: authPath,
      });
      const verificationPage = await verificationContext.newPage();
      let guard;
      try {
        await waitForLab(verificationPage);
        guard = await cleanupSessionArtifacts(
          verificationPage,
          initialPageChildren,
        );
        removedUids.push(...guard.removedUids);

        // Keep the verifier alive long enough for Roam's async graph sync to
        // publish a cleanup before a new context checks server-backed state.
        await verificationPage.waitForTimeout(3000);
        const settledGuard = await cleanupSessionArtifacts(
          verificationPage,
          initialPageChildren,
        );
        removedUids.push(...settledGuard.removedUids);
        guard = {
          ...settledGuard,
          removedUids: [...new Set([
            ...guard.removedUids,
            ...settledGuard.removedUids,
          ])],
        };
      } finally {
        await verificationContext.close();
      }

      verificationPasses.push(guard);
      if (pass > 0 && guard.removedUids.length === 0) {
        postContextGuard = {
          cleanupVerified: true,
          initialDirectChildCount: guard.initialDirectChildCount,
          finalDirectChildCount: guard.finalDirectChildCount,
          removedUids: [...new Set(removedUids)],
          verificationPasses: verificationPasses.length,
        };
        break;
      }
    }

    if (!postContextGuard) {
      throw new Error(
        "Post-context cleanup did not reach a clean read-only verification pass",
      );
    }
  } catch (error) {
    postContextGuardError = error;
  } finally {
    await verificationBrowser.close();
  }

  if (outputPath && postContextGuard) {
    const result = JSON.parse(await readFile(outputPath, "utf8"));
    result.postContextGuard = postContextGuard;
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
}

if (postContextGuardError || sessionGuardError || runError) {
  throw postContextGuardError ?? sessionGuardError ?? runError;
}

if (outputPath) {
  process.stdout.write(`Result: ${outputPath}\n`);
}
