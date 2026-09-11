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
2. Click **+ Create today's plan** in the topbar, or run
   **Nautilus Log: Create or open today’s plan**. It targets today's Daily Note
   even when you are viewing another page and copies the complete managed
   Nautilus template tree, including ordinary nested children, then opens it.
   One normal click is enough—no panel, confirmation, or manual `;;`.
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

Open Nautilus Log settings and click **Connect Google Calendar** to authorize
your own account with read-only access. The row then reports **Connected ·
Read-only · Primary calendar + Google Tasks**, and the Blueprint Calendar
control appears in the chart. Roam Desktop opens the real Google page in the
system browser and returns automatically to the waiting settings row. The
Calendar control performs a manual sync for the clicked Nautilus date; it never
polls Google in the background or creates Daily Notes.

Timed Calendar events become fixed events. Dated Google Tasks become flexible
TODO/DONE rows. They omit a visible duration and inherit the current configured
Default Todo Duration because Google's public Tasks API exposes a due date, not
a reliable time interval. Add an explicit duration such as `30m` only when a
task needs an override. Imported parent rows carry a quiet `· Google Calendar`
source suffix; the chart removes that suffix from labels. Normal click preserves
Roam text you changed, but restores a removed source suffix.
Option/Alt-click force-refreshes Google-managed strings while leaving
user-created children alone. All-day, free/transparent, and declined events are
ignored. Nautilus normally restores the connection after a Roam reload; users
never create or paste OAuth client IDs, secrets, or Calendar IDs. Google data is
requested directly by the Roam client and never passes through the lightweight
authorization service. Imported `Open` links preserve Google's original event
target and prefer the connected Primary account when the browser has several
Google sessions.

See [Google Calendar sync](./docs/google-calendar-sync.md) for the block shape,
authorization, scopes, merge rules, and [privacy contract](./PRIVACY.md).

## Optional Execution Layer

A 30px topbar control and one command can create or locate today's Primary Plan
even while the Execution Layer is off. That launcher does not start CLOCK
writes, a 1s ticker, or the execution popover. One-click insert freezes and
copies the complete managed renderer root and ordinary descendant tree with
fresh UIDs; internal block references are remapped and external references stay
intact. It does not copy yesterday or alter the source template. Ambiguous
multiple roots, unsafe top-level template siblings, or unreadable dynamic
content fail closed and let you open the template to review it. Existing legal
Nautilus renderers on today's Daily Note, including empty or all-DONE plans,
are locate-only. Creation requires a confirmed graph identity and Web Locks;
failed reads offer a read-only check, never an automatic insert.

**Creation incomplete** opens diagnostics and verified-block counts. **Inspect
created blocks** never clears that status. **Continue creation** is available
only to the original in-memory operation after checking every written block;
reloads can verify/open, never resume from a changed template. A graph/date-scoped
SHA-256 receipt contains destination identifiers and hashes, not template text.
LOGBOOK/CLOCK history and unsupported properties are refused before template writes.
Before writing, midnight stops the action; after writing starts, the frozen original
day is completed and reported without being shown as today's ready plan.

Enable **Execution Layer · Advanced** in Settings when you want more than visual
planning. The compact topbar panel provides:

- **Timing** for the current CLOCK and recent tasks.
- **Plan** for today's scheduled and unscheduled work.
- **Review** for Planned versus Actual results.
- **POMO** for independent count-up focus without writing a CLOCK.

Switching tasks closes the previous CLOCK before starting the next. Graph-scoped
Web Locks coordinate CLOCK writes across tabs in the same browser storage partition;
see the guide for synchronization limits. CLOCK takes priority over POMO and can
keep the active task at the top of Roam's right sidebar. An additional default-off
**Show capacity as an energy bar** setting can replace the ordinary topbar token
with a two-level time-capacity gauge: one layered track above a left-aligned
`% left · planned duration` summary. The two rows fold around the Roam topbar
centerline, where CLOCK/POMO timing remains centered to the track's right. The
Execution Layer defaults to off, so estimate-only planning stays light.

See the [user guide](./docs/guide.md) for settings, commands, syntax, history
rules, and safety boundaries.

## Local verification

```sh
npm test
PYTHONDONTWRITEBYTECODE=1 npm run test:ui
```

The browser suites require an existing Python Playwright installation and Chromium.
They use synthetic local fixtures, not a live Roam graph. The real-session suite
executes the actual source reader, session, mutation adapter, and both launchers
over a low-level graph that rejects duplicate UIDs. It checks full-tree single-click
creation, partial/reload recovery, navigation, tooltip bounds, and timer priority;
screenshots/results go to `/tmp/nautilus-real-today-plan`. The refinement suite covers
cross-midnight labels, minute-level capacity consistency, keyboard focus, and scroll
continuity. Runtime tests cover cross-tab CLOCK coordination and unload cancellation.
See the [refinement design](./docs/plans/2026-09-09-execution-refinement-design.md)
for the bounded scope and acceptance criteria.

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
