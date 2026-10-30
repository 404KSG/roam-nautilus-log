# Stable chart workspace

## Decision

Nautilus Log keeps the original spiral as the overview. User feedback rejected the large
side/bottom inspector, so the current presentation uses one slim local context rail below
the chart. It is hidden when idle and never becomes a separate panel. The stable-frame
fix remains; the rejected large-inspector layout is not retained as a second mode.
No Linear assets, fonts, or branding are used. The next approved refinement adopts
Linear's restrained hierarchy rather than its artwork: quiet solid fills, finer outlines,
horizontal hour labels, readable completed labels without strikethrough, and short solid
leaders that retain the connection between names and sectors.

Completed content belongs in the chart even when Desk excludes it. Untimed completions
use a named list below the chart, not a count in the center and not an invented time slice.

## Presentation contract

- `chartPresentationFrame({ containerWidth })` is the presentation seam. It returns
`330 × 300` through 360px, `560 × 400` through 520px, and `720 × 420` above 520px.
Each container-keyed frame and center stays fixed across time/content/hover changes;
the interface never accepts events, labels, clock time, or pointer coordinates.
- The context rail is centered and capped at 400px, with a 16px inset on either side
when the local workspace is narrower. Its width does not depend on the selected title.
It is 32px tall, or 40px through 520px. Its idle state has no visible background, heading
or instructions. A reserved small slot keeps hover/focus geometry stable.
At 520px and below external SVG labels are omitted; Schedule and the rail retain full content.
- The compact Overview reserves a separate chevron column. Through 360px its four
summary groups occupy a fixed 48px, two-row grid; clock changes do not make it wrap
under the control or change height.
- Overview label allocation and painted text share actual font measurement, including
maximum focus weight and padding. Ordinary short labels remain whole; only genuinely long
labels are ellipsized. Labels that exceed the finite rail capacity do not expand the frame;
the full title remains available on its segment and in the context rail.
- Details are local to the workspace, use the same record for hover and focus, and scroll
horizontally for long text without opening a tall region. New selections reset the scroll. Timeline details never portal to `document.body`, use fixed
positioning, or depend on pointer or viewport coordinates.
- Shell resizing clears stale details. Unmount cleanup still disconnects observers and timers.

## Completion projection

`partitionChartEvents` separates pending rows, timed DONE rows, and untimed DONE rows.
It preserves outline order and local wrapper identity. Every DONE UID remains available
to Tidy, but only pending rows reach scheduling and capacity. `historicalDoneSlice` still
refuses to manufacture an interval; neither current time nor edit time is a fallback.

The named untimed list is present in main, sidebar and embedded contexts. Its reserved
64px slot contains a 16px heading and two 24px rows, with internal scrolling for more
records. The empty slot has no visible panel or text. This small allocation preserves
flow geometry when an item becomes DONE or receives usable CLOCK evidence. Full titles
and reference provenance remain available through the same local context rail.

The eye control explicitly applies to the chart's timed and untimed completed records,
not Desk. Its default is visible. Desk retains its independent pending-task projection.
No custom navigation keys are added; item click/Enter/Shift reuse existing task routing.

## Safety and verification

Scheduling, capacity, Actual/CLOCK, calendar, graph-write gates, task click/Enter/Shift
routing, and native Desk behavior remain outside this presentation seam. The actual
Scittle/Reagent gate evaluates the current `component.cljs` bytes, compares clock-driven
rectangles at fixed local width, covers local width variants, themes, reduced motion and
synthetic sparse/dense/CJK/empty plans, and rejects graph writes, page errors, and HTTP(S)
requests.

The original renderer reproduced variable SVG/flow geometry and a moving body tooltip.
Historical diagnostic artifacts are optional evidence, not inputs to the permanent test gate;
current-source acceptance also runs in a source-only copy without Git history.
