# Changelog

## Unreleased

### Added

- Chart windows may now start at any whole hour from 00:00–23:00 and end at
  01:00–24:00; an end at or before Start is treated and labelled as next day.
- Overnight events, capacity, elapsed time, hover slots, and the current-time
  needle share one continuous timeline owned by the plan's Daily Note.

### Changed

- Spiral depth is based on hours elapsed from the configured start, preserving
  the default 05:00 profile while keeping pre-05:00 and next-day sectors visible.

## 1.0.2 — 2026-08-23

### Added

- The optional Execution Layer now includes a standalone count-up POMO for
  estimate-first work: start it from the panel header, monitor `elapsed · POMO`
  in the topbar, and close it directly without creating a task CLOCK.
- Standalone POMO restores from its absolute start after navigation or refresh,
  reuses the configured Pomodoro threshold, and marks only its live text red
  after the threshold while continuing to count upward.

### Fixed

- Standalone POMO and task CLOCK are strictly mutually exclusive: CLOCK always
  wins a same-tick race, Clock In clears POMO first, and restored stale POMO
  state is removed when an active CLOCK already exists.
- Per-second standalone POMO ticks update only the compact topbar signal; they
  do not query the Roam graph or rebuild Timing, Plan, or Review.

## 1.0.1 — 2026-08-23

### Fixed

- Historical Daily Notes now render the configured workday as elapsed, keep
  their unrecorded time hatched, and expose no actionable Available-slot hover
  targets, current-time needle, or burning-capacity marker.
- The Execution Layer now resolves direct block-reference tasks with the same
  semantics as the spiral, so task demand, remaining capacity, and no-fitting-slot
  status agree between the popover and chart.

## 1.0.0 — 2026-08-22

### Added

- Rebranded, isolated Nautilus Log render/template/runtime identifiers.
- Configurable chart start (05:00–08:00) and end (18:00–24:00) boundaries.
- Capacity header showing available time, remaining fixed-event occupancy, task
  demand, and overload/remaining slack.
- Dashed expandable list for tasks that do not fit before the selected end time.
- Compact red/yellow/blue dot legend for urgent items, events, and tasks.
- Per-instance collapse state, playback state, and clock state for multiple renders.
- Responsive compact layout, measured label truncation, past-time fading, and
  reduced-motion support.
- Compact schedules start folded when a Nautilus Log block is focused in the
  right sidebar, while remaining user-toggleable afterward.
- Fresh installs and existing preview installs default to English once; Chinese remains
  available from Language settings and is preserved after it is selected.
- Optional Actual Time Tracking, defaulting off with no topbar, poller, commands,
  or CLOCK writes until explicitly enabled.
- The optional Execution Layer is now a prominent advanced entry in Settings;
  dependent execution options stay hidden until the master switch is enabled.
- A Blueprint-native topbar execution surface with Timing and flat Primary Plan
  tabs, one-click task completion, `unresolve` idle state, and `locate` navigation.
- A compact `unresolve · Nautilus` identity in the popover header exposes the
  Primary Plan navigation target without adding another row.
- The identity itself now locates the Primary Plan and advertises that action with
  a persistent chevron plus hover/focus feedback; the redundant right-side locate
  icon is removed.
- The Nautilus identity hover surface is now a complete rounded rectangle with an
  independent, evenly spaced divider before the Timing and Plan tabs.
- Compatible Org-style `LOGBOOK::` / `CLOCK:` persistence, serialized single-clock
  switching, numerically configurable recent Threads, and a shared configurable
  Pomodoro threshold.
- Numeric Recent-retention and forgotten-CLOCK warning settings, including 0 to
  disable either behavior, live Recent time-left labels, and a distinct long-running
  CLOCK warning state.
- A focused-row `trash` control with two-click confirmation deletes only the current
  open CLOCK; all task-completion actions use Blueprint's `confirm` icon.
- Actual/Planned row metadata and deterministic selection of the first Nautilus
  Log component on today's Daily Note as the one Primary Plan.
- Default component prefix `[[Nautilus Log]]` and default chart range 05:00–21:00.
- Shortcut-ready Command Palette actions and TODO context-menu actions for Clock
  In, global Clock Out, and Primary Plan navigation.
- Optional native right-sidebar fronting for the current Timing Line, enabled by
  default whenever Actual Time Tracking is on.
- Completed flexible tasks now condense all valid closed CLOCK sessions for the
  displayed date into one completion-anchored Actual slice; Planned remains the
  fallback, and cross-midnight sessions are clipped to the day.
- A lightweight daily Review tab lists all Primary Plan tasks, distinguishes
  live/paused/untracked states, and compares Planned with Actual only for the
  completed tasks that have same-day CLOCK history.
- A compact execution-panel capacity strip keeps Available plus the current
  Remaining, Overload, or No-fitting-slot result visible across all three tabs.
- Plan now separates deterministically scheduled work from a folded Unscheduled
  today section, including projected time ranges and section duration totals.
- Direct slice and keyboard focus now reveal one compact tooltip with the item
  type, exact time range, and duration; future blank regions expose equivalent
  Available slot information without adding persistent chart labels.

### Fixed

- Planned progress is now applied exactly once in both the spiral and Execution
  Layer, so a `60m d50%` task consistently occupies 30 minutes.
- The renderer and Execution Layer now share one tested parser for `30m`, `30min`,
  `1h`, `1h30m`, and fixed time ranges, including localized warning codes.
- Routine CLOCK refreshes now query only Primary Plan, focused, and Recent task UIDs;
  the full LOGBOOK scan is reserved for startup compatibility reconciliation.
- Clock In and task switching mutate cached CLOCK state and confirm only the changed
  block instead of scanning unrelated graph history.
- Pomodoro restoration no longer performs an unawaited settings write, eliminating
  stale-clear races during rapid task changes.
- Mounted charts recompute whether they represent today's Daily Note after midnight.
- The Execution Layer now follows the English/Chinese language setting, including
  tabs, capacity, task metadata, Review states, controls, and accessibility labels.

- Wide-layout timeline tooltips now anchor outside the spiral, measure before
  appearing, escape chart clipping through a body-level portal, and flip or
  shift within the browser viewport; compact layouts mount no hover surface.
  Their SVG center and radial direction now share one coordinate contract, so
  left-side evening items expand outward instead of back across the spiral.
- The decorative spiral grid no longer intercepts pointer events, so hovering
  the actual task or event slice behaves the same as hovering its outer label.
- Expanding or folding Unscheduled today no longer makes the focused Plan row
  alternate between its projected interval and the live Timing label.
- Execution-panel capacity metrics now keep the normal UI typeface across Roam
  themes by matching the rendered chart metrics; the metrics sit together on
  the left, and Unscheduled rows no longer draw a decorative left rail.
- Timing, Plan, and Review lists retain scrolling without exposing native
  scrollbar chrome inside the execution popover.
- Compact right-sidebar Overview metrics stay adjacent instead of being spread
  across the row; only the disclosure arrow remains right-aligned.
- DONE blocks no longer cause identical Roam writes.
- Midnight-crossing events are clipped at 24:00 and shown in a warning panel.
- Fragmented free time is distinguished from aggregate overload.
- Flexible task titles and connector lines now use one semantic blue while
  adjacent task slices retain their subtle fill variations.
- Unload no longer rewrites or deletes graph content.
- Right-sidebar renders use a compact chart with folded schedule details; breadcrumb
  and collapsed-path replicas avoid chart work and reserve no visible space.
- Template and code scaffolding updates are idempotent and Log-only.
- Render scaffolding is created sequentially so delayed Roam writes cannot race
  ahead of their parent blocks.
- Disabling time tracking closes and confirms active CLOCK records before removing
  the entire execution surface; failure preserves the enabled state.
- Legacy overlapping open CLOCK records reconcile to the newest focused task.
- The execution popover now paints cached state before graph refresh, schedules
  periodic graph scans as idle work, and updates only elapsed text on each tick;
  Timing/Plan switching no longer competes with per-second full DOM rebuilds.
- The focused task restores the explicit Blueprint `log-out` Clock Out control,
  and Clock In restores the Roam Logbook-style right-sidebar interaction.
- Planned and Remaining now occupy the first metric row, with Available and Events
  together on the supporting capacity row.
- Clock In starts native sidebar navigation before graph validation; confirmed
  windows preview immediately while an authoritative queued pass preserves dedupe.
- Clock In now gives Roam's native sidebar a browser task to paint before any
  synchronous graph validation, warms the sidebar-window cache read-only after
  startup, and reuses the confirmed CLOCK/Primary Plan snapshots instead of
  rescanning the full Daily Note at the end of the click path.
- Clock In now preserves Roam's synchronous `getWindows`/`addWindow` fast path
  in the original click stack and never waits for the sidebar-open animation;
  older hosts retain a deduplicated wait-and-retry fallback.
- CLOCK Out and task switching confirm the one changed CLOCK block by UID rather
  than rescanning every LOGBOOK drawer between mutations.
- The execution panel updates only action availability during a queued mutation,
  and unchanged installation polling no longer invalidates every rendered chart.
