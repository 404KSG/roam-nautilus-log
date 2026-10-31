# Nautilus: honest time geometry and readable controls

## Current decision

Revised October 31, 2026. The approved B continuous-shell design replaces the stepped,
hour-sliced presentation. The thin-ribbon alternative was not selected. Task/event title
colors and native controls remain; completion and hover are part of the same design:

- Roomy tips show their full current content, wrapping rather than using ellipses. Only a
  compressed local width may use a compact preview and More for clipped text.
- Desk shows only its slider, with a hover/focus label.
- Categories are red urgency, yellow events and blue tasks. Unfinished uses a yellow
  disclosure arrow and readable yellow-family heading.
- Past unfinished work and genuinely unscheduled work belong in a default-collapsed queue,
  not in arbitrary diagram positions. Native Desk masonry is verified and retained.
- Every timed record is one continuous surface. Diagram labels are title-only, except for
  **Current task** or **Current event** under the corresponding active record. Duration,
  Actual and Estimate stay in Tips.
  Hover/focus emphasizes the surface, leader and colored title together.
- English remains the default UI language; an explicit stored Chinese preference still works.
  Source task titles are never translated or rewritten.

Completed tasks still use valid local Actual, otherwise an explicit estimate or Default
Todo Duration (15 minutes by default). CLOCK and completion stamps remain optional. No
unrecorded-completion node, date-root wiring or outer status track returns.

The unequal-radius spiral is a finite time budget. Fixed events keep written ranges;
current/future whole tasks fill continuous gaps in source order. The view must not
reconstruct yesterday's unfinished tasks as if their hypothetical placement were history.
No new graph mutation, automatic carry-forward, completion marker or timestamp inference
is authorized by this design.

## Continuous geometry

`src/chart-shell.js` is the shared, pure geometry owner. A convex cubic B-spline rounds the
existing radius-control profile. Its C2 shoulders avoid the narrow exact-anchor peak and
second-derivative jumps of the earlier Hermite interpolation. Linear stretches are retained;
control turns are gently rounded without overshooting the control envelope. START, END,
source interval boundaries and the clock-angle mapping remain authoritative, including
overnight logical minutes. This remains an unequal-radius shell, not a circular ring, and
is not claimed to preserve the old stepped pixel area.

`shellInterval` uses bounded five-minute chords with exact range ends and fold/anchor knots.
At the 12-hour fold, both one-sided inner edges are retained; the earlier turn cannot occupy
the later turn's region. Invalid or oversized windows fail closed. The renderer uses this
same geometry for record paint, estimated outlines, past gaps, available hits, the shell
silhouette, ticks and the now needle. Existing hourly helper APIs remain for compatibility,
but do not draw the production chart's internal hour-sector seams.

Each record is one surface rather than one SVG slice per hour. Subtle task/event gradients
are decorative, not new timing data. Definition IDs are unique per mounted chart. Reagent
CSS custom-property keys are strings, so material references reach the actual SVG styles.

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
A completion stamp anchors an estimated interval; it is not CLOCK Actual. Both estimated
allocation and stamped estimate paths keep dashed outlines. Hover must not add a solid
surface stroke beneath that dashed border.
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

Only the active task or event renders its typed indicator: **Current task** or **Current event**.
Other diagram titles have no duration or completion-status sublabel; those details remain complete in Tips and the
accessible record claim. Potentially current unfinished records keep a fixed 14-unit line
allowance so a minute transition cannot resize the frame. Completed and out-of-window
records do not reserve that line. Title leading stays 16/15 units; the indicator uses 10px/9px
text. Compact columns budget the measured localized task/event phrases before sizing the plot,
so the full words fit without abbreviation, clipping or reducing the text size.
The existing label hit area is retained. Only the title ink gets the subtle hover field;
a separate anchor joins the label and its continuous surface.

The correct stability boundary is **unchanged diagram membership**. Ordinary minute motion,
hover and Eye preserve the frame. A task can cease to fit before END: for example, a 45-minute
task fits at 19:15 with END 20:00, but not at 19:16. A truthful queue must change then. Queue
membership, day relation or source edits may therefore reflow the diagram. Queue open/close
only changes content below it, not SVG geometry. Tests must not freeze stale placement to
satisfy an obsolete unconditional END/clock assertion.

Wide views devote up to 336 of their 720 view units to the shell, matching B's larger
surface-to-label proportion. Compact views keep the existing source-aware column budget.
The frame keeps a 12-unit top inset and 2-unit bottom inset; the tail itself reserves no second band. Native embeds may already
outdent their host; compare with that baseline rather than adding global padding, overflow
or negative-margin compensation. Narrow views retain side labels, major hour ticks and a
compact center date. Hour sizing remains explicit in SVG output. In an active window, the
center presents a quiet time readout: the shared UI font with tabular numerals, weight 400,
and the existing theme-aware secondary text color. Cap the clock at 16 CSS pixels while
retaining narrow-view fitting. Keep the date, text anchors, needle and shell geometry unchanged;
there is no secondary clock caption. Native font stacks are used without new font assets.

## Tip and control layout

`chartTipLayout` combines compact note chrome with width-aware content mode. Above 360px,
`contentMode=full`: natural width is bounded by local workspace width minus 32px, never a
universal 280px cap. Titles and displayed metadata wrap completely, including unbroken strings.
More reveals extra information rather than unlocking a wide-view title.

Normal content is 38px high in a 42px minimum slot, including 2px above and below. Padding is 4px
vertical/6px horizontal, column gap 4px, with no extra row gap, a faint border and 4px corners.
Title and metadata use the same 11px/14px text metrics. More's label aligns with the metadata row;
its separate right-hand target stays 24px high rather than stretching over a long title. Measurement
uses the matching 11px title font, 23px content gutter, action width and a small host-font allowance.
Expansion lets the title span the full row and moves More beside metadata, retaining the padding.

At 360px or narrower, `contentMode=compact` keeps bounded rows and offers More for clipped
content. Text that fits still remains complete. More uses intrinsic width and nowrap and
must not overlap either text row.

Ordinary short tips retain 38px content and a 42px minimum slot. Full-mode wrapping grows
only the detail region in normal page flow, so following content may move but SVG size and
time geometry do not. Idle tips reserve only the compact slot. This content-driven height
is intentional under the latest completeness request; do not reintroduce a fixed-height
clip or a large empty reservation. Explicit expansion also remains in page flow without
internal scrolling. Pointer, focus and pinned expansion are separate owners; changed or
removed records, Eye, folding and unload invalidate stale detail. Less keeps the inspected
record as the focused preview and clears pointer state accumulated behind the expanded panel;
it cannot momentarily switch to a different record and remove its own focused button.
Nothing covers Desk.

The Desk switch has a 40×32px hit area, a 28×16px track and 12px thumb travel. There is no
visible name span. Its `aria-label`, `role=switch` and `aria-checked` remain, while the existing
hover/focus tooltip supplies the visual label without wrapping. The real Desk binding owns
checked state through registration, start, close, preferences and remounts. Keyboard focus
is visible; Space/Enter, existing Alt navigation, focus return and reduced motion are retained.
No second React state or new preference is introduced.

## Past-gap inspection and detail names

`pastUnplannedGroups` retains one logical uncovered interval with full range/duration. Each
group now has one continuous shell paint/hit path, rather than separate hour-sector targets.
`pastUnplannedSegments` remains a compatible data projection for older callers. Only elapsed
time is inspectable; future availability stays separate. The neutral explanation says actual
activity is unknown, not that the time was wasted.

Hover/focus previews a gap; click or Enter/Space pins it, and Escape dismisses it. Changed
keys invalidate stale selection. Gap hits sit below item records, so task navigation still
wins. Hidden completed estimates remain occupied in the underlying data. No graph reads
or writes are added by inspection.

Detail names use the same semantic text tokens as the chart: blue tasks, yellow events
and neutral gray completed records. Completed state takes precedence, including completed fixed
events. The gradient and its transparent text-fill rules are removed. Dates, metadata and gap
explanations retain their colors. Forced-color and print modes remain readable. Semantic titles
must coexist with complete wide-view content and narrow expansion.

## Category colors and native Desk

Legend/category colors are Urgent `#c24b4b`, Event golden yellow `#ad8b24` and Task Roam blue
`#137cbd`. The existing switch blue `#137cbd` and Free green `#277a59` remain unchanged.
Light text uses deeper Task `#106ba3` and Event `#7b651a`; dark text uses `#8ec0de` and
`#d7bf70`. The shell uses local radial materials: light task surfaces run from `#e3efff` to
`#6593ef`, and event surfaces from `#fff2cf` to `#efca68`, with separate current and dark
variants. Past fixed events use `#efe2c3` in light mode. Legend dots and native controls are
not replaced by these material gradients; title text never receives a gradient.

Actual tagged urgency uses `rgba(194,75,75,0.72)`, not just a recolored legend. The now
indicator uses the same red family, lightened to `#e58f8c` in dark themes. Completion stays
neutral gray unless explicit urgency overrides the fill; no title gets a deletion line.
Detail names retain semantic text colors without gradients. Actual is visible in the compact
completion summary; estimated allocation still has its explicit provenance and More detail.
The native control typography, warning/positive colors, icon paths and focus behavior remain.

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
hover/focus labels, computed category colors and readable title contrast. Check actual tagged
urgency fills across all dark-theme selectors, not only the legend; preserve the native switch
blue and Free green references. Add wide content
beyond 280px, automatically wrapped/unbroken text without a title-unlocking More action,
compact expansion, width transitions, unchanged SVG geometry, and yellow Unfinished cues
versus muted counts/totals, blue task rows and a neutral Unscheduled heading. Preserve default
15/explicit 45 completion tests, source-reference ownership and optional local CLOCK updates.

Assert every source UID appears exactly once across SVG and queue, with no false pending
history. Cover past demand zero, current/future overflow, a before-END overflow transition,
undated fallback, overnight carryover, queue navigation and default collapse, Eye independence,
completion moving out of the queue, and full long titles after disclosure. Existing live
minute, fixed-event, foreground recovery, same-minute next-day and cleanup gates remain.

Add continuous-shell path equality across paint/hit/estimate layers, unique material IDs,
actual SVG gradient paint, Current indicator bounds and the absence of other sublabel text,
hover/focus surface emphasis and source-frame stability. Check smooth shoulder curvature,
bounded control-envelope rounding and unchanged interval/queue data. Pointer tests must hit a genuine point inside a long folded path: its bounding-box
center can belong to the other turn. Verify SVG containment and browser hit-testing rather
than forcing clicks through overlapping bounding boxes.

Retain real Desk controller/state tests and multi-card masonry geometry, resize, image-load,
IME, Escape, import/drag, previews, strict Remove and all graph-write guards. Queue testing
uses synthetic graph data. Native CSS and private screenshots remain outside the repository.
No dependency, font installation, global rule, network configuration, memory/Wiki record,
Depot merge or marketplace release is introduced. Isolated tests do not certify an authenticated
Desktop reload, private-host lifecycle, physical drag or real clipboard/macro/send behavior.
