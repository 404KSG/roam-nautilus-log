# Stable chart workspace

## Decision

Nautilus Log keeps the spiral as the daily overview and places its detail in one local,
fixed workspace region. This supersedes the wide floating tooltip and the compact overlay
rail. It is an original Nautilus interpretation of restrained, information-dense product
surfaces; it does not use Linear assets, fonts, or branding.

## Presentation contract

- `chartPresentationFrame({ containerWidth })` is the presentation seam. It returns
`330 × 300` through 360px, `560 × 400` through 520px, and `720 × 420` above 520px.
Each container-keyed frame and center stays fixed across time/content/hover changes;
the interface never accepts events, labels, clock time, or pointer coordinates.
- At local widths of 840px and above, the workspace has a 236px side detail region. Below
that threshold it has a 112px bottom detail region. At 520px and below external SVG labels
are omitted; the Schedule and detail region retain full readable content.
- The compact Overview reserves a separate chevron column. Through 360px its four
summary groups occupy a fixed 48px, two-row grid; clock changes do not make it wrap
under the control or change height.
- Overview labels are bounded to fixed rails. Labels that do not fit are omitted
chronologically with their connectors instead of changing the SVG frame.
- Details are local to the workspace, use the same record for hover and focus, and scroll
internally for long text. Timeline details never portal to `document.body`, use fixed
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
