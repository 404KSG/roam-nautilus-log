# One-click creation of today's Nautilus plan

> **Superseded for template creation** by
> [Full-template one-click creation](./2026-09-10-full-template-creation-design.md).
> This document remains as historical context for the original single-root path.


## Decision

Use the existing 30px topbar control to create or open the Primary Plan on the
local-calendar Daily Note. Creation appends one canonical component, built from
the configured renderer identity and current settings. It works from any viewed
page and does not require the Execution Layer.

This action creates an instance, not another global template. It never copies
yesterday's tasks, DONE state, CLOCK history, or custom template subtrees. It does
not start Google sync, move existing content, or create anything automatically.

The accepted capacity bar remains unchanged: see the
[capacity-bar design](./2026-09-07-optional-energy-bar-design.md).

## Shared interface

`createTodayPlanSession` in `src/today-plan.js` owns discovery, creation, readback,
and navigation for the lightweight launcher, execution topbar, Plan empty-state,
and **Nautilus Log: Create or open today’s plan** command.

- `discover({ authoritative })`: read only; reuse tracking snapshots by default.
- `ensureToday({ locateMode })`: create or locate after fresh checks.
- `locateToday({ locateMode })`: re-read and navigate, without creating.
- `getState()`, `subscribe()`, `initialize()`, `destroy()`: shared state and cleanup.

`timing-topbar.js` does not call `readPrimaryPlan` or `readAllEntries`.

## UI states

| State | Meaning and action |
| --- | --- |
| `checking` | No confirmed result yet; the checking button is disabled. |
| `ready-absent` | No recognized plan; **+ Create today's plan** starts the action. |
| `creating` | A requested action is pending; disable repeated activation. |
| `ready-present` | Restore existing execution/capacity UI, or the lightweight open control when execution is off. |
| `ready-blocked` | Extra or unsupported template content; explain the native `;;` path. Clicking rechecks only. |
| `read-failed` | Read, capability, collision, or unconfirmed-write failure; show the reason and a read-only **Check again** action. |
| `nav-failed` | The plan is confirmed but navigation failed; retry opening, not insertion. |

The create label belongs to a normal button, never inside the 6px capacity track.
A running CLOCK/POMO keeps its timer and applicable stop controls visible even
without capacity data; creation remains available in the Plan empty-state.
Read-only retries do not silently turn into creation on the same click.

## Write safety

1. Capture the graph identity and local date when the action starts. Ignore the
   viewed page and the configured overnight workday window.
2. Read today's plan before requesting any write. Any recognized renderer is
   locate-only, including legacy Nautilus/Flow, custom prefixes, empty plans,
   and plans whose tasks are all DONE. Invalid query results are errors, not
   proof of absence.
3. Coalesce repeated calls within the shared session. Independent sessions use
   an exclusive Web Lock named by graph and date, then re-read under that lock.
   There is no localStorage lock approximation. If graph identity or Web Locks
   is unavailable, refuse creation and explain the native `;;` fallback. Opening
   an existing plan remains available.
4. Inspect the managed template. Standard single-component templates are
   supported. Extra siblings, render descendants, or unsupported render content
   require `;;`; nothing is silently dropped or blindly copied.
5. Validate the captured graph/date after asynchronous preparation and before
   every mutation. Unloading aborts queued lock requests and prevents subsequent
   writes; changing graph or date also stops subsequent writes.
6. Look up the Daily Note by title separately from its children. Reuse an empty
   existing page. For a missing page, use Roam's `dateToPageUid(date)`, check that
   UID, create the page, and read its UID back before inserting the component.
7. Reserve `nautilus-log-plan-YYYY-MM-DD` for the one-click component. Check it
   before insertion and append with `order: 'last'`. An occupied or moved UID
   is never overwritten or bypassed with another UID. This also protects a new
   session when a prior write is visible by UID but not yet in the day query.
8. Read back against the frozen target date, including when a mutation succeeds
   and then throws. There is no automatic second insert. An explicit retry
   rechecks the same reserved UID and today's Primary Plan.
9. If midnight passes during an in-flight insert, confirm the original date and
   report the date change; do not insert on the new day. A page created just
   before midnight may remain empty if the block write is stopped. Never delete
   user content to repair partial outcomes or duplicates.

The capacity bar returns only from confirmed plan data. Refresh or navigation
failure after a confirmed write does not authorize another insert.

## Performance and lifecycle

With execution off, only the launcher and create/open command are mounted. There
is no timing runtime, LOGBOOK reader, CLOCK writer, 1s ticker, or execution panel.
Changing the setting swaps the existing control rather than mounting a second
one. A failed runtime start restores the lightweight launcher.

With execution on, background discovery consumes existing runtime snapshots and
plan-watch results. Unchanged second ticks do not query the graph, inspect the
template again, notify today-plan subscribers, or rebuild the popover. Missing
or previous-day snapshots remain `checking`, not `ready-absent`.

Read-only recovery is bounded to initialization, throttled foreground/focus
(1.5 seconds minimum), local midnight, and explicit actions. A date mismatch can
request the existing runtime's coalesced refresh. There is no graph scan on
keystrokes or DOM mutations, and no new per-second graph reader.

A manually inserted `;;` plan is found at the next applicable recovery or action;
instant detection on every edit is not promised. Every create action rechecks
first, so a stale create label does not by itself authorize another component.

## Verification and platform limits

Automated verification uses mock Roam APIs and isolated browser fixtures, not a
user graph. It covers independent sessions/modules, graph changes, unsupported
locking, malformed reads, UID collisions, uncertain writes and reloads, midnight,
unload, execution toggles/start failure, timer visibility, responsive layout,
dark themes, and reduced motion.

```bash
npm test
npm run build
python3 test/energy-bar-settlement.py
python3 test/today-plan-launcher.py
npm audit --omit=dev --audit-level=moderate
git diff --check
```

Live Roam validation is still needed for Desktop Web Locks availability, native
page/block mutation behavior, and cross-client UID conflict handling. Web Locks
coordinate participating tabs in the same browser origin, not separate devices,
profiles, or unrelated manual writers. The reserved UID is an additional guard,
not a claim of a distributed transaction. Unsupported APIs or occupied UIDs fail
closed; the native template remains the fallback.
