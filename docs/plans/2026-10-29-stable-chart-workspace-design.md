# A single time spiral with complete diagram labels

## Current decision

Revised October 31, 2026. The latest UI request removes excessive chart/tip/Desk spacing
and replaces the Desk icon with a sliding switch. It does not change the estimate rule.
The completion correction still supersedes the earlier A/B decision:
completed tasks without actual timing use their explicit estimate, or Default Todo Duration
(15 minutes by default). Neither CLOCK nor a completion timestamp is required for a slice.
The Completed / No timestamp node and its upper connection band are removed. Last-edit
inference, borrowed source timestamps, the outer track and footer inventory remain rejected.

Nautilus is a changing time budget. Its unequal-radius spiral is the only time geometry.
The red needle is now; fixed events stay anchored; pending whole tasks move through future
continuous gaps in outline order. Pending scheduling, END, capacity, CLOCK writes and
reference ownership remain unchanged.

Every titled source task or event remains visible in the diagram. Counts, hidden accessible
nodes and separate inventories cannot replace its title. The indigo/gold palette is an
intentional design choice, not a claim to use official Linear tokens. No asset or font ships.

## Completed-estimate allocation

`src/log-core.js` owns the pure `projectCompletedEstimates` function. Its public `chartScene`
entry applies that projection before calling the geometry module in `src/chart-scene.js`.
The raw geometry module does not read the graph, write storage or infer timestamps.

1. Keep fixed events and anchored completion intervals unchanged. Local CLOCK totals still
   take precedence over Planned and are not capped at Planned. A local completion stamp can
   anchor an estimate without CLOCK.
2. For each remaining completed flexible task, use `planned-duration`, then its parsed
   duration, then the configured default. A deliberate zero duration remains zero.
3. Allocate whole estimates in source order from START, around fixed events and anchored
   completion intervals. Reuse `scheduleTasks` with temporary explicit-duration copies;
   the copies disable the DONE filter and mark obstacles as fixed. Never mutate originals.
4. Do not use now, source completion timestamps or edit metadata. The allocation stays
   fixed through minute ticks and END. A source/status/range edit may change it.
5. Mark placed records `estimated-allocation`. The tip states the duration and explains
   that the position is estimated, not a recorded completion time. Do not write `doneAt`,
   add Actual, alter pending demand or reserve extra future capacity.
6. If a whole estimate cannot fit before END, keep its title and duration with a capacity
   endpoint. Do not split it, backfill a later short task ahead of it, or extend the day.
   Zero duration and invalid-window inputs have separate explanations, not false overload.

Estimated completion positions can extend beyond now and overlap a pending forecast. This
is intentional: they are not observed history. Gray dashed outlines distinguish them from
solid anchored history. When an estimate overlaps a pending forecast, its gray fill recedes
so the indigo forecast remains visible. A pointer-inert outline layer keeps the estimated
boundary visible without changing source tab order or intercepting navigation.

`partitionChartEvents` still retains the pre-projection pending, anchored-DONE and
unanchored-DONE inputs. Every completed local UID remains available to Tidy. Desk keeps its
independent unfinished-task projection. Estimates never become graph records or Actual.

## Frame and labels

Source titles, source status/ranges, estimated allocations and local width determine the
frame. Each side reserves its fixed labels and static non-time records, plus the full
flexible-title budget for the worst case where pending work moves to one side. It does not
add a second lower band for the same flexible titles. Non-time records occupy the bottom
of their own column; timed labels use the remaining space. This keeps a safe source-sized
upper bound without resizing for a changing scheduled subset.

Non-time glyphs sit just beyond the text's outer edge, away from the clock and time leaders.
They represent unplaced work, genuine completed-estimate overflow or known off-hours ranges.
There is no status node, date-root wiring or outer circular track. The frame retains a 12-unit
top inset and 8-unit bottom inset; no clipping, negative margin or clock-driven crop is used.

Timed labels stay on the same side as their slice, ordered by anchor position. Same-side
curves share routing coordinates; labels never flip across the clock to fill space.
Ordinary titles wrap in full. Balanced wrapping avoids unnecessary Latin word splits and
isolated CJK final characters. Pathological titles retain complete accessible text and an
explicit full-text action.

Narrow containers retain side columns, major hour ticks and a compact center date. Text
measurement uses the SVG font family. Hour text receives an explicit inline font size,
not a CSS variable that SCI/Reagent may fail to emit. The red needle keeps a non-scaling
stroke. Native Desk typography remains independent.

Explicit status, duration, range or local CLOCK edits may change page flow. Clock-only
updates, hover and Eye visibility may not. Eye hides completed records and their estimate
outlines together, without laying out a reduced source collection.

## Materials and wall-clock recovery

Tasks use vivid indigo, fixed events gold, and anchored completion history solid gray-blue.
Estimated completion uses the same gray family with dashed outlines. Elapsed events use
paler gold. Hatching covers past gaps not covered by a task or event interval; it does not
prove idle or wasted time. Pattern IDs remain unique per mounted chart.

Current tasks and events retain stronger fills and outlines. Explicit urgency overrides
ordinary materials. The header keeps three category dots. Completed titles have no deletion
line. The existing detail owner highlights the title, connection and slice or estimate
outline, preserving completion color. Inactive connectors may recede; other text stays legible.

Clock recovery is unchanged: minute ticks, focus, visible-page return, pageshow and owned
CLOCK notifications share one refresh. Epoch-minute comparison handles same-minute next-day
return. Unmount releases all listeners and the timer. Tests follow callbacks through actual
scheduler intervals and SVG paths, rather than relying only on unchanged function bodies.

## Details and preserved interactions

The centered tip fits its content up to 280px, with 16px narrow-container insets. Closed tips
use one 28px row in a stable 32px slot, invisible when idle. Title and summary stay on one
line; clipping or extra metadata exposes More. Full diagram titles are not removed. Explicit
expansion stays in page flow, pins the selected record and has no internal scrollbar or
overlay over following blocks. The Desk root's top embedding margin is 4px; native toolbar,
card geometry and typography remain unchanged.

Pointer, focus and expansion remain separate owners. Changes to time, status, duration,
provenance or presence invalidate stale detail, as do Eye, fold and unload. Existing click,
Enter and Shift navigation is reused. No shortcut is added.

The labeled Desk switch has a 70×32px hit area, 28×16px track and 12px thumb travel. It uses
`role=switch` and `aria-checked`, with click and native button Space/Enter activation. The
existing Desk binding owns checked state; there is no separate React boolean. Registration,
start and close synchronize the current control. Remounted controls replace the binding's
origin for focus return and existing Alt navigation. Reduced motion suppresses the slide.

Desk editing, IME, Escape, drag/import, previews, strict Remove, safe drafts, calendar
integration and the execution layer are unchanged. No global Roam padding, overflow or
negative-margin compensation is introduced.

### Design references

Linear's [2026 refresh](https://linear.app/now/behind-the-latest-design-refresh) emphasizes
retaining information density while making supporting controls quieter and removing needless
boundaries. Its [2024 redesign account](https://linear.app/now/how-we-redesigned-the-linear-ui)
describes alignment, hierarchy and testing across layouts and themes. This change applies
those principles to Nautilus; the dimensions above are our design choices, not Linear tokens.

## Verification and limits

The exact-source SCI/Reagent gate checks default 15-minute and explicit 45-minute slices
without stamps; optional local CLOCK replacing an estimate with Actual; source-reference
ownership; stable estimate positions across clock updates; unchanged pending forecasts;
overlap paint and pointer behavior; and real capacity overflow without title loss.

It also retains source-hash verification, all-title coverage, routing and collision checks,
Eye visibility, hover emphasis, source tab order, narrow hours, unique patterns, END and
overnight stability, full-text ownership, lifecycle cleanup, main/sidebar/embed contexts,
Chinese, default/native styles and computed light/dark contrast. Added checks cover compact
spacing, long-title hover, source-stable shared columns, switch markup/callbacks, and the exact
chart composed with the production Desk controller over the same synthetic rows. A separate
Desk switch gate verifies state, preferences, replacement controls, Alt hints/navigation,
focus return, host isolation and reduced motion. Graph writes, unexpected
HTTP(S), missing resources and page/console errors remain failures. Missing configured
native CSS fails before launching the renderer.

Native embed CSS may outdent its host before Nautilus mounts. Compare against that baseline,
never compensate globally. Explicit full-text expansion may scroll the page; compare document
flow rather than treating scrolling as frame resizing.

Private notes, screenshots, signed URLs and native assets stay outside the repository.
Isolated tests do not certify authenticated Desktop reloads, private host lifecycle,
physical device input or every custom theme.
