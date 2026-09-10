# Full-template one-click creation

## Approved behavior

One normal click on **+ Create today's plan** / **＋ 创建今日计划**, from any
page, appends the complete current managed Nautilus template to the local-calendar
Daily Note and opens the result. No panel, confirmation, manual `;;`, settings-based
root regeneration, yesterday copy, timer start, or Calendar request intervenes.
The 30px Roam-gray trigger and existing capacity text / 136×6 energy bar remain.

This supersedes the creation path in the
[original single-root design](./2026-09-09-create-today-plan-design.md), not scaffold
migration, CLOCK ownership, scheduling, or the existing present-plan panel.

## Source contract

`freezeCanonicalTemplate` queries the actual managed template on `roam/render`.
Exactly one supported managed renderer root is accepted. Its literal string,
fixed events, TODO/DONE markers, separators, ordinary descendants, and nested
notes are copied in order. Each destination has a new UID. Only references to
nodes inside this snapshot are remapped; external references, including renderer
code UIDs and external TODO/DONE owners, remain references and are not expanded.
Source blocks, existing Daily Note content, and weekly tags are not rewritten.
Roam assigns new creation/edit attribution; this is not an author-history copy.

The reader uses wildcard single-entity Pulls plus separate immediate-child
queries. It does not rely on a recursive Pull's cardinality cap. It normalizes
unqualified, namespaced, and colon-prefixed keys, including native
`:children/view-type` / `view-type` → mutation `children-view-type`. Host-managed
activity fields such as unqualified `time`, `user`, and `seen-by` are metadata,
not source formatting to clone. Supported fields are
`open`, `heading`, `text-align`, and `children-view-type`; missing presentation
values normalize to open / 0 / left / bullet. Unknown non-metadata properties or
invalid values are refused, rather than silently omitted and certified.

Duplicate UIDs, cycles, invalid child order, unreadable results, more than 2,000
nodes, depth over 64, or over 1,000,000 text code units are rejected. The canonical
object tree is serialized once, not as recursively escaped JSON strings.
Multiple candidates/renderers, extra top-level template siblings, and genuine
LOGBOOK/CLOCK history receive specific refusal reasons. A missing managed template
retains the explicit historical empty-renderer fallback, under the same write guards.

## Operation and integrity

`createTodayPlanSession` is the single owner for the lightweight launcher, execution
topbar, Plan empty state, and command. The graph, local date, and source are captured
in the click stack, before waiting for a graph/date WebLock. The lock protects
participating same-origin browser contexts only, not other devices, profiles,
manual writers, or Roam synchronization. Settings are not a lock.

Inside the lock:

1. Read the graph/date receipt and recheck today's plan. Existing manual, native
   `;;`, empty, legacy, or all-DONE plans are locate-only unless an incomplete
   operation receipt requires integrity verification first.
2. Reserve `nautilus-log-plan-YYYY-MM-DD`; preallocate unique descendant UIDs and
   check all of them against each other, the reserved root, and the graph.
3. Reuse or create the frozen Daily Note. Page failures make no template request.
4. Save and read back a versioned receipt before template writes. It contains
   graph/date, operation identity, destination page/root UIDs, and a manifest of
   destination UIDs, parents, orders, and SHA-256 content/property hashes. No
   template text or source tree is stored in settings. Hashes are integrity
   checks, not encryption or a promise that guessable text cannot be inferred.
5. After awaited page, hash, and receipt operations, check date/graph/lifecycle,
   duplicate plans, UID collisions, and the source again immediately before the
   first template request. A pre-template failure can be retried; an ambiguous
   template request retains its original identity.
6. Create one block at a time, root at `last`, using only the frozen snapshot.
   A changed source after writing begins never changes the remaining copy.
7. Read back the complete tree and its Daily Note membership. Success requires
   exact root parent/order, every child UID/parent/order, text, and normalized
   attributes—not root presence or count alone. RAM verification uses exact text
   equality; reload verification uses WebCrypto SHA-256.
8. Clear only the matching receipt, with awaited readback, while holding the lock.
   A write-then-throw is resolved by readback. No background asynchronous clear
   can race a newer participating operation. Navigation failure is open-only.

A partial tree is never deleted, overwritten, or replaced by a second copy.
**Continue creation** calls `ensureToday({resume:true})` only for the original
in-memory intent. It revalidates every written node (including deletions, moves,
order and formatting changes) before creating just the missing suffix. A normal
click opens diagnostics, not continuation. After extension reload, only verification
and opening are allowed; a newly read template never supplies missing content.
Unreadable or corrupt receipts fail closed with a visible reason and read-only retry.

## State, performance, and lifecycle

| State | User action |
| --- | --- |
| Checking / creating | Disabled trigger; no capacity placeholder |
| Confirmed absence | One-click create; Plan empty state also offers View template |
| Ready | Existing panel/capacity behavior; lightweight launcher opens the plan |
| Creation incomplete | Visible diagnosis/counts, Inspect created blocks, and validated same-memory Continue creation |
| Unsupported | Exact reason and a working View template navigation action |
| Read failure | Visible explanation and read-only Check again |
| Navigation failure | Open the already-created plan; never clone again |

Receipt checks are bounded to initialization, foreground recovery, local-date
recovery, explicit actions, and discovery of a new reserved-root identity. One pending
verification is deduplicated. Replacement tracking snapshots do not rescan the source. Tracking
ticks use cached integrity; `present`, tracking, locate, discover, retry, and
independent sessions cannot bypass an incomplete receipt. State is graph/date-scoped,
including when returning to a previously checked date. There is no extra interval,
per-tick tree scan, or additional capacity calculation.

Before the first template request, a date change stops creation. After that request,
the operation finishes/verifies the frozen original day and explains midnight; it
never labels yesterday as today's ready plan. Graph changes and unload prevent
following writes, readback, receipt actions, and navigation/notification work. An
already-issued host request cannot be rolled back or cancelled by this extension.

CLOCK/POMO keeps trigger and stop priority. Creation remains in the Plan empty state
while a timer runs. Shift opens the sidebar; Alt opens the main window. Both actual
and lightweight tooltips share the same theme, border-box width up to
`min(320px, viewport − 24px)`, wrapping/long-word fallback, and viewport clamping.
Numeric snippets remain aligned; paragraphs wrap. Keyboard focus uses an explicit
`aria-describedby` linkage; `aria-description` remains a valid supplemental attribute.

## API evidence and live boundary

Official cached `@roam-research/roam-tools-core` v0.10.0 `dist/types.d.ts:136–150`
defines the presentation fields; `dist/operations/blocks.js:161–176` forwards them
to `data.block.update`. The official repository's
[DataScript schema](https://github.com/Roam-Research/roam-tools/blob/e463c8ac63041667092b33a56b44d5d08ed22bc2/skills/roam-syntax/references/queries.md#datascript-schema-what-where-clauses-match)
confirms `:children/view-type`, raw `:block/string`, and unordered query relations.
Its [read/write guide](https://github.com/Roam-Research/roam-tools/blob/e463c8ac63041667092b33a56b44d5d08ed22bc2/skills/roam-syntax/references/reading-writing-via-mcp.md)
distinguishes raw strings from rendered reference previews. `data.block.fromMarkdown`
is supported, but neither proves lossless copies, chosen UID preservation, nor atomic
creation; this implementation retains the existing single-block create adapter.

The parent review also ran the production template reader through read-only
Datalog calls in the official CLI. The current user template was accepted as one
complete 18-block tree, with maximum descendant depth 2. Only attribute names,
types, counts, and the acceptance verdict were exposed; private text was not
stored. This caught missing support for unqualified activity metadata, which now
has a regression test.

This is read-path/schema evidence, not a live creation test. Native Desktop
mutation defaults, extension settings persistence, WebLocks availability, and
cross-client UID conflicts still need live validation. No production graph writes,
Google/OAuth changes, or user browser automation were performed.

## Maintained acceptance

- `test/managed-template-graph.cjs`: low-level graph fixture shared by Node/browser;
  it rejects duplicate-UID mutations and preserves actual graph parent/order fields.
- `test/managed-template.test.js`: actual query → freeze → session → adapter tests,
  including each Nth failure, write-then-throw, resume/destination edits, reload
  tracking, corrupt/delayed receipts, source changes during awaits, independent
  sessions, manual plans, UID collisions, midnight, graph switch, and unload.
- `test/real-today-plan.py` and its harness: actual session and timing runtime,
  with only host graph/time faked. Both launchers must clone the full anonymous
  tree and navigate after one click. Additional cases cover errors, partial/reload,
  tooltips, Chinese/dark/keyboard/narrow screens, modifier clicks, pending controls,
  CLOCK/POMO priority, midnight, missing provider, the shared command, and
  watched or silent whole-root deletion followed by an actual button click.
- `test/today-plan-recreate.test.js`: real watch bridge, timing runtime, and
  session against the same host graph. Whole-root deletion must become confirmed
  absence without background writes; empty or all-DONE trees remain locate-only.
  See [Whole-root deletion and explicit recreation](./2026-09-10-template-deletion-recreation-design.md).
- Older presentation-only harnesses remain visual regression tests, not evidence
  of real creation or live Roam Pull Watch. Existing CLOCK ownership/concurrency
  tests are retained.

Run `npm test`, `PYTHONDONTWRITEBYTECODE=1 npm run test:ui`, and `git diff --check`.
The real-session suite writes screenshots/results to `/tmp/nautilus-real-today-plan`
and reliably closes its isolated Chromium instance. No package version bump is needed.
