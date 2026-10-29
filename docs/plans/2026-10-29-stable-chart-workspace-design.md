# Stable chart workspace

## Decision

Nautilus Log keeps the original spiral as the overview. User feedback rejected the large
side/bottom inspector, so the current presentation uses one slim local context rail below
the chart. It is hidden when idle and never becomes a separate panel. The stable-frame
fix remains; the rejected large-inspector layout is not retained as a second mode.
No Linear assets, fonts, or branding are used.

## Presentation contract

- `chartPresentationFrame({ containerWidth })` is the presentation seam. It returns
`330 × 300` through 360px, `560 × 400` through 520px, and `720 × 420` above 520px.
Each container-keyed frame and center stays fixed across time/content/hover changes;
the interface never accepts events, labels, clock time, or pointer coordinates.
- The context rail is 32px tall, or 40px through 520px. Its idle state has no visible
background, heading or instructions. A reserved small slot keeps hover/focus geometry stable.
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
