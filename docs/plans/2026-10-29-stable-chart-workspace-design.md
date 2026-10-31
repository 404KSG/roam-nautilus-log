# Nautilus: honest time geometry and readable controls

## Current decision

Revised October 31, 2026. The latest color decision is red/yellow/blue, with a yellow
Unfinished cue. It supersedes warm orange and purple without changing the integrated
wide-content tips, past-gap inspection, gradient names, queues or icon-only Desk switch:

- Roomy tips show their full current content, wrapping rather than using ellipses. Only a
  compressed local width may use a compact preview and More for clipped text.
- Desk shows only its slider, with a hover/focus label.
- Categories are red urgency, yellow events and blue tasks. Unfinished uses a yellow
  disclosure arrow and readable yellow-family heading.
- Past unfinished work and genuinely unscheduled work belong in a default-collapsed queue,
  not in arbitrary diagram positions. Native Desk masonry is verified and retained.

Completed tasks still use valid local Actual, otherwise an explicit estimate or Default
Todo Duration (15 minutes by default). CLOCK and completion stamps remain optional. No
unrecorded-completion node, date-root wiring or outer status track returns.

The unequal-radius spiral is a finite time budget. Fixed events keep written ranges;
current/future whole tasks fill continuous gaps in source order. The view must not
reconstruct yesterday's unfinished tasks as if their hypothetical placement were history.
No new graph mutation, automatic carry-forward, completion marker or timestamp inference
is authorized by this design.

## Completed estimates

`projectCompletedEstimates` in `src/log-core.js` remains a pure, read-only allocation.
It keeps fixed and locally anchored completion intervals unchanged. Unanchored completed
flexible tasks use Planned, parsed duration or the configured default, in source order
from START around those intervals. The allocator receives temporary copies; originals,
Actual and live pending demand are not changed. No task is split or extended beyond END,
and a later short task cannot overtake an earlier task that does not fit.

Placed estimates use `estimated-allocation`. Their gray dashed outlines and tip distinguish
estimated position from recorded completion time. They can overlap a pending forecast;
the outline remains pointer-inert and the gray fill recedes so blue planning stays visible.
Known local completion stamps and condensed CLOCK totals retain their existing meanings.
Source timestamps and edit metadata are not borrowed. Zero duration stays zero. DONE
estimate overflow keeps its title and duration in the diagram, not in an unfinished queue.

## Pending-work disposition

`chartTaskDisposition` runs after completed-estimate allocation and before the geometry
module. It partitions the existing source records; it does not create or modify graph data.

- **Past:** `timelineDayState.scheduleFromMinutes` is END. The component excludes unfinished
  flexible tasks from planning input and active capacity demand. These tasks appear in
  **Unfinished / 未完成**, with no start/end interval. Fixed events and completed history
  remain visible. Old tasks are not moved to today, marked DONE or timestamped.
- **Today:** the existing scheduler starts at the current cursor. Only tasks with an actual
  scheduled interval enter the diagram. Others appear in **Unscheduled / 未排入**.
- **Future:** scheduling still starts at START; true overflow uses Unscheduled.
- **Undated (`other`):** preserve existing planning rather than treating an unparsed date as past.
- **Overnight:** next-day carryover remains today until the configured logical END. Midnight
  alone must not turn an active overnight plan into an unfinished-history queue.

The queue is below the tip and above Desk. It is absent when empty and collapsed by default.
Opening it exposes full titles and estimates in source order, without an internal scrollbar.
Click/Enter locates the original local UID; Shift opens the sidebar. Eye affects completed
chart records only, not the queue. Changing a task to DONE moves it back to completed-history
handling; DONE estimate overflow never mixes with pending work.

The pending queue and native Desk serve different purposes: the queue explains what is not
on the time axis; Desk remains the user's optional editing surface for unfinished tasks.

## Frame and labels

The frame uses the current diagram members, their source titles/status/ranges and local
width. A source-sized column budget handles their possible sides without reserving a second
empty lower band. Diagram labels remain on the same side as their time anchors; ordinary
labels wrap fully, while pathological text retains an explicit full-text route.

The correct stability boundary is **unchanged diagram membership**. Ordinary minute motion,
hover and Eye preserve the frame. A task can cease to fit before END: for example, a 45-minute
task fits at 19:15 with END 20:00, but not at 19:16. A truthful queue must change then. Queue
membership, day relation or source edits may therefore reflow the diagram. Queue open/close
only changes content below it, not SVG geometry. Tests must not freeze stale placement to
satisfy an obsolete unconditional END/clock assertion.

The frame keeps a 12-unit top inset and 2-unit bottom inset; reducing the empty tail does not move its center, time paths or label positions. Native embeds may already
outdent their host; compare with that baseline rather than adding global padding, overflow
or negative-margin compensation. Narrow views retain side labels, major hour ticks and a
compact center date. Hour sizing remains explicit in SVG output.

## Tip and control layout

`chartTipLayout` combines compact note chrome with width-aware content mode. Above 360px,
`contentMode=full`: natural width is bounded by local workspace width minus 32px, never a
universal 280px cap. Titles and displayed metadata wrap completely, including unbroken strings.
More reveals extra information rather than unlocking a wide-view title.

Normal content is 36px high in a 38px minimum slot, including 2px below it. Padding is 2px
vertical/6px horizontal, column gap 4px, with no extra row gap, a faint border and 4px corners.
The 12px/16px gradient title and 11px/14px metadata share the text column; intrinsic More spans
both rows on the right so its 24px hit height does not inflate the second row. Measurement
uses a 23px content gutter plus action width and a small host-font allowance. Expansion lets
the title span the full row and moves More beside metadata, retaining the same padding.

At 360px or narrower, `contentMode=compact` keeps bounded rows and offers More for clipped
content. Text that fits still remains complete. More uses intrinsic width and nowrap and
must not overlap either text row.

Ordinary short tips retain 36px content and a 38px minimum slot. Full-mode wrapping grows
only the detail region in normal page flow, so following content may move but SVG size and
time geometry do not. Idle tips reserve only the compact slot. This content-driven height
is intentional under the latest completeness request; do not reintroduce a fixed-height
clip or a large empty reservation. Explicit expansion also remains in page flow without
internal scrolling. Pointer, focus and pinned expansion are separate owners; changed or
removed records, Eye, folding and unload invalidate stale detail. Nothing covers Desk.

The Desk switch has a 40×32px hit area, a 28×16px track and 12px thumb travel. There is no
visible name span. Its `aria-label`, `role=switch` and `aria-checked` remain, while the existing
hover/focus tooltip supplies the visual label without wrapping. The real Desk binding owns
checked state through registration, start, close, preferences and remounts. Keyboard focus
is visible; Space/Enter, existing Alt navigation, focus return and reduced motion are retained.
No second React state or new preference is introduced.

## Past-gap inspection and detail names

`pastUnplannedGroups` retains one logical uncovered interval with full range/duration and
hour-split drawing segments. `pastUnplannedSegments` remains the compatible flat geometry
projection. Only elapsed time is inspectable; future availability stays separate. The
neutral explanation says actual activity is unknown, not that the time was wasted.

Hover/focus previews a gap; click or Enter/Space pins it, and Escape dismisses it. Changed
keys invalidate stale selection. Gap hits sit below item records, so task navigation still
wins. Hidden completed estimates remain occupied in the underlying data. No graph reads
or writes are added by inspection.

Only real task/event names receive the static light/dark gradient. Dates, semantic category
dots, metadata and explanatory labels stay unchanged. Forced-color and print modes use solid
text. Gradient styling must coexist with complete wide-view titles and narrow expansion.

## Category colors and native Desk

Legend/category colors are Urgent `#ea0f0f`, Event yellow `#facc15` and Task blue `#3b82f6`.
Light-theme text uses Event `#806600` and Task `#1d4ed8` for readability; dark text uses
`#fde047` and `#93c5fd`. Event fills use `#fef3a6`, with `#facc15` for the current event;
task fills use the blue family. Completion stays neutral gray, explicit urgency still
overrides ordinary fill, and no title gets a deletion line. Detail-name gradients remain
an independent presentation feature, not a replacement for these category colors.

The Unfinished heading uses the readable event-text token and its disclosure arrow uses
the yellow event-category token. Counts and total duration stay muted, expanded task rows
use blue, and Unscheduled keeps its neutral heading. No marker, action or behavior is added.

Masonry remains Roam's measured grid-span layout: four-pixel rows, zero row gap, spans based
on card height plus column gap, and native auto-fill columns. A shorter column can receive
the next card before a tall neighboring card ends. Tile resize/image completion remeasure
spans without reordering DOM or graph data. No CSS columns replacement, equal-height grid,
new column cap or production masonry rewrite is part of this request.

Earlier visual research included Linear's [2026 refresh](https://linear.app/now/behind-the-latest-design-refresh)
and [2024 redesign](https://linear.app/now/how-we-redesigned-the-linear-ui). Their hierarchy and
noise-reduction principles remain useful, but the user's current color and content decisions
are authoritative. These dimensions are Nautilus choices, not official Linear tokens.

## Verification and boundaries

Use exact production CLJS/JS in the isolated renderer. Verify ordinary CJK title width,
More/展开 line count under font and inherited word-break pressure, hidden Desk text with
hover/focus labels, computed category colors and readable title contrast. Add wide content
beyond 280px, automatically wrapped/unbroken text without a title-unlocking More action,
compact expansion, width transitions, unchanged SVG geometry, and yellow Unfinished cues
versus neutral count/total/task rows. Preserve default
15/explicit 45 completion tests, source-reference ownership and optional local CLOCK updates.

Assert every source UID appears exactly once across SVG and queue, with no false pending
history. Cover past demand zero, current/future overflow, a before-END overflow transition,
undated fallback, overnight carryover, queue navigation and default collapse, Eye independence,
completion moving out of the queue, and full long titles after disclosure. Existing live
minute, fixed-event, foreground recovery, same-minute next-day and cleanup gates remain.

Retain real Desk controller/state tests and multi-card masonry geometry, resize, image-load,
IME, Escape, import/drag, previews, strict Remove and all graph-write guards. Queue testing
uses synthetic graph data. Native CSS and private screenshots remain outside the repository.
No dependency, font installation, global rule, network configuration, memory/Wiki record,
merge or marketplace release is introduced. Isolated tests do not certify an authenticated
Desktop reload, private-host lifecycle, physical drag or real clipboard/macro/send behavior.
