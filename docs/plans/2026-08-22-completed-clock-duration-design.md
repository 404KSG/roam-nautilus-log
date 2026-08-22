# Completed CLOCK Duration Design

## Outcome and semantics

Nautilus Log keeps the spiral as a compact work-allocation view rather than a
forensic session timeline. An unfinished flexible task continues to use its
Planned duration because elapsed Actual time does not describe remaining work.
Once the task is DONE, the historical slice chooses one duration source:

1. Sum every valid CLOCK interval that overlaps the displayed Daily Note date.
2. If that sum is positive, use it as Actual duration.
3. Otherwise fall back to the original Planned duration or configured default.

Multiple CLOCK sessions remain separate in `LOGBOOK::`, but the spiral condenses
their total into one contiguous slice. The slice ends at the explicit `dHH:MM`
completion marker when present; otherwise it ends at the latest valid CLOCK end.
Its start is `end - chosen duration`. Actual is never capped by Planned. Invalid
or open CLOCK entries are ignored for a DONE slice; Nautilus Log already closes
the focused CLOCK before its own Complete action marks a task DONE.

This is intentionally a duration summary anchored at completion, not a claim
that the user worked continuously during that interval.

## Data flow and boundaries

The existing Timing reader remains the only parser for Org-style CLOCK records.
The extension exposes a read-only entry snapshot to the renderer: it reuses the
active Timing runtime snapshot when available and performs one graph read when
tracking is currently disabled. The Clojure renderer reads that snapshot once
per reactive direct-child evaluation, not once per task.

`log-core.js` owns the pure date-clipping and aggregation rules. It receives a
task UID, CLOCK entries, and the displayed day boundaries, then returns total
minutes, session count, and the latest end minute. `historicalDoneSlice` chooses
Actual before Planned and returns the selected source. The renderer attaches
that metadata to the completed event while continuing to draw one existing DONE
slice. No new graph writes, CLOCK rewrites, or visible split-session elements are
introduced.

The displayed Daily Note determines the day boundary. A session crossing
midnight contributes only its overlap with that date; sessions entirely outside
the date contribute nothing. This prevents carried tasks from importing prior
days of Actual time into today's capacity picture.

## Failure handling and verification

If the CLOCK snapshot cannot be read, the chart must still render from Planned
duration. Missing task UIDs, malformed dates, invalid intervals, open entries,
and zero-minute totals all use the same fallback. A missing explicit completion
marker is no longer fatal when a closed CLOCK provides a reliable latest end;
without either anchor, no historical interval is manufactured.

The public test seams are:

- `completedTaskClockSummary`: sums multiple sessions, clips cross-day sessions,
  excludes open/invalid/out-of-day entries, and returns the latest end minute.
- `historicalDoneSlice`: prefers Actual, falls back to Planned, permits Actual to
  exceed Planned, and refuses to invent an unanchored slice.
- Renderer contract: reads one CLOCK snapshot per child-list evaluation and
  passes Actual duration plus the latest CLOCK end into the historical slice.

Full unit tests, the compiled renderer contract, production webpack build, JSON
validation, and Roam Depot Draft PR build must all pass before release.
