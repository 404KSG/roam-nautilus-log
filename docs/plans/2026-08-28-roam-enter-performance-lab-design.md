# Roam Enter Performance Lab

## Goal

Measure whether a specific `roam/css` rule group materially changes the time from a trusted Enter keydown to a newly created Roam block becoming editable and painted, without driving the user's active Roam window or modifying the `roam/css` page.

## Chosen Approach

Use an isolated Playwright Chromium profile against a permanent `CSS Performance Lab` page in the current graph.

- The user's current Chrome and Roam Desktop are never attached or controlled.
- Authentication is performed manually once in a dedicated automation window and stored in a gitignored local file.
- Normal benchmark runs are headless and single-process.
- Each sample creates exactly one empty sibling block, records the new UID, deletes that UID with `roamAlphaAPI`, and verifies that it no longer exists.
- A failed cleanup aborts the run. Later samples never continue on a dirty fixture.
- CSS variants temporarily disable an exact in-memory `<style>` node. A variant must match the configured marker and expected count exactly or the run aborts before typing.

## Test Page Contract

The permanent page is named `CSS Performance Lab` and contains synthetic content only.

- A marker block explains that the page is automation-owned.
- A representative fixed tree contains plain text, TODOs, page references, emphasis, and nested blocks.
- A final block named `PERF ENTER TARGET` is the only block used for Enter samples.
- The fixture manifest stores the page UID and target block UID.
- A run records the visible block count before each sample and requires the same count after cleanup.

The page is intentionally permanent: only the one sample block is temporary. This avoids recreating a large fixture before every run and prevents test artifacts from appearing in daily work pages.

## Measurement Contract

The primary application milestone is:

```text
trusted Enter keydown
  -> a different block UID appears
  -> its textarea becomes document.activeElement
  -> two requestAnimationFrame callbacks complete
```

The page probe returns:

- application milestone duration;
- input, processing, and presentation segments when Event Timing reports the keydown interaction;
- old and new block UIDs;
- block count before creation, after creation, and after cleanup;
- cleanup verification result.

The runner discards warmups and reports median and P75. Formal A/B runs use an interleaved `A-B-B-A` schedule rather than completing every A sample before B.

## CSS Variant Contract

The runner first supports an inspection mode that inventories style elements and saves only their attributes, rule counts, hashes, and short non-sensitive comment markers.

A candidate variant declares:

```json
{
  "id": "without-global-font",
  "styleTextIncludes": "/* Global Font */",
  "expectedMatches": 1
}
```

During that variant, matching style nodes receive a temporary `media="not all"`. Their original `media` values are restored before the next variant and again in `finally`. The graph is not edited.

If Roam combines multiple CSS blocks into one style element, the inventory will reveal that. The runner must not disable the combined element and pretend it isolated one rule; that candidate requires a dedicated copied test stylesheet instead.

## Safety And Non-Interference

- Never attach to the user's active Chrome through CDP.
- Never automate credentials; the user performs the one-time login manually.
- Store auth state under `perf/roam-enter/.auth/`, which is gitignored.
- Store results under `perf/roam-enter/results/`, which is gitignored.
- Keep one browser context and one page; do not use parallel workers.
- Do not record video, screenshots, or traces during formal timing.
- Use tracing only for a separate diagnostic run after a stable regression is observed.
- Refuse to run when the page UID, target UID, graph route, or cleanup capability differs from the manifest.

## Acceptance

The lab is ready for its first real baseline when:

1. local configuration/statistics/schedule tests pass;
2. the fixture page and target UID are created and read back through the official Roam CLI;
3. the auth setup can save state without storing credentials in source control;
4. a single headless smoke sample creates, measures, deletes, and verifies one block;
5. the JSON report contains no user graph content beyond the synthetic page title and test UIDs.

Do not optimize CSS from one run. Treat a candidate as meaningful only when the direction repeats across at least three independent interleaved runs and exceeds normal machine noise.
