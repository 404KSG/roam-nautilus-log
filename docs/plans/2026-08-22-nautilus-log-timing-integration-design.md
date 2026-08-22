# Nautilus Log timing integration design

Date: 2026-08-22  
Status: approved by 404KSG

## Outcome

Nautilus Log replaces the separate Roam Logbook extension as the daily planning
and execution surface. The spiral remains the transparent estimated schedule;
an optional execution layer adds one real `CLOCK`, task switching, recent
Threads, a shared Pomodoro cycle, and one-click completion. Dashboard, Activity,
whole-graph Today queries, hierarchy rollups, and analytics are not included.

Actual Time Tracking defaults to off. While off, Nautilus mounts no topbar
trigger, popover, timer polling, timing commands, or CLOCK mutation handlers.
Existing CLOCK records may still be read when rendering historical work. Turning
the feature off while a clock is active must first close and confirm that clock;
on failure the setting remains enabled.

## Primary plan

The first Nautilus Log component in the current day's Daily Note, in Roam tree
order, is the only Primary Plan. References, embeds, breadcrumbs, right-sidebar
replicas, and later Nautilus instances do not compete for ownership. Later
instances remain visual planners only.

The Plan tab reads only unfinished direct-child TODO blocks of the Primary Plan.
It preserves Roam order and is flat: no hierarchy, expansion state, or bulk
collapse controls. Fixed events and DONE blocks are excluded. The component
prefix defaults to `[[Nautilus Log]]`, making instances searchable and
recognizable. The default chart range is 05:00–21:00.

## Topbar and popover

When timing is enabled but idle, a native Blueprint 3 `ring` icon is mounted in
Roam's left navigation cluster. While timing, the trigger becomes the live
elapsed value plus the recent Thread count. The compact popover has two views:

- **Timing** — the one Focused Timing Line plus distinct recently switched
  tasks from the fixed 45-minute return window.
- **Plan** — the Primary Plan's flat unfinished task list.

The former Dashboard action becomes a Blueprint `locate` action. It closes the
popover, opens the Primary Plan in the main window, scrolls it into view, and
briefly highlights it. There is no Dashboard or statistics surface.

Each Plan row has one title, duration metadata, a Play/Timing action, and a
Complete action. Complete is one click. If the row owns the running CLOCK, the
same timestamp closes the clock before the TODO marker is changed to DONE.
Mutation progress remains visible until the graph confirms the result.

## Timing and duration semantics

The graph remains the source of truth. Sessions use the compatible structure:

```text
{{[[TODO]]}} Task 30m
  - LOGBOOK::
    - CLOCK: [2026-08-22 Sat 10:00]--[2026-08-22 Sat 10:18] => 0:18
```

Exactly one CLOCK may be open. Starting another task closes the current interval
and opens the next at one action instant. Reload restores a valid open CLOCK;
legacy overlaps choose the newest as Focused and close older intervals at the
Focused start when safe. DONE completion closes the task's running clock.

Estimated duration continues to drive future scheduling. CLOCK time is factual
history and execution status; it does not silently replace future estimates.
Surfaces show `Actual` when today's valid CLOCK time exists and fall back to
`Planned` when it does not. Detail text may show both values.

The Pomodoro cycle spans seamless task switches. It starts with the first
Focused task, keeps the configured threshold, turns the elapsed value red at
the threshold, and never closes a CLOCK automatically. Confirmed Clock Out
resets the cycle.

## Data flow and safety

1. Read today's page tree and choose the first component deterministically.
2. Read its direct children to build Plan.
3. Read LOGBOOK drawers to derive Focused, Threads, Actual totals, and recovery.
4. Serialize every mutation through one queue.
5. Re-read the graph after each write before publishing UI success.

Read uncertainty never becomes an empty graph. A failed switch may leave the
old clock closed but must not claim the new clock started. A failed completion
keeps the row visible with a retryable notice. Two timing extensions must not
write simultaneously: when the legacy Roam Logbook runtime is detected,
Nautilus refuses to enable timing and asks the user to disable the old plugin.

## Verification

Pure tests cover CLOCK parsing and formatting, Primary Plan selection, flat Plan
projection, recent Thread derivation, duration labels, Pomodoro continuity, and
single-clock switching. Lifecycle tests prove that the default-off state mounts
no topbar or commands, while enable/disable cleans up every listener and timer.
Mutation tests cover close-before-switch, completion ordering, graph uncertainty,
and failure preservation. Browser-shape tests cover Blueprint icon classes,
stable action columns, narrow popover layout, keyboard labels, focus restoration,
and the locate action.
