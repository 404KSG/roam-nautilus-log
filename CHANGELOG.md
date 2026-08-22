# Changelog

## Unreleased — Nautilus Log v1

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

### Fixed

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
- Right-sidebar renders avoid chart work and reserve no visible space.
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
