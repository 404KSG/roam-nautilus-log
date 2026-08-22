# Nautilus Log

> **Give every minute a job.**

A transparent visual day planner for Roam Research. Nautilus Log combines fixed
events, flexible tasks, and optional Actual time tracking in one daily workflow.

**English** · [简体中文](./README.zh-CN.md)

## Plan in time, not only in lists

A to-do list tells you what matters, but not whether it fits. A calendar protects
fixed commitments, but becomes rigid when every flexible task must be placed by
hand. A timer records reality, but usually starts after the planning decision.

Nautilus Log connects all three. It turns a Daily Note plan into a spiral timeline,
moves unfinished work through the remaining gaps, and makes overload visible before
the day breaks.

### Why Nautilus Log

- **See whether the day fits.** Planned demand, remaining capacity, fragmented gaps,
  and work that will not fit stay visible.
- **Keep structure without losing flexibility.** Events stay fixed while unfinished
  tasks flow forward around them in Roam block order.
- **Connect intention with reality.** Start with low-friction estimates, then
  optionally compare Planned with compatible `LOGBOOK::` / `CLOCK:` Actual time.
- **Stay inside Roam.** Focus, task switching, timing, completion, and daily Review
  remain connected to ordinary Roam blocks.

## The model

| Layer | Representation | Method | Purpose |
| --- | --- | --- | --- |
| Commitments | Fixed time ranges | Time blocking | Protect immovable events and routines |
| Intentions | Ordered tasks with estimates | Timeboxing | Give flexible work a visible cost and place |
| Reality | Optional `CLOCK:` sessions | Actual tracking | Learn how long completed work really took |

Use Planned time alone for a light daily practice. Enable Actual Time Tracking only
when the feedback is worth the extra interaction.

## Quick start

1. Install **Nautilus Log** in Roam.
2. On today's Daily Note, type `;;` and choose **Nautilus Log**.
3. Add fixed events and TODO tasks as direct children of the component.
4. Put flexible tasks in the order you want them attempted.
5. Adjust their estimates until the plan fits—or consciously accept the overload.

```text
05:00-06:00 Morning routine
{{[[TODO]]}} Write project brief 45m
{{[[TODO]]}} Review notes 30m
11:45-12:30 Lunch
13:00-13:30 Nap
18:00-19:00 Yoga + shower
```

- A range such as `11:45-12:30 Lunch` is a fixed event.
- `{{[[TODO]]}} Review notes 30m` is a flexible task.
- Durations use minutes: `30m`, `90m`, or `30min`.
- An untimed task uses **Default Todo Duration**.
- The optional **Urgent Trigger Word** colors a task red without changing its order.

## How the spiral schedules the day

1. Fixed events occupy their written ranges.
2. Unfinished direct-child TODO tasks are read in Roam block order.
3. From the current moment, each complete task enters the next gap large enough for it.
4. As time passes, unfinished tasks move forward without changing priority.
5. Work that cannot fit before the configured end time appears in **Today won't fit**
   instead of disappearing.

The rules are deterministic: there is no AI-generated estimate or black-box scheduler.
The spiral shows the cost of your plan; it does not claim to measure human energy.

## Optional Actual Time Tracking

Actual Time Tracking defaults to **off**. While disabled, the visual planner works
entirely from estimates and loads no execution panel, timer poller, commands, or CLOCK
writer.

When enabled, the Blueprint-native topbar provides:

| View | Purpose |
| --- | --- |
| Timing | Current Timing Line and recently closed tasks |
| Plan | Unfinished direct-child tasks from today's Primary Plan |
| Review | Today's Planned, Actual, and valid variance states |

The first Nautilus Log on today's Daily Note becomes the panel's **Primary Plan**.
Only one CLOCK runs at a time; switching closes the previous task and starts the next
at the same instant. Clock In can place the active task at the top of Roam's right
sidebar, keeping the focus interaction close to native Shift+Click.

For completed flexible tasks, the spiral prefers the total same-day Actual time from
valid closed CLOCK sessions. Multiple sessions remain separate in `LOGBOOK::`, but the
chart condenses their total into one historical slice. Without Actual time, Planned is
used only when an explicit completion marker such as `d18:21` supplies an end anchor.

<details>
<summary><strong>Header metrics and visual language</strong></summary>

| Metric | Meaning |
| --- | --- |
| Planned | Remaining flexible-task demand; percentage = `Planned ÷ Available now` |
| Remaining | Available time left after Planned demand |
| Overload | Demand beyond available time |
| No fitting slot | Time exists in total, but no continuous gap can hold an atomic task |
| Available | Flexible time remaining now / full configured-day flexible time |
| Events | Fixed-event time remaining now / full configured-day event time |

Overlapping events are counted as a union, so a minute is never counted twice. The
small flame marks whether the current minute is consuming Available or Event time.

- Red: urgent task
- Yellow: fixed event
- Blue: flexible task
- Red needle: current time
- Muted completed/event slices: recorded past
- Hatched past slice: elapsed time without a recorded item

Past gaps are factual schedule data, not a judgment that time was wasted.

</details>

<details>
<summary><strong>Settings</strong></summary>

| Setting | Default |
| --- | --- |
| Language | English |
| Chart Start Time | 05:00 |
| Chart End Time | 21:00 |
| Component Prefix | `[[Nautilus Log]]` |
| Legend Max Length | 22 |
| Default Todo Duration | 15 minutes |
| Urgent Trigger Word | Empty |
| Actual Time Tracking | Off |
| Keep Timing Line first in right sidebar | On |
| Pomodoro Threshold | 45 minutes |
| Recent Retention | 45 minutes; `0` disables |
| Forgotten Timer Warning | 120 minutes; `0` disables |

Chart boundaries can be set from 05:00–08:00 and 18:00–24:00. A `24:00` end is
represented as minute 1440 and labelled `0`; cross-midnight events are clipped at the
displayed day's boundary.

</details>

<details>
<summary><strong>Commands, data, and safety</strong></summary>

The Command Palette exposes:

- **Nautilus Log: Focus current block**
- **Nautilus Log: Clock out Timing Line**
- **Nautilus Log: Locate Primary Plan**

Bind them in **Roam Settings → Hotkeys**. TODO context menus also expose Clock In and
Clock Out.

Actual time is stored as compatible Org-style graph data:

```text
{{[[TODO]]}} Task 30m
  - LOGBOOK::
    - CLOCK: [2026-08-22 Sat 10:00]--[2026-08-22 Sat 10:18] => 0:18
```

Disable the separate Roam Logbook extension before enabling Actual Time Tracking;
Nautilus Log refuses to start a second CLOCK writer. Multiple charts may exist on a
page, but only the first chart on today's Daily Note becomes the execution panel's
Primary Plan. Sidebar, breadcrumb, and collapsed replicas skip expensive chart
rendering. Unloading the extension does not rewrite or delete user blocks.

</details>

## Credits and inspiration

Nautilus Log stands on the work of:

- [Nautilus](https://github.com/tombarys/roam-depot-nautilus) by Tomáš Barys—the
  original transparent spiral-planning concept.
- [Nautilus Enhanced](https://github.com/hopeserena/nautilus-enhanced)—the enhanced
  fork from which this project developed.
- [Roam Logbook](https://github.com/forrestchang/roam-logbook)—the inspiration for
  compatible CLOCK tracking and focused task execution.

The broader principle of assigning intention before spending a limited resource is
inspired by the [YNAB Method](https://www.ynab.com/the-four-rules/). Nautilus Log is
not affiliated with YNAB.

Released under the original MIT license.
