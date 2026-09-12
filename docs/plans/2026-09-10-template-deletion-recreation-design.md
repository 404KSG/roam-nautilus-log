# Whole-root deletion and explicit recreation

This note extends
[Full-template one-click creation](./2026-09-10-full-template-creation-design.md).
It does not change CLOCK ownership, integrity receipts, or the one-click copy
contract.

## Problem

After a successful create, deleting the reserved daily root left a ghost plan.
`normalizePlanPull(null, uid)` invented an empty entity, the cheap Plan watch
projected it as ready, and the topbar stayed on the present-plan path. A later
click opened an empty panel instead of creating.

## Repair

Keep the existing data flow. Do not add a timer, DOM observer, or graph-wide
poll, and do not recreate a template in the background.

1. **Read.** A missing Pull is absence. A throw or missing Pull API is
   unavailable. An empty or unsigned entity is not confirmed absence. Only a
   live Nautilus renderer is a usable plan, including an empty or all-DONE
   tree. The bounded root watch also observes root string/identity changes.
2. **Runtime.** A missing or unsigned root cancels any queued cheap projection
   and does one coalesced authoritative Daily Note read. Valid child edits still
   use the cheap Pull path. Explicit recovery passes `rescanPlan` so a cached
   reserved UID cannot hide a newly selected plan on the current day.
3. **Click.** `activateToday` captures one graph/date/host target and, when the
   live plan is missing, freezes the source before the first async boundary,
   then calls an internal `ensureForTarget`. If that original target is no
   longer current before the first write, creation fails with zero template or
   page writes. A later explicit click may create after the UI shows absence.
   If an integrity/receipt check has to await, disappearance after that await
   updates the entry and does not freeze a new source on the same click.
4. **Present plans.** A different live primary plan is published to both the
   session and the timing runtime before the execution panel exposes task actions
   or navigation runs. A neutral checking shell may appear first, without cached
   rows or write controls. The same UID remaining on today keeps ordinary panel and
   locate behavior. A silent-recovery create or locate already handled by
   `ensureToday` does not open the execution panel or navigate again. Read
   failure, blocked template, and incomplete receipts open diagnostics /
   Check again; they do not open a stale panel or locate. Check again stays
   read-only. CLOCK/POMO keep stop priority. Pending keep completions are
   dropped after a later topbar action, popover close, or destroy.

## Responsive opening refinement (2026-09-11)

A normal close is local UI work and cancels any deferred opening, even if the
session is checking or its underlying plan has changed. Pending read completion
cannot reopen the dismissed panel; Escape retains trigger focus.

For idle opening, a single-entity string/page Pull is only a scheduling hint.
When the known renderer is still on the target day, show a checking shell and
wait for a paint opportunity (`requestAnimationFrame` plus a 0ms macrotask)
before the authoritative Primary/receipt check, with a 50ms scheduler budget as
a bounded fallback if that frame path does not finish. This does not promise
that an actual paint always happens first. Never use this hint as creation
authority or expose old rows as confirmed data. A moved or missing root still
takes the synchronous capture path, preserving same-click whole-root recreation.
Loss after the deferred boundary is read-only absence; no new template intent is
frozen or written. Capture graph/date before deferral and revalidate them
afterward.

Reuse a full discovery snapshot only when the receipt read is synchronous and
there is no integrity obligation. An asynchronous receipt read discards that
snapshot and requires a fresh read. Existing partial receipts retain their full
verification. Refresh the runtime's scoped task/CLOCK data before exposing the
confirmed rows, including when Primary keeps the same UID. This prevents a
missed child watch from briefly enabling stale actions. The topbar does not
schedule a second refresh immediately after that confirmed open. These changes
add no polling loop or cross-tab authority.

## Acceptance seam

`test/today-plan-recreate.test.js` drives the real watch bridge, timing runtime,
and session against the UID-keyed host graph, including preflight clock
advancement, a moved reserved root plus a manual replacement, and a second
session's incomplete receipt. `test/real-today-plan.py` clicks the actual
launcher and execution buttons, including Daily Note read failure and
replacement-plan keep. The opening tests hold the frame boundary to assert zero
full Daily Note reads before the shell, one ordinary validation read, and zero
reads on close. They also cover dismissal during receipt waiting, graph changes,
and loss of the plan after deferral. `test/test-host-locks.cjs` supplies the existing
`exclusiveLocks()` fixture to CLOCK tests; it does not change production
locking. These are isolated fixture tests, not live Roam Pull Watch or
installed-extension evidence.
