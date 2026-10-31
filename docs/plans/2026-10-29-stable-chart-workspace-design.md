# Nautilus: honest time geometry and readable controls

## Current decision

Revised October 31, 2026. The latest four corrections take precedence over the earlier
single-line tip, labeled Desk switch, indigo/gold palette and all-records-in-SVG rule:

- The tip prioritizes the title; metadata must not squeeze an ordinary title into an ellipsis.
- Desk shows only its slider, with a hover/focus label.
- Categories are red urgency, bright-orange events and blue tasks.
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

The frame keeps a 12-unit top inset and 8-unit bottom inset. Native embeds may already
outdent their host; compare with that baseline rather than adding global padding, overflow
or negative-margin compensation. Narrow views retain side labels, major hour ticks and a
compact center date. Hour sizing remains explicit in SVG output.

## Tip and control layout

The closed tip has two rows in a stable 44px slot. Its 42px content places the 12px/16px title
across the whole first row after the tone dot. The second row contains 11px/14px metadata
and an intrinsically sized More action with at least a 24px hit height. More uses nowrap,
normal word breaking and its actual text width, not a fixed 24px column. The panel remains
at most 280px wide, with 16px narrow-container insets.

Ordinary titles that fit the title row are complete. Text exceeding that width, or extra
metadata, exposes More. Expanded text stays in normal page flow and is never internally
scrollable. Pointer, focus and pinned expansion remain distinct owners; changed or removed
records, Eye, folding and unload invalidate stale detail. The tip never covers the plot or Desk.

The Desk switch has a 40×32px hit area, a 28×16px track and 12px thumb travel. There is no
visible name span. Its `aria-label`, `role=switch` and `aria-checked` remain, while the existing
hover/focus tooltip supplies the visual label without wrapping. The real Desk binding owns
checked state through registration, start, close, preferences and remounts. Keyboard focus
is visible; Space/Enter, existing Alt navigation, focus return and reduced motion are retained.
No second React state or new preference is introduced.

## Category colors and native Desk

Legend/category colors are Urgent `#ea0f0f`, Event `#f97316`, and Task `#0899c8`. Light-theme
text uses darker family members (`#c2410c` for events, `#087b9f` for tasks) for readability;
legend dots do not reuse these darker text tokens. Events use orange rather than gold fills,
and tasks use blue rather than purple. Completion stays neutral gray, explicit urgency
continues to override ordinary fill, and no title gets a deletion line.

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
hover/focus labels, computed category colors and readable title contrast. Preserve default
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
