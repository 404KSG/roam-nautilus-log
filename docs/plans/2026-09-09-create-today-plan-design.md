# One-click today's Nautilus plan (v1)

## Decision

Add one create-or-locate control in the existing 30px topbar slot. It inserts a
single canonical Nautilus component at the end of the local-calendar Daily Note
when that page has no legal renderer. It is not an auto-daily creator, not a
template copier, and not a renderer reinstall.

## Interface

All callers use `createTodayPlanSession` in `src/today-plan.js`:

- `discover()` — read only
- `ensureToday({ locateMode })` — coalesced create-or-locate
- `locateToday(options)` — open only
- `getState()` / `subscribe()` / `initialize()` / `destroy()`

Lite topbar, execution topbar, Plan empty-state, and one command share this
writer. `timing-topbar.js` still must not call `readPrimaryPlan` or
`readAllEntries`.

## Write gate

1. Same-tab inflight map keyed by page title.
2. Cross-tab `navigator.locks` when present; otherwise a localStorage TTL lock
   (~8s). After lock, re-read before write.
3. Query failure is `read-failed`, never absent.
4. Any legal renderer (current or legacy) is locate-only.
5. Missing page may create today's Daily Note and must confirm the uid before
   inserting a block. Empty pages reuse the existing uid.
6. Confirm by re-read. At most one retry insert. Never delete user blocks.
7. Custom templates (`inspectCanonicalTemplate` → extra siblings or render
   descendants) block this path and keep `;;`.

Clicks and the command write. Onload, midnight, and visibility only rediscover.
Midnight never writes. Overnight workday windows do not retarget create.

## Tracking

Execution Layer remains opt-in. Off: lite launcher + create command, no runtime,
no LOGBOOK reads, no 1s ticker, no execution popover. On: existing CLOCK/POMO
topbar consumes the same session; a running timer is never replaced by the
create label (Plan empty-state keeps the CTA). After create, tracking refresh
reattaches Pull Watch and the capacity / 136×6 energy bar returns.

Discovery does not add a 1s graph lane. Tracking-on background reads the runtime
snapshot; create click always re-reads. Tracking-off discovers on initialize,
throttled visibility (≥1.5s), local date change, midnight timeout, and click.

## Unverified APIs

These have fallbacks and are not treated as guarantees:

- `navigator.locks` in Roam Desktop
- `roam.data.page.create` vs `roam.createPage`
- whether a new Daily Note already has a blank child (`order: 'last'` is still
  used; blanks are not deleted)
- same-UID create behavior
- `roamAlphaAPI.graph.name` lock scoping (v1 keys by page title; residual
  cross-graph web risk remains)

Without `navigator.locks` and without `localStorage`, two tabs can still
double-insert. Confirm-by-re-read then locates whichever Primary exists and does
not delete the extra block.

## Verification

```bash
npm test
npm run build
python3 test/energy-bar-settlement.py
python3 test/today-plan-launcher.py
git diff --check
```

Do not run `build.sh` (it includes `npm ci`) unless install is required.
No Depot/PR, no real Roam graph, no commit/push.
