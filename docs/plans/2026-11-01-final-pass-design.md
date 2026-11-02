# Nautilus Log final pass — 2026-11-01

Implementation contract updated November 2, 2026. This supersedes conflicting renderer,
calendar-day, and completed-event assumptions in earlier design notes. The integrated
published baseline is `867cb4bcc394125b75caf6f99bea05118a1762ca`: keep removal of the automatic
outline-reordering control and keep current-status text in time-pointer red. Those published
parallel decisions supersede the earlier proposal to preserve and refine that control.

## Product boundary

Keep one spiral, native Roam blocks and references, user-owned estimates and task order,
whole tasks, and visible overflow. Child notes/logs are context rather than independent
scheduling demand. No task store, AI scheduling, automatic task splitting, history backfill,
forced TODO markers, task-size/WIP limits, new timer runtime, or Calendar/OAuth behavior change.
Completion timestamps and the Execution Layer remain separate, default-off features.

## Renderer revision and ownership

`renderer-contract.js` defines revision **2**, code UID **`roam-render-Nautilus-Log-r2-cljs`**,
namespace **`nautilus-log-r2`**, bridge **`window.nautilusLogR2`**, and source marker
**`;; nautilus-renderer 2`**. A future renderer-source behavior change advances the revision,
UID, and namespace together. Git hashes are build/display metadata, never version ordering.

An absent r2 source may be created; exact content is reused. Divergent content at the same
revision, older/unknown content placed at the new UID, and newer contracts are preserved
with a visible failure. Readiness also requires the exact fixed title → code-header → source
ancestry under `roam/render`. Every prospective reserved UID is preflighted before creating
any missing page or block; unrelated blocks are never adopted by creating missing parents.
Checks repeat across awaits, while legacy source siblings and unused reserved-looking UIDs
remain untouched. Legacy source UIDs are never rewritten. There is no navigation or
minute-tick source repair. Exact future `rN` family invocations still count as existing
plans for discovery/deduplication, without granting migration or plan-write authority.
Ambiguous or unsupported arguments also fail closed for mutation.

`renderer-bridge.js` binds current core, task core, readers, Desk, Help, and mutations to a
unique owner object and graph/provider/user scope. Host and Help registries distinguish
current and legacy families. Current CLJS captures its service owner for cleanup and
rebinds its plan session when that bridge changes. Mounted Desk restoration routes through
the same family ownership checks and ignores newer DOM hosts.

A separate compatibility facade supports historical v1 renderers. Their retained sessions
can follow a compatible legacy read provider across r2 reloads, within the same scope;
the old owner does not destroy a session that has adopted that reader. Current r2 sessions
never depend on mutable legacy globals. Another old package can still replace those
globals, edit legacy source, or add/repoint template roots. Update every client; historical
views may need a reload after removing a legacy-package conflict. This is not a cross-device lock.

## Bounded migration and creation

Automatic reference migration is limited to the single managed template and the active
Primary Plan, including a previous-date plan while its overnight window remains active.
Only the UID span changes: raw Unicode prefix, argument text, suffix, attributes, child tree,
order, and view preferences are preserved. Active editors are refused. Multiple/custom/newer
templates are neither selected by guesswork nor retired. Historical pages are not scanned.

`renderer-migration.js` saves and verifies a reservation before issuing a graph update.
`renderer-migration-pending` contains graph/type/user, UID, kind, revision, and before/after
SHA-256 hashes, with a 64-item / 32 KiB cap and no block text. Exact confirmed after-state can
retire the reservation. A current renderer with different text or arguments is not that
exact after-state and retains the reservation. Rejection, a lost response, or unresolved
state does not authorize blind replay on reload. Context, source readiness, editable buffers, and exact identity are
rechecked around asynchronous work. An uncertain migration never creates a second plan.

Calendar-date creation keeps its existing frozen template/date, deterministic destination
root, Web Locks, receipt verification, partial-state diagnostics, and original-memory-only
continuation. Fallback/template roots must use the current renderer, and source readiness
is checked before creation and later writes. Existing supported or newer-family plans are
located rather than duplicated. The dated UI guards against silently creating a different
calendar date after its label becomes stale.

## Event order and explicit reordering

`respect-event-order` is independent and **off by default**. Off retains all-day gap filling
in user task order. On uses `eventStartFloors`: each pending task receives the maximum end
of valid fixed events before it in outline order. The maximum is cumulative, so later-listed
earlier events cannot reduce it. Completed task rows do not reset it. Overnight events are
aligned before this rule; invalid, reversed, and zero-length ranges provide no floor.

The shared scheduler consumes that earliest start, skips gaps that cannot hold the whole
task, and preserves the remaining queue when its head cannot fit. No splitting, overtaking,
newly written times, or silent dropping occurs. A beyond-END floor can produce unscheduled
work even when total budget is sufficient. Overlapping fixed ranges count as a union.

DONE does not cancel a fixed reservation. Its written range remains in scheduling,
capacity, and overlap detection; users release it by editing/removing the range. Completion
styling stays separate from reservation semantics.

Task order changes only through explicit outline edits and manual Desk moves. Moving a task
across an event can change its earliest start when this option is on. There is no automatic
completed-item reordering command, bridge endpoint, production helper, or Undo service.
The retired feature's modules, glyph and tests stay removed; Desk and Calendar keep their
shared graph-write guard and native ownership checks.

## One active workday

`readActivePrimaryPlan` and `planWorkdayContext` resolve the relevant current/previous
calendar dates. Explicit global hours override renderer arguments; absent hours defer to
the supported plan. Unknown global hours do not authorize assuming a daytime window.
Unreadable is distinct from absent. Future-family roots stay discoverable but do not become
writable execution tasks.

A November 1 21:00–November 2 02:00 plan remains the owner at 00:30: logical minute **1470**,
**90 minutes** available. Execution Plan, capacity, Review and task mutations share
that context. At END selection returns to the calendar date without stopping a running
CLOCK. Previous-owner timing remains visible with its date and explicit Stop action;
start/complete actions require membership in the active supported plan.

Queued task mutations re-read identity after obtaining the CLOCK lock. An action already
accepted under that lock keeps its owner and instant through later writes, including a
boundary crossed while a host request settles. Provider, graph, user, task text/status
owner and plan membership are checked; a later refresh selects the current owner.

`active-plan-session.js` separates opening an active owner from calendar-date creation.
The lightweight launcher opens the existing active plan. The execution popover identifies
its owner date/END and provides an explicit dated calendar-day action. The command is
**Nautilus Log: Create or open today’s Daily Note plan**. An old Open target disappearing
does not authorize automatic creation. Calendar recovery uses the existing engine rather
than copying its mutation logic. Owner/date signals avoid repeated rediscovery from
unchanged tracking ticks; foreground and boundary checks can reselect without graph writes.

## Evidence and UI meaning

CLOCK evidence covers the owner's local midnight through at least the next calendar
midnight, extending only when overnight END is later. Ordinary 06:00–20:00 planning still
counts a 22:00 CLOCK. Local calendar construction handles DST; durations use elapsed time,
while the displayed last-CLOCK endpoint uses local wall time. A 23:30–00:15 CLOCK contributes
45 minutes to chart and Review for the overnight owner.

Actual remains an aggregate with the accepted endpoint precedence. CLOCK 09:00–09:40 plus
`d15:00` displays 14:20–15:00; sessions 09:00–09:15 and 10:00–10:15 display 09:45–10:15.
Tips distinguish **total** from **display interval** and retain the original sessions in
LOGBOOK. A local midnight stamp can normalize within the owner's overnight window; the
separate interpretation of dateless referenced stamps is unchanged.

Estimated completed records show a measured `≈` cue without removing previously visible
title characters or adding a universal subtitle row. Accessible names and Tips retain the
full meaning. **Planned now / 当前计划** describes the forecast, independently of CLOCK focus,
and uses the current-time pointer's theme-aware red. Titles retain their category colors.
**free / 未分配** is unassigned budget divided by full-day flexible capacity after deducting
Planned, not remaining clock time or physiological energy. Both topbar display modes use
the same minute projection.

Desk uses **New task / 新任务**, including its first-item Previous action, draft placeholder
and accessible names. Insertion remains at index zero, without forcing TODO; ordinary text
uses the default estimate, and nested logs do not schedule independently. Updating labels
does not replace editor contents or IME state.

Execution-off avoids the execution panel, one-second ticker and CLOCK writer; charts may
still read existing history. Standalone POMO remains behind that execution entry and its
legacy-Logbook conflict check. It writes no CLOCK/Actual but still requires the separate
Roam Logbook extension to be disabled. No independent POMO entry is added.

## Acceptance and limits

The frozen publication candidate must pass the full Node suite and all configured browser
gates. Added coverage includes renderer contract/source refusal, exact bounded migration,
real current/legacy CLJS in both orders, actual old scaffold writes, stale cleanup, retained
historical readers, optional event floors and explicit-order forecasts, overnight ownership, full-day/DST
CLOCK evidence, calendar creation recovery, and actual overnight topbar/launcher/Review UI.
Existing timestamp/reference/editor guarantees remain required.

Fixtures use isolated graph/DOM boundaries. They do not certify live Roam Desktop, OS IME,
atomic native Undo, Calendar authorization, or concurrent devices. Existing skipped UI
cases remain unverified. Independent Grok and Sol reviews and a clean-source publication
artifact comparison are required before reporting this pass as delivered.
