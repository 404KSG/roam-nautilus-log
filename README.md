# Nautilus Log

> **Give every minute a job.**

A transparent visual day planner for Roam Research. Nautilus Log places fixed
events and flexible tasks on one spiral timeline, so you can see what fits before
the day gets away from you.

**English** · [简体中文](./README.zh-CN.md) · [User guide](./docs/guide.md)

![Nautilus Log visual day planner with Timing, Plan, Review, and right-sidebar views](https://raw.githubusercontent.com/404KSG/roam-nautilus-log/main/docs/assets/nautilus-log-overview.png)

## See the whole day, not just a list

A to-do list tells you what matters, but not whether it fits. Nautilus Log turns
today's Daily Note into a living time plan:

- **See capacity before committing.** Planned demand, remaining time, overload, and
  work that will not fit stay visible.
- **Keep structure without becoming rigid.** Events stay fixed while unfinished
  tasks flow forward around them in Roam block order.
- **Connect estimates with reality.** Plan with low-friction estimates, then
  optionally compare Planned with `LOGBOOK::` / `CLOCK:` Actual time.
- **Stay inside Roam.** Focus, task switching, timing, completion, and daily Review
  remain connected to ordinary Roam blocks.

## One workflow, three layers

1. **Block commitments.** Write meetings, meals, and routines as fixed ranges.
2. **Timebox intentions.** Order flexible TODOs and give each one an estimate.
3. **Review reality.** Optionally record Actual time and improve future estimates.

The scheduler is deterministic: fixed events claim their ranges first, then complete
tasks fill suitable gaps from the current moment. Unfinished work moves forward
without changing priority. Anything that still cannot fit appears in **Today won't
fit** instead of disappearing. No AI estimates and no black-box scheduling.

## Quick start

1. Install **Nautilus Log** from Roam Depot.
2. On today's Daily Note, type `;;` and choose **Nautilus Log**.
3. Add events and TODOs as direct children of the component.
4. Order the tasks, add rough durations, and adjust until the day fits.

```text
05:00-06:00 Morning routine
{{[[TODO]]}} Write project brief 45m
{{[[TODO]]}} Review notes 30m
11:45-12:30 Lunch
```

Durations use minutes: `30m`, `90m`, or `30min`. Untimed tasks use the configured
default duration.

## Execution Layer—when you want it

The optional **Execution Layer** defaults to **off**, so estimate-only planning
stays light. Enable it in Settings to add a compact execution panel:

- **Timing** shows the current task and recently closed work.
- **Plan** shows unfinished tasks from today's Primary Plan.
- **Review** compares valid Planned and Actual results for the day.

Only one CLOCK runs at a time. Clock In can place the active task at the top of
Roam's right sidebar, keeping focus and task switching close to native Shift+Click.

See the [full user guide](./docs/guide.md) for syntax, metrics, settings, commands,
Actual-history rules, and safety boundaries.

## Credits and inspiration

- [Nautilus](https://github.com/tombarys/roam-depot-nautilus) by Tomáš Barys—the
  original transparent spiral-planning concept.
- [Nautilus Enhanced](https://github.com/hopeserena/nautilus-enhanced)—the enhanced
  fork from which this project developed.
- [Roam Logbook](https://github.com/forrestchang/roam-logbook)—the inspiration for
  compatible CLOCK tracking and focused task execution.

The time-allocation philosophy is inspired by the
[YNAB Method](https://www.ynab.com/the-four-rules/). Nautilus Log is not affiliated
with YNAB. Released under the original MIT license.
