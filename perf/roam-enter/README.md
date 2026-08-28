# Roam Enter Performance Lab

This lab measures the time from a trusted Enter keydown to the newly created Roam block becoming editable and painted. It runs in a dedicated Playwright Chromium profile and never attaches to the user's active Chrome or Roam Desktop window.

## Safety contract

- Use only the permanent synthetic `CSS Performance Lab` page.
- A sample creates one block, deletes that exact UID, and verifies deletion before continuing.
- CSS candidates are disabled only in browser memory; `roam/css` is never edited.
- A CSS marker must match the configured number of style nodes exactly.
- Authentication and results are local and gitignored.

## Setup

```bash
cd perf/roam-enter
npm install
cp config.example.json config.local.json
```

Fill in the fixed page and target UIDs in `config.local.json`, then perform the only headed step:

```bash
npm run auth
```

The command opens a separate Playwright window. Log in manually, navigate to the lab page, then press Enter in the terminal. Normal runs after that are headless:

```bash
npm run inspect
npm run smoke
npm run benchmark
```

`inspect` writes a non-sensitive style inventory. Copy the candidate style's `textHash` and `ruleCount` into `expectedTextHash` and `expectedRuleCount` before a formal benchmark. This prevents a combined or changed stylesheet from being mistaken for the intended CSS block.

`smoke` verifies the full create/measure/delete transaction once. `benchmark` refuses an unfingerprinted candidate, discards warmups, and uses an interleaved A-B-B-A schedule, reporting median and P75.

Do not make a CSS decision from a single run. Require the same direction across at least three independent runs and a difference larger than normal machine noise.
