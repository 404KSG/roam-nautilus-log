# Complete in-diagram chart

## Current decision

The user rejected the footer inventory and scroll-based context rail after seeing them
in the real UI. That rejection supersedes the earlier named-list decision. Every titled
source task or event must have its own visible diagram mark and connected SVG label.
A count, hidden accessibility node, footer row or label-budget omission is not a substitute.

The original time spiral remains the signature. The current visual direction uses crisp
neutral ink, indigo emphasis, readable completion states and restrained outlines, informed
by Linear's published product imagery and design principles. No Linear logo, artwork,
downloaded font or endorsement is part of the product.

## Presentation seam

`src/chart-scene.js` owns `chartScene` and `chartPresentationFrame`, re-exported through
`src/log-core.js` for the existing renderer bridge. It is a pure presentation module with
no graph, scheduler, clock, storage or mutation API.

- The full source collection determines label measurements and frame height. The changing
  scheduled subset, pointer and clock do not size the frame.
- Ordinary labels wrap in the SVG. Balanced wrapping avoids isolated CJK final characters.
  Pathological titles retain their full accessible text and an explicit full-text action.
- Wide views use side columns; narrow views use two connected columns within the same SVG.
  No source UID is dropped when a label track fills. Source title/collection edits may
  change the frame; clock progression and completion visibility do not.
- The plot keeps a container-keyed scale and reserves 20 drawing units beyond the maximum
  time radius: an 8-unit gap and a 12-unit non-temporal track. The scale does not depend
  on the current count of unplaced records.
- Each connector has its own route and a short terminal segment outside the text box.
  Compact routing arcs stay above the label area. The label audit checks both text overlap
  and sampled leader intersections with other labels.

## Truthful record projection

`partitionChartEvents` retains pending, timed-DONE and untimed-DONE collections for their
existing domain roles. Every completed local UID remains available to Tidy; Desk still
uses its independent TODO-only projection.

`chartScene` joins the full source set with the actual scheduling result:

- Available timed intervals use the original time geometry. Actual, fixed ranges, pending
  plan ranges and completion-estimate ranges retain their distinct provenance.
- Untimed DONE has an individual outlined index segment and a label, with no clock claim.
- Pending work that cannot fit, including after END, has a dashed outlined segment and
  an estimate, not an invented range.
- Fixed or completed ranges outside the displayed hours remain visible in the index track;
  details retain the original range while the index angle makes no time claim.
- Index slots follow the full stable eligible source order, not the currently unplaced
  subset. One mark spans at most 32 degrees; it cannot become a near-full progress ring.
- Index positions never enter `scheduleTasks`, `calculateCapacity`, Actual or CLOCK.
  Source completion timestamps are not borrowed for today's reference wrapper.

The red current-time needle remains inside the temporal spiral. The center shows the
original date and in-range current time, never a misleading global “completed” caption.
Narrow plots wrap the date when needed rather than shrinking it to illegible text.

## Details and interactions

The local context area is centered, capped at 400px and inset by 16px in narrow containers.
Its closed 64px slot supports a two-line title and compact metadata; idle has no visible
box, heading or instructions. There is no horizontal or vertical internal scroller.

Full text is an explicit operation. It expands content in normal page flow and pins that
record while reading; hover cannot replace the expanded text. Closing returns to the
fixed slot. Status, time, provenance, removal, eye-toggle, folding and unload invalidate
stale ownership. Pointer, focus and explicit expansion are separate owners of one detail
record. Existing task click/Enter/Shift routing is reused; no navigation keys are added.

The old footer inventory and compact scrolling Schedule are not rendered. Overflow remains
a compact status count; its tasks are already represented in the diagram.

## Verification and limits

The production-source SCI/Reagent gate checks exact evaluator-input hashes, source UID
coverage, visible mark/label pairs, all ordinary titles at realistic density, non-temporal
time claims, source-stable slots, frame stability through END and true overnight windows,
reference/CLOCK updates, long-text expansion, pointer/focus cleanup, main/sidebar/embed,
Chinese, default/native styles and computed light/dark contrast. It rejects graph writes,
page/console/resource errors and unexpected HTTP(S).

Native embed CSS itself outdents a standalone host by 116px. The fixture records that host
before the chart mounts and checks that Nautilus adds no page overflow and has no local
overflow. It does not mask the native rule with production padding or overflow hacks.

Explicit long-text expansion can scroll the page to its button. Tests compare the diagram's
size and document-flow coordinates rather than mistaking viewport scrolling for resizing.
Private screenshots, signed URLs and native assets are not shipped. Synthetic/native-style
results do not certify a fresh authenticated Desktop reload or every custom theme.
