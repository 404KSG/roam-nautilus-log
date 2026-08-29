# Nautilus Log

> **Give every minute a job.**

A visual day planner for Roam Research. Nautilus Log turns one Daily Note into
a living spiral schedule: fixed events stay fixed, flexible tasks flow into the
time that remains, and overload never disappears from view.

**English** · [简体中文](./README.zh-CN.md) · [User guide](./docs/guide.md)

![Nautilus Log visual day planner with Timing, Plan, Review, and right-sidebar views](https://raw.githubusercontent.com/404KSG/roam-nautilus-log/main/docs/assets/nautilus-log-overview.png)

## What it gives you

- **A plan that fits time.** See Planned demand, Available time, fixed Events,
  remaining capacity, and work that cannot fit today.
- **Flexible scheduling without a black box.** Events keep their time; unfinished
  tasks move forward in Roam block order.
- **A day shaped around you.** Start at any whole hour and continue past midnight
  when the plan belongs to a late or overnight schedule.
- **Low-friction execution.** Work from estimates alone, run a standalone POMO,
  or optionally track tasks with compatible `LOGBOOK::` / `CLOCK:` records.
- **A useful daily review.** Compare Planned and Actual time without leaving your
  ordinary Roam blocks.

Scheduling is deterministic: events claim their ranges first, then whole tasks
fill suitable gaps from the current moment. Tasks that cannot fit appear in
**Today won't fit** instead of being silently dropped.

## Quick start

1. Install **Nautilus Log** from Roam Depot. While an update is under review,
   use the ShortHand shown in that Depot pull request.
2. On today's Daily Note, type `;;` and choose **Nautilus Log**.
3. Add fixed events and TODOs as direct children.
4. Order the tasks and give each one a rough duration.

```text
05:00-06:00 Morning routine
{{[[TODO]]}} Write project brief 45m
{{[[TODO]]}} Review notes 30m
11:45-12:30 Lunch
```

Durations support `30m`, `30min`, `1h`, and `1h30m`. Untimed tasks use the
configured default.

## Optional Google Calendar sync

Enable **Google Calendar · Optional** to import timed, busy events into the date
of the Nautilus chart you clicked. The Blueprint Calendar control performs a
manual, read-only sync; it never polls in the background or creates Daily Notes.

Normal click preserves Roam text you changed. Option/Alt-click force-refreshes
Google-managed strings while leaving user-created children alone. All-day,
free/transparent, and declined events are ignored. Setup requires your own Google
Web OAuth Client ID with `https://roamresearch.com` as an Authorized JavaScript
origin; short-lived access tokens remain in memory only.

See [Google Calendar sync](./docs/google-calendar-sync.md) for the block shape,
OAuth setup, scopes, and merge rules.

## Optional Execution Layer

Enable **Execution Layer · Advanced** in Settings when you want more than visual
planning. The compact topbar panel provides:

- **Timing** for the current CLOCK and recent tasks.
- **Plan** for today's scheduled and unscheduled work.
- **Review** for Planned versus Actual results.
- **POMO** for independent count-up focus without writing a CLOCK.

Only one task CLOCK runs at a time. CLOCK takes priority over POMO, and can keep
the active task at the top of Roam's right sidebar. The Execution Layer defaults
to off, so estimate-only planning stays light.

See the [user guide](./docs/guide.md) for settings, commands, syntax, history
rules, and safety boundaries.

## Credits

- [Nautilus](https://github.com/tombarys/roam-depot-nautilus) by Tomáš Barys—the
  original spiral-planning concept.
- [Nautilus Enhanced](https://github.com/hopeserena/nautilus-enhanced)—the fork
  from which this project developed.
- [Roam Logbook](https://github.com/forrestchang/roam-logbook)—the inspiration
  for compatible CLOCK tracking and focused execution.

The time-allocation philosophy is inspired by the
[YNAB Method](https://www.ynab.com/the-four-rules/). Nautilus Log is not affiliated
with YNAB. Released under the original MIT license.
