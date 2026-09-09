# Execution reliability refinement

## Scope and baseline

Approved on 2026-09-09 for implementation and an independent Grok review.
Baseline: `7504eaab28569a1c920aa84c08854a140b5d2e69`.
This is a bounded refinement of CLOCK coordination, capacity/time presentation,
keyboard continuity, and cancellation. It does not redesign the energy bar,
change task ownership, add calendar automation, or authorize publishing.

## Decisions

- Serialize CLOCK mutations with a graph-scoped native Web Lock, rather than
  trusting each tab's private mutation queue or restricting all execution to
  one permanently privileged window. Revalidate running CLOCKs before starting
  another task, and notify other tabs to refresh after a mutation. Keep normal
  elapsed-time ticks free of graph reads and keep sidebar navigation responsive.
  Missing lock/scope support must not silently claim cross-tab safety. Browser
  locks do not coordinate separate storage partitions, profiles, or devices;
  Roam remains the graph authority, including its synchronization limitations.
- Keep mutation state separate from refresh state. Defer external reads while a
  write is pending, then resume cancelled reads without settling their callers
  with stale data. Revalidate live CLOCKs inside the lock for completion,
  reconciliation, stop, delete, and disable as well as start. Bind stop/delete
  intent to the CLOCK UID visible when clicked; never retarget a stale action to
  a newer CLOCK, even for the same task. Recheck the selected block before delete
  and reread graph state after a partially failed write.
- Use one cached minute-level capacity projection for the energy bar and its
  open panel. Preserve the existing cached text-only mode. Update minute-level
  metadata without replacing every task action or running a graph query.
- Format continuous schedule minutes explicitly: e.g. `23:30–next day 00:30`
  and `next day 00:30–next day 01:30`, with Chinese equivalents. Do not truncate
  next-day times or change the scheduling algorithm.
- Preserve focused controls and list scroll position across structural updates.
  When a completed row disappears, prefer the corresponding action on the next
  surviving row, then the selected tab. Support standard arrow/Home/End tab
  navigation and restore the trigger on Escape.
- Make runtime initialization idempotent and cancellation-aware. Destroying a
  pending initializer must prevent subsequent subscriptions, timers, commands,
  or DOM mounting. Cancel queued work and close any cross-tab channel on unload.

## Tests and acceptance

The agreed public test surfaces are the existing timing runtime methods,
normalized CLOCK records exposed through snapshots, the pure time formatter,
and the rendered topbar/dialog in an isolated local browser harness. Only the
host Roam API, browser coordination primitives, and time are faked.

1. Sequential and simultaneous starts in two runtime/module instances leave one
   running CLOCK. Same-task retries do not duplicate it; completed history stays
   intact. Graph changes, unavailable capabilities, and queued cancellation fail
   safely. No per-second graph queries or new polling loop is introduced.
2. Runtime initialization destroyed while suspended leaves no interval, watcher,
   or visibility listener; repeat initialize/destroy is safe.
3. Browser tests display correct day offsets, matching topbar/panel capacity,
   stable task action nodes during time-only updates, and retained keyboard focus
   and scroll after mutations or tab changes.
4. Existing Node and browser suites remain green, including task-reference
   ownership, CLOCK/POMO priority, sidebar ordering, warning states, themes,
   reduced motion, and today-plan creation.
5. Build the production bundle, run a focused self-review and an independent
   Grok review of the source/tests/docs diff, and resolve actionable findings.

Validation uses synthetic local data only. No personal Roam graph, OAuth flow,
calendar service, release version, or Depot update is involved. The implementation
commands do not commit or push. The host's separate auto-backup mechanism did
commit and push `c33e112` to the existing feature branch; that external behavior
was verified and disclosed rather than silently changing the host configuration.
