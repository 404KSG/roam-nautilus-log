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
   session and the timing runtime before the execution panel opens or
   navigation runs. The same UID remaining on today keeps ordinary panel and
   locate behavior. A silent-recovery create or locate already handled by
   `ensureToday` does not open the execution panel or navigate again. Read
   failure, blocked template, and incomplete receipts open diagnostics /
   Check again; they do not open a stale panel or locate. Check again stays
   read-only. CLOCK/POMO keep stop priority. Pending keep completions are
   dropped after a later topbar action, popover close, or destroy.

## Acceptance seam

`test/today-plan-recreate.test.js` drives the real watch bridge, timing runtime,
and session against the UID-keyed host graph, including preflight clock
advancement, a moved reserved root plus a manual replacement, and a second
session's incomplete receipt. `test/real-today-plan.py` clicks the actual
launcher and execution buttons, including Daily Note read failure and
replacement-plan keep. `test/test-host-locks.cjs` supplies the existing
`exclusiveLocks()` fixture to CLOCK tests; it does not change production
locking. These are isolated fixture tests, not live Roam Pull Watch or
installed-extension evidence.
