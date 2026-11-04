# Nautilus: honest time geometry and readable controls

## Current decision

Revised November 1, 2026. The approved B continuous-shell design replaces the stepped,
hour-sliced presentation. The thin-ribbon alternative was not selected. Task/event title
colors and native controls remain; completion and hover are part of the same design:

- Tips previews always use two fixed text rows. Longer content widens up to the local
  limit, then uses ellipses. Keep the 42px slot while idle; only explicit More opens full text.
- Main controls are Desk, Help, then whole-widget visibility. Help opens
  a transient quick guide. Eye off offers to hide the expanded widget; Eye offers to
  show it again. The completed-only visibility filter remains removed.
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
Source stamps are not execution-instance timestamps; interpreted chart-only inheritance is
specified below. Edit metadata is never timing evidence. Zero duration stays zero. DONE
estimate overflow keeps its title and duration in the diagram, not in an unfinished queue.

## Pure-reference completion evidence

The execution task contract remains unchanged: `uid`, `doneAt`, effective text, source-owned
TODO/DONE, CLOCK owners and Review/Actual totals do not adopt chart completion evidence.
The renderer opts into a separate `completionEvidence` projection. A sole `((uid))` plus
recognized, whitespace-delimited duration metadata may follow equivalent intermediate links
to the nearest explicit DONE owner. Local duration overrides inherited duration. Explicit
local status owns its own completion; a local stamp wins. Contextual prose, multiple refs,
code/tag residue and impure intermediate links cannot supply a source endpoint. Hold their
chart time with an explanation without reopening or reclassifying the underlying task.

Read back every admitted link's UID and exact string through public Pull before accepting
the terminal owner's stamp. A valid source `dHH:MM` is interpreted on the current plan's
clock; its storage page is not a completion date. Project pages, older Daily Notes and
undated plan titles therefore do not reject or shift a valid minute. Never derive completion
dates from page, edit/create, drag or load metadata. Dateless `d01:15` remains minute 75,
matching local stamps; this convention does not establish post-midnight calendar attribution.

The clock reader distinguishes verified empty history from failed reads for local wrapper
owners. Local stamps and positive local CLOCK Actual retain precedence. Source UIDs never
enter local CLOCK queries. A present running, out-of-day or sub-minute CLOCK with no usable
completed interval remains unpositioned rather than becoming a morning allocation. An invalid
local stamp names local evidence in the tooltip, not the source. Explicit zero estimates stay
zero. No marker, timestamp, state or CLOCK record is written by these projections.

An interpreted source endpoint plus estimate uses the normal timed/outside-window paths:
`d10:31` plus 30m is 10:01–10:31; `d10:32` plus 15m is 10:17–10:32. A 23:54 completion
with default 15m keeps 23:39–23:54 and connects to END when outside the chart. It is an
estimated interval, never source Actual or a proven completion date. Tips say “Reference
time interpreted for this plan” and omit the formerly inferred source date.

Unreadable, malformed or ineligible completion evidence sets `completion-time-unverified`
and bypasses estimated allocation and occupied-time obstacles. Keep the completed label and
explanatory Tips without a fabricated slice or boundary. A genuinely absent stamp and no
local CLOCK retain the existing outline-order first-whole-free-slot allocation from START,
marked “Estimated allocation” and “Not a recorded completion time”.

Source changes propagate through the existing reference revision and refresh without a
minute tick. DONE → TODO clears completion placement; a later DONE uses its current token.
The source-page watch remains compatible but page location no longer gates the endpoint.
No new polling, graph-wide scan, dependency, permission or persistence is introduced.

## Out-of-window annotations

Known intervals wholly outside a valid configured window use the ordinary title, leader and
small connection dot, not the former square icon beside the text. Attach earlier intervals
to START and later intervals to END, including normalized overnight minutes. The attachment
lands on the shell boundary's outer endpoint using the existing radius callback and rounding;
it does not use the four-unit offset of an in-range slice anchor.

Keep `kind: outside-window`, `time-claim: none`, the original start/end and full-start/full-end,
and all duration/completion provenance. Store the presentation point as `boundaryAnchor`,
not a timed `anchor`. Render no slice, hatch, capacity allocation or invented interval for it.
A completion at 20:43–21:28 can therefore connect to END 20:00 without claiming it happened at
20:00. Only Tips and the accessible description explain the outside-hours condition.

Boundary-connected labels use the normal angular side/routing and overlap prevention. Frame
budgets include their source-sized text on the boundary's side, independent of the moving
clock. Partial intersections retain their ordinary clipped timed slices. Missing or unplaced
completion estimates do not gain a fabricated boundary or timestamp. Existing hover/focus,
block navigation and permanent completion visibility remain; no graph or scheduling changes are introduced.

## Elapsed texture

Colors retain their existing category/state meanings; diagonal texture means only that the
rendered time interval has elapsed. Keep the gap pattern and all record fills, gradients,
opacity and appearance rules unchanged. Do not infer execution, CLOCK Actual or wasted time.

Each mounted chart owns a stable transparent line pattern and elapsed clip. The colored-record
pattern matches the gap's 45-degree direction, 6 CSS pixel pitch and 0.6px line width. It uses
existing theme-aware secondary ink at 12% opacity: the gap stripe color nearly matches the
composited gray estimate fill, so reusing that color would make completed textures invisible.
There is no background rectangle or additional gray wash in this new pattern.

Reuse the exact record surface path and clip it to the existing shell geometry from START to
`min(END, elapsedThroughMinutes)`. This preserves the rounded contour, 12-hour fold and
normalized overnight coordinates. Render only for timed records with a nonempty elapsed
intersection on `showElapsed` days. Future/undated charts and unfinished queues gain no texture.

The decorative path is pointer-inert and hidden from accessibility APIs. It inherits the
record's visibility and is painted before labels, estimate outlines, grid and the now needle.
Completed records and their texture remain visible and retain their occupied intervals.
Per-chart resource IDs must not collide when the same plan is mounted more than once.

Renderer checks cover partial/complete events, unchanged future-fill interior pixels, transparent
spaces between lines, light/dark/narrow layouts, Actual/stamped/unanchored estimates, hidden
occupancy, historical/future days, fold crossings, repeated clock angles, midnight and instance
isolation. Pixel comparisons exclude separately painted border/needle antialias fringes; their
geometry and the underlying fill/gradient attributes are checked independently.

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
Click/Enter locates the original local UID; Shift opens the sidebar. Help does not change
queue membership or disclosure. Changing a task to DONE moves it back to completed-history
handling; DONE estimate overflow never mixes with pending work.

The pending queue and native Desk serve different purposes: the queue explains what is not
on the time axis; Desk remains the user's optional editing surface for unfinished tasks.

## Frame and labels

The latest density correction replaces the hypothetical single-side budget with the height
of each actually occupied column. The frame fits the larger column or the existing plot extent,
plus its small insets. Read scheduled placements only to choose the displayed side; do not
change allocation, intervals, reference qualification or Actual. Unknown-time labels retain
their source-assigned sides, balanced by title height rather than a moving Current row.

Columns with four or more records form contiguous, vertically centered stacks. Preserve
angular order, true connector endpoints, text size, line height and wrapping; do not spread
rows across unused space. Smaller columns retain their anchor-oriented layout. Timed labels
stay on their time anchor's side. Ordinary titles wrap fully; pathological text retains its
existing full-text route. Height follows real content rather than a fixed cap.

Only the active task or event renders its typed indicator: **Current task** or **Current event**.
Use the existing theme-aware `--nautilus-log-now` red for this status text, matching the time
pointer. Keep its regular weight, metrics and layout. Titles keep their category colors;
ordinary metadata and the center clock remain secondary. Forced-color mode retains CanvasText.
Other diagram titles have no duration or completion-status sublabel; those details remain complete in Tips and the
accessible record claim. Only a currently displayed indicator receives the 14-unit subtitle
row. Use the same interactive/show-now and interval conditions as the painted indicator;
noncurrent, completed and out-of-window records reserve no such row. Title leading stays
16/15 units; the indicator uses 10px/9px
text. Compact columns budget the measured localized task/event phrases before sizing the plot,
so the full words fit without abbreviation, clipping or reducing the text size.
The existing label hit area is retained. Only the title ink gets the subtle hover field;
a separate anchor joins the label and its continuous surface.

The stability boundary is **unchanged occupied column budgets**. Ordinary minute motion that
preserves those budgets, hover and opening Help keep SVG dimensions stable. Real column
redistribution, Current-row changes, queue membership, day relation or source edits may reflow
it. A 45-minute task fits at 19:15 with END 20:00 but not at 19:16; the queue must reflect that
change. Queue open/close only changes content below the SVG. Tests must not restore hypothetical
height reservations or stale placement to satisfy the former unchanged-membership assertion.

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

The latest fixed-preview request supersedes automatic wide-view wrapping and zero-height
idle Tips. `chartTipLayout` now returns `contentMode=compact` at every width. Natural width
is still bounded by the local workspace minus 32px, never a universal 280px cap. Short content
stays narrow; longer content grows horizontally before either row uses an ellipsis.

Preview content is exactly 38px high in a fixed 42px slot, including 2px above and below.
The two grid rows are fixed at 14px: one title row and one metadata row, both nowrap with
ellipsis. Padding stays 4px vertical/6px horizontal, with a 4px column gap, no extra row gap,
a faint border and 4px corners. Text remains 11px/14px. More's label aligns with metadata;
its independent hit area stays 24px high and cannot overlap either text row.

Keep the existing pure width calculation rather than adding a DOM measurement feedback loop.
Use the matching 11px fonts, 23px content gutter and measured action width. Both title and
summary include tabular-digit advances, 2px rounding room and the existing per-digit allowance.
Offer More for clipped title/summary content at any width, or when full metadata differs from
the summary. Do not alter saved text to produce an ellipsis.

Idle Tips hide their content but retain the same 42px slot and padding. Hover/focus transitions
between records, gaps and empty space must preserve the slot's top/bottom, SVG, queue and Desk
positions, including intermediate animation frames. This small reservation is intentional;
it does not restore the rejected hypothetical chart-column budget or large empty diagram bands.

Only an explicit full-text action may increase height. Preserve the existing pinned reading
mode: full title/provenance wraps in normal flow, without covering Desk or creating an internal
scroller. Expansion lets the title span the full row and moves More beside metadata; Less
returns to the fixed two-row preview. Pointer, focus and pinned expansion are separate owners; changed or
removed records, folding and unload invalidate stale detail. Less keeps the inspected
record as the focused preview and clears pointer state accumulated behind the expanded panel;
it cannot momentarily switch to a different record and remove its own focused button.
Nothing covers Desk.

The Desk switch has a 40×32px hit area, a 28×16px track and 12px thumb travel. There is no
visible name span. Its `aria-label`, `role=switch` and `aria-checked` remain, while the existing
hover/focus tooltip supplies the visual label without wrapping. The real Desk binding owns
checked state through registration, start, close, preferences and remounts. Keyboard focus
is visible; Space/Enter, existing Alt navigation, focus return and reduced motion are retained.
No second React state or new preference is introduced.

## Help instead of completion filtering

The user's Help request supersedes the earlier proposal to explain capacity through
segment Tips. Keep Tips unchanged. Place Help immediately after Desk, followed by
the whole-widget Eye control. Use the official Blueprint 20px Eye off and Eye SVG paths
on the existing 18px control canvas; no dependency or font installation is needed.
Connected Calendar is an additional control after these three.
Do not restore the completed-only visibility atom or filtering branches. Completed
records, labels, estimates and texture remain visible whenever the chart is expanded.
The same collapsed-state owner drives the icon and aria-expanded. The folded state
keeps only Eye (Expand), and folding dismisses an open Help card.

`src/chart-help.js` owns a read-only body-mounted popover. It receives resolved hours,
default duration and language from the renderer, never task text or graph data. English is
the default; explicit Chinese uses localized copy. Explain remaining/full-day budgets,
unfinished Planned demand, the full-day denominator of `left`, whole-task source order,
Desk and completion provenance. Scheduling descriptions must match the actual allocator.
There is no outline-reordering button or command, and loading the extension does not undo
past manual outline changes. Point to the existing settings and a revision-bound
full guide; do not introduce a second settings editor or saved Help preference.

Use native typography and a restrained 360px maximum width with 12px viewport gutters.
Prefer a complete compact guide; only constrained viewport height requires internal scrolling.
The popover may cover the chart like the supplied native Desk reference, but it must not
resize the SVG, alter Desk width or take over the in-flow Tips region. Escape is owned only
inside Help or its trigger; outside pointer/focus interactions pass through without forced
focus restoration. Closing with Escape returns focus to the trigger. Settings changes,
navigation, anchor removal and extension unload release listeners, observers and queued frames.
Multiple charts share one transient Help owner without sharing their task/editor state.
Roam's enhanced image viewer takes priority even if focus stays on underlying chrome:
its appearance dismisses Help, and an immediate key is passed through before observer settlement.

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

## Preview refresh while editing

A graph notification marks a card's preview dirty rather than deleting its last admitted
model or clearing its DOM. Loading and refreshing are distinct: first admission may use a
placeholder, but a refresh retains the verified content until the latest read and watch set
are admitted. Existing epoch/version/card-identity checks still reject obsolete completions;
a superseded read must requeue even when an older model remains cached. Search must not
exclude a dirty card based on an obsolete search projection. Unreadable data still produces
the existing explicit preview error. Scope loss closes immediately; removal, folding,
explicit reset and teardown retire cached image callbacks and preview state.

The read-only DOM renderer reuses each visible image independently and reuses row nodes
keyed by source-row UID. Text, checkbox state, depth and order update only where needed.
Unrelated cards stay in place. Text, alt text, hidden images beyond the third, hidden-count
changes, and reordering do not recreate the visible images that remain. Replacing one displayed
URL reloads only that image. Moving between a single image and several images may rebuild that
holder. A failed displayed occurrence is not retried for text, alt, or hidden-source changes; a
new displayed lifetime or an explicit reset may retry. Image completion belongs to the currently
retained DOM and card/view lifetime, not the text-read generation which created it. A callback
from a retired image cannot notify, remove a newer cell, or mutate a newer preview or its masonry.

This does not freeze previews while editing or add a debounce delay. Committed content
continues to refresh behind task/draft editors and alongside sidebar editing. Native editor
identity, focus, caret/selection, scroll and uncommitted IME buffers remain untouched. No
new diagnostic commands, graph writes or production instrumentation are introduced.

Regression coverage includes four root/descendant × focus/sidebar typing cases with real
raster responses, delayed watch admission, intermediate-frame sampling, image/row/checkbox
identity checks, and external IME buffers. Additional cases cover image completion during a
pending refresh without ResizeObserver, alt-text changes, failed-image retry isolation and
explicit-reset recovery. Per-image cases keep identity across hidden-tail, hidden-count, reorder,
duplicate, and slow-load updates, and prove retired callbacks cannot affect a newer card. Existing
late-image, fold, removal, unreadable-source, search, watch-lifecycle and editor cases remain required.

## Verification and boundaries

Use exact production CLJS/JS in the isolated renderer. The density fixture has six fixed events
and fourteen tasks, including long CJK text. Check main/embed/sidebar widths 280–960px,
light/dark themes and both UI languages: no title overlap, leaders through titles, missing
UIDs or graph writes. Bound top/bottom voids and dense-label gaps independently of frame
metadata. Verify content-driven chart shrinking without interval changes and one mounted
SVG/clock timer across host moves and resizing. The chart remains compact; its small Tips slot
now stays 42px under the later fixed-preview request.

Verify ordinary CJK title width,
More/展开 line count under font and inherited word-break pressure, hidden Desk text with
hover/focus labels, computed category colors and readable title contrast. Check actual tagged
urgency fills across all dark-theme selectors, not only the legend; preserve the native switch
blue and Free green references. Add wide content
beyond 280px before clipping, one-line title/summary previews, explicit complete/unbroken-text
expansion, width transitions, unchanged SVG geometry, and yellow Unfinished cues
versus muted counts/totals, blue task rows and a neutral Unscheduled heading. Preserve default
15/explicit 45 completion tests, source-reference ownership and optional local CLOCK updates.

Assert every source UID appears exactly once across SVG and queue, with no false pending
history. Cover past demand zero, current/future overflow, a before-END overflow transition,
undated fallback, overnight carryover, queue navigation and default collapse, permanent completion visibility,
completion moving out of the queue, and full long titles after disclosure. Existing live
minute, fixed-event, foreground recovery, same-minute next-day and cleanup gates remain.

Add continuous-shell path equality across paint/hit/estimate layers, unique material IDs,
actual SVG gradient paint, Current indicator bounds and the absence of other sublabel text,
hover/focus surface emphasis and source-frame stability. Check smooth shoulder curvature,
bounded control-envelope rounding and unchanged interval/queue data. Pointer tests must hit a genuine point inside a long folded path: its bounding-box
center can belong to the other turn. Verify SVG containment and browser hit-testing rather
than forcing clicks through overlapping bounding boxes.

Toolbar checks cover Desk/Help/Eye order, exact official glyphs, Eye off while expanded,
Eye while hidden, persisted collapse state and optional Calendar in the fourth position.
Help checks cover absence of completed-only filtering, live minute stability,
English/Chinese settings, native light/dark styling, small viewports, keyboard access,
outside interaction, native-editor Escape, IME, multiple charts, cleanup and zero graph reads/writes.

`test/chart-fixed-tips.py` checks ten light/dark, English/Chinese and main/embed/sidebar
combinations. Sample each animation frame while moving among short/medium/long tasks and
focusing available/past gaps; check idle re-entry, fixed 42px slots, 38px content, one line per
row, horizontal growth, accessible clipped text, pinned expansion and unchanged source rows.
A separate short-title/long-metadata case checks second-row clipping and full provenance access.

Retain real Desk controller/state tests and multi-card masonry geometry, resize, image-load,
IME, Escape, import/drag, previews, strict Remove and all graph-write guards. Queue testing
uses synthetic graph data. Native CSS and private screenshots remain outside the repository.
No dependency, font installation, global rule, network configuration, memory/Wiki record,
Depot merge or marketplace release is introduced. Isolated tests do not certify an authenticated
Desktop reload, private-host lifecycle, physical drag or real clipboard/macro/send behavior.
