# Nautilus Log User Guide

[Back to README](../README.md) · [简体中文](./guide.zh-CN.md)

## Plan format

Add fixed events and flexible tasks as direct children of a Nautilus Log component.
Their Roam block order is the task priority.

```text
05:00-06:00 Morning routine
{{[[TODO]]}} Write project brief 45m
{{[[TODO]]}} Review notes 30m
11:45-12:30 Lunch
```

- A time range is a fixed event.
- A direct child without a time range is a flexible task; TODO is optional and
  DONE excludes the task from today's execution.
- Durations support `30m`, `30min`, `1h`, and `1h30m`.
- Untimed tasks use **Default Todo Duration**.
- **Urgent Trigger Word** changes a task's color, not its scheduling order.
- A bare block reference inherits its source TODO/DONE. Add an outer TODO to
  explicitly redo completed source content today.
- A duration written after the reference overrides the source duration. Source
  completion time and CLOCK history are never inherited.
- Legacy `dNN%` text has no scheduling meaning. Nautilus Log keeps it as ordinary
  block text and always schedules the full estimate.

## Scheduling rules

1. Fixed events claim their written time ranges.
2. Pending direct-child tasks are read in Roam block order.
3. Starting at the current moment, complete tasks fill the next continuous gaps large
   enough for them.
4. Time passing moves unfinished work forward without changing priority.
5. Tasks that cannot fit before the configured end enter **Today won't fit**.

The scheduler is deterministic and does not generate estimates. A task remains atomic:
if it cannot fit one gap, it moves to the next suitable gap instead of being split.

## Header metrics

| Metric | Meaning |
| --- | --- |
| Planned | Remaining flexible-task demand; `left` percentage = `current free time ÷ full-day Available` |
| Remaining | Available time left after Planned demand |
| Overload | Demand beyond available time |
| No fitting slot | Time exists in total, but no continuous gap can hold an atomic task |
| Available | Flexible time remaining now / full configured-day flexible time |
| Events | Fixed-event time remaining now / full configured-day event time |

Overlapping events are counted as a union, so one minute is never counted twice. The
small flame marks whether the current minute is consuming Available or Event time.

## Visual language

- Red: urgent task
- Yellow: fixed event
- Blue: flexible task
- Red needle: current time
- Muted completed/event slices: recorded past
- Hatched past slice: elapsed time without a recorded item

Past gaps are factual schedule data, not a judgment that time was wasted.

## Chart controls

- **Eye:** show or hide completed items.
- **Calendar:** after Google Calendar reports Connected in Settings, import
  timed busy events and dated Google Tasks for this chart's Daily Note.
  Option/Alt-click force-refreshes only the Google-managed strings.
- **Tidy:** move completed tasks and elapsed fixed events to the front while
  preserving the exact relative order of active work. Tidy moves direct-child
  wrappers by UID, never changes task text, times, references, or descendants,
  and offers one Undo unless the Plan is edited again first.
- **Collapse:** hide this chart instance while keeping its plan blocks visible.

Hover or keyboard-focus a task/event slice to see its exact range and duration. Click
a flexible task slice or its compact Schedule row to scroll to that block without
changing the graph; Shift-click or Shift-Enter opens it in the right sidebar. If a
collapsed target is not rendered, Nautilus Log falls back to Roam's official block
navigation. Future blank slots show the same preview on wide charts. Compact sidebar
charts omit hover tooltips and keep the Schedule section folded to avoid clipping and
visual noise.

## Execution Layer

The optional Execution Layer defaults to **off**. Its advanced settings remain hidden
until enabled. While it is off, Nautilus Log still mounts a 30px today-plan launcher
and one create-or-open command, but it loads no execution panel, 1s ticker, CLOCK
writer, or LOGBOOK reader.

Click **+ Create today's plan** (or the command) to append a frozen copy of the
single managed Nautilus renderer root and its complete ordinary descendant tree
to the local-calendar Daily Note, regardless of the page you are viewing. Every
new block receives a new UID; references inside that tree are remapped and
external references remain unchanged. Any recognized Nautilus renderer already
on that page, including an empty or all-DONE plan, is locate-only. Multiple roots,
top-level template siblings, dynamic/unreadable content, or unavailable required
fields fail closed and offer an open-template review action. Nothing is created
on load or at midnight.

Loading, confirmed absence, unsupported templates, partial writes, and failures
have separate states. **Check again** only rereads; a navigation failure only
retries opening. Creation requires a known graph, Web Locks, and an opaque
settings-backed structural operation record. Occupied identifiers are never
overwritten, a complete-tree readback is required for success, and an unconfirmed
or partial write never triggers an automatic second insert. A date or graph change
stops subsequent writes rather than retargeting the action.

No new per-second graph queries are added. With execution on, discovery reuses
runtime data; with it off, checks occur at initialization, throttled foreground,
midnight, and explicit actions. A manually inserted template is found at the next
check, not by scanning on every keystroke.

When Execution Layer is enabled, the first Nautilus Log on today's Daily Note becomes
the **Primary Plan** used by the topbar panel. After a successful create, the existing
capacity text or 136×6 energy bar returns and the plan is opened in the main window.
If CLOCK/POMO is already running without a plan, its timer and applicable stop
controls stay visible; use the create button in the panel's **Plan** empty-state.

Click the Nautilus topbar trigger to open the panel, Option/Alt-click it to locate
the Primary Plan in the main window, or Shift-click it to open or bring the same
block to the top of Roam's right sidebar.

| View | Purpose |
| --- | --- |
| Timing | Current Timing Line and recently closed tasks |
| Plan | Unfinished direct-child tasks from the Primary Plan |
| Review | Today's Planned, Actual, and valid variance states |

Switching tasks closes the previous CLOCK and opens the next at the same instant.
Before starting, Nautilus checks running CLOCKs rather than trusting a tab's cache.
Graph-scoped Web Locks serialize CLOCK writes across tabs in the same browser storage
partition, and notifications prompt other tabs to reread the graph. Missing graph
identity or Web Locks blocks CLOCK mutations. These locks do not coordinate other
profiles or devices, nor guarantee that Roam has finished synchronizing their data;
avoid controlling timers concurrently from those environments.
With **Keep Timing Line first in right sidebar** enabled, Clock In also opens or moves
the active task to the top of Roam's sidebar.

In the panel, Left/Right arrows and Home/End navigate the tabs. Structural updates
preserve focus and list position; completing a row moves focus to a surviving task
or the selected tab. Escape closes the panel and returns focus to its trigger.
Plan times after midnight include an explicit **next day** label.

### Optional capacity energy bar

Enable **Show capacity as an energy bar** to replace the ordinary one-line
topbar token with a borderless two-level depth gauge. Its fixed 136×6px capsule
has fully rounded ends and no border, shadow, or decorative end structure. The
track sits above the topbar centerline, while the lower row is one left-aligned
phrase such as `42% left · 3h20m planned`. The two rows fold symmetrically around the
centerline. While CLOCK or POMO runs, its timer and stop control remain centered
on that line instead of aligning to the track:

- the same gray-blue as Roam's right-side toolbar icons is flexible reserve
  after all unfinished demand;
- lighter sea green is unfinished planned demand reserved within today;
- the quieter cool-gray track is flexible capacity that has elapsed;
- `OVER +Xm` or `NO SLOT Xm` appears once in the lower summary, using the
  existing warning color without duplicating the warning on the track.

Every width uses the full day's flexible capacity as its denominator. Fixed events
remain excluded, untimed work uses Default Todo Duration, and the clock contracts
the bar once per minute without another Roam read or timer. In energy mode, the open
panel uses the same projection; time-only updates preserve task action nodes.
Text-only mode retains its existing cached projection. Confirmed completion
from the panel keeps the exact planned reading visible, confirms that number in
place, and settles both track layers on one short width transition. A failed write
changes nothing; external TODO/DONE or duration edits redraw silently without a
completion cue. This is a time-capacity display, not a measure of physical or
mental health. In full
density the gauge itself is the clickable trigger, so the leading Nautilus icon
and divider disappear. Missing capacity data or constrained space restores only
the icon, leaving no detached bar or status text beside Roam search.

### Referenced task ownership

- A bare `((source TODO))` keeps its TODO/DONE state in the real source block.
  Completing it from Nautilus Log changes that source TODO to DONE; its CLOCK remains
  under today's direct wrapper so Actual still belongs to today.
- An explicit outer `TODO ((source))` owns today's state. Completing it changes only
  the outer marker and never rewrites the reusable source.
- A bare reference whose source was already DONE is absent from Plan and Review. If
  the source becomes DONE after today's wrapper recorded Actual, Review keeps that
  wrapper as today's completed work.
- Nested reference chains follow the nearest explicit TODO/DONE owner. Nautilus Log
  watches only the exact sources used by the Primary Plan; it does not add a graph-wide
  status scan.

Recent retention defaults to 45 minutes. The Pomodoro threshold defaults to 45
minutes and changes the live signal without stopping work. When no task CLOCK is
active, the panel-header stopwatch starts a standalone count-up POMO. It writes no
Roam blocks and does not affect Actual, Planned, Review, or the spiral; starting a
task CLOCK clears it because CLOCK always has priority. While standalone POMO is
running, the same panel-header action becomes **Stop POMO**, so it remains available
even when a narrow topbar shows only the Nautilus icon. Completing another task does
not stop the currently focused CLOCK or reset its Pomodoro cycle. The forgotten-timer
warning defaults to 120 minutes and never stops or deletes a CLOCK. Enter `0` to disable
Recent or the forgotten-timer warning.

## Planned and Actual history

- Unfinished tasks are scheduled from Planned estimates.
- Completed flexible tasks prefer total valid same-day Actual time.
- Multiple CLOCK sessions remain separate in `LOGBOOK::`, while the spiral combines
  their total into one historical slice.
- Actual time is never capped at Planned time.
- Without Actual, Planned history requires an explicit completion anchor such as
  `d18:21`.
- Without an Actual end or completion anchor, Nautilus Log does not invent history.
- For an overnight chart window, next-day CLOCK time remains part of the owning
  Daily Note until that window ends.

Todo Trigger is optional. Its completion timestamp can supply the `dHH:MM` anchor,
but ordinary planning and completion do not require it.

## Settings

| Setting | Default |
| --- | --- |
| Language | English |
| Chart Start Time | 05:00 |
| Chart End Time | 21:00 |
| Component Prefix | `[[Nautilus Log]]` |
| Legend Max Length | 22 |
| Default Todo Duration | 15 minutes |
| Urgent Trigger Word | Empty |
| Google Calendar | Not connected; Primary calendar after connection |
| Execution Layer · Advanced | Off |
| Show capacity as an energy bar | Off |
| Keep Timing Line first in right sidebar | On |
| Pomodoro Threshold | 45 minutes |
| Recent Retention | 45 minutes; `0` disables |
| Forgotten Timer Warning | 120 minutes; `0` disables |

Component Prefix is display-only text for newly inserted components. It may be
changed or left empty; Primary Plan detection follows Nautilus Log's stable
renderer identity instead of this label.

Chart start can be any whole hour from 00:00–23:00. Chart end can be 01:00–24:00;
an end hour at or before Start is explicitly labelled **next day**. For example,
21:00–02:00 is one continuous 300-minute window owned by the Daily Note where the
component appears. Existing templates keep working and the default remains
05:00–21:00.

Execution-specific settings are revealed only while **Execution Layer · Advanced** is
enabled.

Google Calendar is configured through one visible connection row: click
**Connect**, choose your Google account, and approve read-only Calendar and
Tasks access. Connected state and **Disconnect** remain visible in Settings;
users never enter developer credentials or Calendar IDs. Each chart click reads
only the selected date; there is no timer, background poll, or seven-day
prefetch. Timed Calendar events remain fixed; dated Tasks are imported as
flexible TODO/DONE rows with the configured Default Todo Duration. See
[Google Calendar sync](./google-calendar-sync.md).

## Commands

The Command Palette exposes:

- **Nautilus Log: Create or open today’s plan** (always available)
- **Nautilus Log: 1. Focus current block** (Execution Layer on)
- **Nautilus Log: 2. Clock out Timing Line** (Execution Layer on)
- **Nautilus Log: 3. Locate Primary Plan** (Execution Layer on)

Bind them in **Roam Settings → Hotkeys**. TODO context menus also expose Clock In and
Clock Out while tracking is on.

## Data and safety

Actual time is stored as compatible Org-style graph data:

```text
{{[[TODO]]}} Task 30m
  - LOGBOOK::
    - CLOCK: [2026-08-22 Sat 10:00]--[2026-08-22 Sat 10:18] => 0:18
```

Disable the separate Roam Logbook extension before enabling Actual Time Tracking;
Nautilus Log refuses to start a second CLOCK writer. Multiple charts may exist on a
page, but only the first chart on today's Daily Note becomes the execution panel's
Primary Plan. Breadcrumb and collapsed-path replicas skip expensive chart rendering;
right-sidebar views use the compact chart with a folded Schedule section. Unloading
the extension does not rewrite or delete user blocks.
