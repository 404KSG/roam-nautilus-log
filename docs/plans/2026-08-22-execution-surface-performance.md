# Nautilus Log execution-surface performance and interaction design

## Outcome

The optional Actual Time Tracking surface should feel as immediate as Roam's own topbar. Opening the panel must show the last confirmed snapshot before any graph read; switching Timing and Plan must only switch cached DOM; the one-second clock tick must update text rather than rebuild the task list.

The interaction model keeps the useful Roam Logbook behavior without restoring its Dashboard:

- Clock In immediately asks Roam to open or move that task to order 0 in the native right sidebar while the CLOCK mutation is confirmed independently.
- The focused row uses Blueprint's `log-out` action as the explicit Clock Out control.
- task titles open in the main window; Shift+Click opens them in the right sidebar.
- command-palette actions expose Focus current block, Clock out Timing Line, and Locate Primary Plan so users can assign their own Roam hotkeys.
- TODO block context menus expose Clock In and Clock Out.
- all of these surfaces are registered only while Actual Time Tracking is enabled and are removed when it is disabled.

## Performance model

The runtime retains one confirmed snapshot. The popover renders that snapshot immediately and schedules a deduplicated graph refresh after the browser has painted. Periodic graph refresh is also scheduled as idle work rather than being performed inside the one-second tick.

Every snapshot has a structural signature that excludes `now`. A structural change may rebuild the visible list; a normal tick updates only the topbar elapsed value and the focused row's live metadata. Tab selection itself performs no graph read.

## Safety and verification

Clock writes remain serialized and retain read-after-write confirmation. Right-sidebar navigation is reversible UI feedback and never makes a failed CLOCK mutation look successful. The sidebar adapter preserves unrelated windows, deduplicates the target block, and moves or creates only the selected task at order 0.

Tests cover the tick-stable structural signature, immediate cached popover contract, right-sidebar Clock In intent, command registration/cleanup, global Clock Out, and the full existing suite.
