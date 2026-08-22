# Daily Review Design

## Product scope

Nautilus Log adds a lightweight `Review` tab beside `Timing` and `Plan`. It is
not a persistent dashboard and does not add another chart beneath the spiral.
The view answers one daily question: which tasks differed from their estimates,
and by how much?

Review is scoped to the current Primary Plan on today's Daily Note. It lists
all direct-child flexible tasks in original Roam order, including completed,
running, paused, untracked, and not-started work. Fixed events are excluded
because their calendar ranges are commitments rather than task estimates.

The summary compares only completed tasks with positive same-day CLOCK time.
This keeps both sides of the comparison on the same population:

- `Completed`: completed tasks / all review tasks.
- `Compared`: completed tasks with valid Actual time.
- `Planned`: estimates for the compared tasks only.
- `Actual`: same-day CLOCK totals for those same tasks.
- `Variance`: Actual minus Planned; positive means more time than estimated.

Running and paused work remains visible at row level but cannot affect final
variance. Missing CLOCK history displays `Not tracked`, never `0m`.

## Data model and flow

`timing-core.js` owns two pure public seams. `projectReviewTasks` projects every
direct-child TODO or DONE from the existing Primary Plan query. `buildDailyReview`
joins that projection with the existing CLOCK snapshot, clips Actual to today,
classifies each task, and returns rows plus the comparison summary.

`readPrimaryPlan` returns both unfinished `tasks` for Plan and `reviewTasks` for
Review from the same Daily Note rows. The Timing runtime builds `dailyReview`
inside its existing refresh; opening Review issues no additional graph query.
The topbar renders the model only when the Review tab is active.

The one-second runtime tick must not rebuild the Review DOM. The existing
execution structure key ignores changes to `now` until graph data changes.
During a stable tick, the topbar updates only the focused task's live Actual
label. Final summary values remain stable because live tasks are intentionally
excluded from completed comparisons.

## Interface

The existing popover header becomes `Timing | Plan | Review`. Review starts
with a compact two-line summary followed by ordered task rows. Each row shows
title, state, Planned, Actual, and final variance when comparable. Task titles
retain the existing navigation behavior: click opens in the main window and
Shift+Click opens in the right sidebar.

States are `Compared`, `Live`, `Paused`, `Not tracked`, and `Not started`.
Variance uses restrained emphasis: over-estimate values may use muted orange,
while under-estimate values remain neutral. The interface does not judge saved
time as success or extra time as failure.

If no Primary Plan exists, Review uses the existing missing-plan message. If
the plan has no direct-child tasks, it shows an empty Review message. Invalid
or out-of-day CLOCK records contribute nothing and never block the panel.

## Verification

Tests cover the public seams and user-visible contract:

1. Review projection includes ordered TODO and DONE direct children but excludes
   fixed events and nested tasks.
2. Daily Review correctly classifies all five row states, clips CLOCK time to
   today, and computes summary totals only from comparable completed tasks.
3. Runtime exposes Review using its existing plan and CLOCK reads.
4. Execution keys distinguish Review but remain stable across one-second ticks.
5. The compiled popover exposes the Review tab, summary, task navigation, and
   live text hook without introducing a new graph read.

Full unit tests, production webpack build, diff validation, and the Roam Depot
Draft PR build must pass before handoff.
