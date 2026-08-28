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

  const result = await page.evaluate(({ iterations }) => {
    const DAILY_PAGE_TREE_QUERY = `[:find ?page-uid ?uid ?string ?order ?parent-uid
      :in $ ?page-title
      :where
      [?page :node/title ?page-title]
      [?page :block/uid ?page-uid]
      [?block :block/page ?page]
      [?block :block/uid ?uid]
      [?block :block/string ?string]
      [?block :block/order ?order]
      [?parent :block/children ?block]
      [?parent :block/uid ?parent-uid]]`;
    const TASK_ENTRIES_QUERY = `[:find ?clock-uid ?clock-string ?drawer-string ?task-uid ?task-string ?page-title
      :in $ [?task-uid ...] [?drawer-string ...]
      :where
      [?t :block/uid ?task-uid]
      [?t :block/children ?d]
      [?d :block/string ?drawer-string]
      [?d :block/children ?c]
      [?c :block/uid ?clock-uid]
      [?c :block/string ?clock-string]
      [(get-else $ ?t :block/string "") ?task-string]
      [(get-else $ ?t :block/page "") ?p]
      [(get-else $ ?p :node/title "") ?page-title]]`;
    const TASK_ENTRIES_QUERY_DIRECT = `[:find ?clock-uid ?clock-string ?drawer-string ?task-uid ?task-string ?page-title
      :in $ [?task-uid ...]
      :where
      [?t :block/uid ?task-uid]
      [?t :block/children ?d]
      [?d :block/string ?drawer-string]
      [?d :block/children ?c]
      [?c :block/uid ?clock-uid]
      [?c :block/string ?clock-string]
      [(get-else $ ?t :block/string "") ?task-string]
      [(get-else $ ?t :block/page "") ?p]
      [(get-else $ ?p :node/title "") ?page-title]]`;
    const DRAWER_SHAPES = [
      { prefix: "", suffix: "::" },
      { prefix: "", suffix: ":" },
      { prefix: ":", suffix: ":" },
      { prefix: ":", suffix: "::" },
    ];
    const DRAWER_PADDING = ["", " ", "  ", "\t"];
    const DRAWER_CASES = ["LOGBOOK", "logbook", "Logbook", "LogBook"];
    const DRAWER_STRINGS = DRAWER_SHAPES.flatMap(({ prefix, suffix }) => DRAWER_CASES.flatMap((word) => (
      DRAWER_PADDING.flatMap((leading) => DRAWER_PADDING.map((trailing) => `${leading}${prefix}${word}${suffix}${trailing}`))
    )));
    const roam = window.roamAlphaAPI;
    const q = roam?.data?.fast?.q ?? roam?.q ?? roam?.data?.q;
    const owner = q === roam?.data?.fast?.q ? roam.data.fast : q === roam?.data?.q ? roam.data : roam;
    if (typeof q !== "function") throw new Error("Roam query API unavailable");
    const pageTitle = document.querySelector("h1.rm-title-display")?.textContent?.trim();
    if (!pageTitle) throw new Error("Daily page title unavailable");

    const dailyRows = q.call(owner, DAILY_PAGE_TREE_QUERY, pageTitle);
    const normalizedRows = Array.from(dailyRows ?? []).map((row) => Array.from(row ?? []));
    const planRow = normalizedRows.find((row) => /roam-render-Nautilus-Log-cljs/i.test(String(row[2] ?? "")))
      ?? normalizedRows.find((row) => /Nautilus Log/i.test(String(row[2] ?? "")));
    const planUid = planRow?.[1] ?? null;
    const childUids = planUid
      ? normalizedRows.filter((row) => row[4] === planUid).map((row) => row[1]).filter(Boolean)
      : [];

    const measure = (callback) => {
      const startedAt = performance.now();
      const value = callback();
      return { durationMs: performance.now() - startedAt, size: Array.from(value ?? []).length };
    };
    const dailyQuery = [];
    const entriesQuery = [];
    const directEntriesQuery = [];
    const planPull = [];
    const executionPlanPull = [];
    for (let index = 0; index < iterations; index += 1) {
      dailyQuery.push(measure(() => q.call(owner, DAILY_PAGE_TREE_QUERY, pageTitle)));
      if (childUids.length > 0) {
        entriesQuery.push(measure(() => q.call(owner, TASK_ENTRIES_QUERY, childUids, DRAWER_STRINGS)));
        directEntriesQuery.push(measure(() => q.call(owner, TASK_ENTRIES_QUERY_DIRECT, childUids)));
      }
      if (planUid && typeof roam?.data?.pull === "function") {
        planPull.push(measure(() => [roam.data.pull(
          "[:block/string {:block/children [:block/uid :block/string :block/order {:block/refs [:block/uid :block/string]}]}]",
          [":block/uid", planUid],
        )]));
        executionPlanPull.push(measure(() => [roam.data.pull(
          "[:block/string {:block/children [:block/uid :block/string :block/order {:block/refs [:block/uid :block/string]} {:block/children [:block/uid :block/string :block/order {:block/children [:block/uid :block/string :block/order]}]}]}]",
          [":block/uid", planUid],
        )]));
      }
    }

    const summarize = (samples) => {
      const values = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
      if (values.length === 0) return null;
      const percentile = (fraction) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))];
      return {
        count: values.length,
        medianMs: percentile(0.5),
        p95Ms: percentile(0.95),
        maxMs: values.at(-1),
        resultSize: samples.at(-1)?.size ?? 0,
      };
    };

    return {
      pageTitle,
      rowCount: normalizedRows.length,
      planUid,
      directChildCount: childUids.length,
      drawerVariantCount: DRAWER_STRINGS.length,
      dailyQuery: summarize(dailyQuery),
      entriesQuery: summarize(entriesQuery),
      directEntriesQuery: summarize(directEntriesQuery),
      planPull: summarize(planPull),
      executionPlanPull: summarize(executionPlanPull),
    };
  }, { iterations: 30 });

  process.stdout.write(`${JSON.stringify({ pageUid, ...result }, null, 2)}\n`);
} finally {
  await context.close();
  await browser.close();
}
