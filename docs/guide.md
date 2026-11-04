# Nautilus Log User Guide

[Back to README](../README.md) · [简体中文](./guide.zh-CN.md)

## Plan format

Add fixed events and flexible tasks as direct children of a Nautilus Log component.
Their Roam block order is the task priority.

```text
05:00-06:00 Morning routine
{{[[TODO]]}} Write project brief 45m
{{[[TODO]]}} Review notes 30m
11:45-12:30 Lunch
```

- A time range is a fixed event.
- A direct child without a time range is a flexible task; TODO is optional and
  DONE excludes the task from today's execution.
- Durations support `30m`, `30min`, `1h`, and `1h30m`.
- Untimed tasks use **Default Todo Duration**.
- **Urgent Trigger Word** changes a task's color, not its scheduling order.
- A bare block reference inherits its source TODO/DONE. Add an outer TODO to
  explicitly redo completed source content today.
- A duration written after a sole reference overrides the source duration. A visible valid
  source `dHH:MM` is interpreted as an estimated endpoint on this plan's clock, including
  project pages and older Daily Notes; it is not a proven completion date or Actual. Explicit
  local completion data and local CLOCK take priority. Source CLOCK history is never inherited,
  and no source timestamp is written into the local wrapper.
- Legacy `dNN%` text has no scheduling meaning. Nautilus Log keeps it as ordinary
  block text and always schedules the full estimate.

## Optional completion timestamps

**Completion timestamp** is a separate Settings switch, off by default. It works while the Execution Layer is off. A confirmed user completion can append one local `dHH:MM`. The chart can combine that time with a task's planned duration to estimate its interval. The stamp does not measure Actual or start CLOCK/POMO.

Supported actions include native checkboxes and Cmd/Ctrl+Enter in the main outline, right sidebar, and Nautilus Desk, plus Nautilus's own completion command. A reference checkbox follows the source that Roam actually changes; an explicit outer task marker belongs to its wrapper. A shortcut can commit your current editor text before the stamp is added. Uncommitted or composing text is never overwritten. Ambiguous targets, selections above 20 blocks, unavailable reads, and changes of graph, user, or provider skip the stamp.

A first click can need time for both Roam's graph commit and its native editor redraw. Nautilus waits within a finite window and writes only after both agree. A busy lock or unconfirmed transition times out with a notice; later passive changes are not backfilled. Once a timestamp write has been issued, its own confirmation and ownership flow finishes independently of the earlier observation deadline.

Reopening removes only the exact suffix that Nautilus can still identify as its own. It first saves and verifies removal of the ownership receipt. If that fails, the time stays. If the later text update fails, the receipt remains revoked. Completing a successfully reopened task again records a new time. Manual, legacy, calendar, duplicate, malformed, and code-literal time fields stay intact. Ownership uses SHA-256 metadata in extension settings, with at most 64 recent receipts and a 32 KiB size limit. It stores no task text or completion history. A changed body, missing or corrupt receipt, eviction, or stale settings on another client can prevent removal of an older suffix. A persistence failure leaves the confirmed suffix in place and warns you. An unconfirmed host write is not retried automatically; inspect the block before trying again.

Startup, rendering, navigation, imports, sync, and already-completed tasks never trigger backfill. Undo/Redo remains available to Roam, and native completion plus its later suffix may take two Undo steps. Browser acceptance uses an isolated graph and native-shaped DOM; it does not certify live Roam Desktop, OS-level IME, or atomic native Undo.

A detected running Todo Trigger blocks Nautilus stamping because it can append independently. Nautilus does not inspect or change its configuration. Disable Todo Trigger on every client before enabling this switch; turning off only its Append Text option does not clear the detected conflict.

## Scheduling rules

1. Fixed events claim their written time ranges.
2. Pending direct-child tasks are read in Roam block order.
3. Starting at the current moment, complete tasks fill the next continuous gaps large
   enough for them.
4. Time passing moves unfinished work forward without changing priority.
5. Tasks that cannot fit before the configured end enter **Today won't fit**.

The scheduler is deterministic and does not generate estimates. A task remains atomic:
if it cannot fit one gap, it moves to the next suitable gap instead of being split.

Flexible tasks use the day's free gaps in their own order, regardless of where fixed-event
rows appear in the outline. The event-position constraint has been removed; old saved
values no longer affect scheduling.

A fixed event marked DONE still reserves its written range until that range ends. DONE
changes presentation, not cancellation; edit or remove the range to release it. Explicit
outline edits or Desk moves can change relative task priority. Moving a task across a
fixed-event row alone does not impose an additional start-time restriction.

While the current time is inside a fixed event, the next task can correctly keep the same
start at that event's end. A task that no longer fits before END is unscheduled, not frozen
at an earlier hour. The minute timer and foreground/visibility/page-return synchronization
use the same wall-clock snapshot, including its calendar day.

## Header metrics

| Metric | Meaning |
| --- | --- |
| Planned | Remaining flexible-task demand; `free` is unassigned budget ÷ full-day flexible capacity, not clock time left or energy |
| Remaining | Available time left after Planned demand |
| Overload | Demand beyond available time |
| No fitting slot | Time exists in total, but no continuous gap can hold an atomic task |
| Available | Flexible time remaining now / full configured-day flexible time |
| Events | Fixed-event time remaining now / full configured-day event time |

Overlapping events are counted as a union, so one minute is never counted twice. The
small flame marks whether the current minute is consuming Available or Event time.

## Visual language

- Roam blue: flexible tasks; the task planned for now has a stronger fill and outline
- Muted golden yellow: fixed events
- Gray with a solid outline: completed local CLOCK Actual or an explicit fixed range
- Gray with dashed outlines: completed flexible tasks using estimated durations; Tips distinguish stamped from estimated placement
- Pale neutral hatching: past gaps not covered by a task or event interval, not future availability
- Fine hatching over an existing color: the elapsed part of that interval, not proof of execution or actual timing
- Red needle: current time and the starting boundary for pending work
- Red task color: an explicit urgency override

Task blue (`#137cbd`) and Free green (`#277a59`) keep their meanings; the toolbar uses
its own neutral gray. Task text uses a deeper blue (`#106ba3`), events use a calmer
yellow (`#ad8b24`), and urgency uses a softer red (`#c24b4b`). Fills, leaders, Unfinished cues
and dark-theme text follow these color families without changing their meanings.

Hatching leaves existing fills, gradients and opacity intact. Only the portion before the
current time is striped; the future portion stays plain. Yellow stripes mark elapsed event
time, not confirmed attendance. Gray stripes do not turn an estimate into Actual. Estimated
outlines remain dashed above the texture, and labels, the pointer and interactions stay clear.
Completed records and estimates remain visible and occupy their intervals; they do not become empty gaps.

The **continuous shell** draws each timed record as one surface, with rounded transitions
through the radius profile. Hour marks remain as edge ticks rather than lines that visually
split a task. Titles have no duration/status sublabel: only the active task or event shows
**Current task** or **Current event**, respectively, in the same theme-aware red as the
current-time pointer. Here Current means the item at this chart's current time, not proof
of execution or an active CLOCK. Task/event titles keep their category colors. Hover/focus
Tips retain full duration, Actual and Estimate details. A CLOCK can be timing another task
without changing the chart-time label or your task order.
The center clock uses the shared UI font with tabular numerals, regular weight and secondary
text color. Its size is capped at 16px and still adapts to narrow views; the date, clock position
and needle are unchanged. The curves retain the shrinking-radius model and real time boundaries, but
are not pixel-area-equivalent to the earlier stepped shape.

Hover or keyboard focus emphasizes the surface, its leader and its colored title as one unit.
It does not move the chart. English is the default UI language; an explicit Chinese preference
is preserved, and task titles always remain in their source language. Toolbar icons are unchanged.

Actual is summed CLOCK time; its drawn contiguous interval is a completion-anchored projection, not a session timeline. For example, CLOCK 09:00–09:40 with `d15:00` draws 14:20–15:00; sessions 09:00–09:15 plus 10:00–10:15 draw 09:45–10:15. LOGBOOK sessions remain untouched. Tips name the **total** and **display interval** explicitly.

Estimated completed tasks carry a small `≈` beside the title, including estimates anchored
by a completion stamp. The cue participates in title measurement and wrapping; it does not
remove previously visible title text or add a universal subtitle row. Accessible text and
Tips explain that the duration is estimated.

Completed tasks without actual timing use their explicit estimate, or Default Todo Duration
(15 minutes by default). They receive spiral slices and connected labels without requiring
CLOCK or a completion stamp. When no local time anchor exists, Nautilus places those estimates
in outline order from START, around fixed events and anchored completion intervals. The tip
identifies this as **Estimated allocation**, not a recorded completion time. A local completion
stamp anchors the end of an estimated interval, but does not turn its duration into Actual;
that task also keeps a dashed outline, including during hover or explicit expansion.

Estimated allocations do not move with the clock or change pending-task scheduling. They can
extend past now and overlap a pending forecast; dashed gray outlines distinguish them while
the pending task keeps its blue fill. If the configured window cannot hold a whole estimate,
its title and duration remain visible with a capacity-overflow endpoint. No task is split,
no later short task overtakes it, and no extra time is added beyond END. Unscheduled pending
work belongs in the collapsed **Unscheduled** queue below the chart, not at an arbitrary
point in the spiral. Known ranges entirely outside chart hours use the ordinary label
and curved leader, without a special icon: before START connects to START, and after END
connects to END. This is a boundary attachment only, not an allocated interval or a changed
completion time. For example, a 20:43–21:28 completion connects to a configured END of 20:00,
while hover/focus Tips retain its original range and the outside-hours explanation.

Hover or focus a title to emphasize its whole connection and slice.
Completed titles retain their neutral color without a deletion line; other titles stay
readable. Clicking a task still locates its block.

Past gaps describe the chart allocation, not proof that time was idle or wasted.

## Chart controls

The three main controls are **Desk → Help → Eye**. A connected Calendar
appears after them as the fourth control. Help and Eye use the original filled Blueprint
artwork at 18px. The Desk switch uses a filled track with a clear off/on position. Hover
and switch feedback lasts about 100ms, with no icon morphing or button scaling; reduced
motion makes the feedback effectively immediate. Click targets and keyboard focus remain.

- **Desk switch:** show or hide unfinished-task cards below the chart. Only the slider is visible; hover or keyboard focus shows its Desk label. The thumb slides right and the track turns blue when open; the closed state uses a neutral filled track. Click, Space or Enter toggles it; the state also follows fold/expand restoration, control remounts and saved preferences.
- **Help (?):** immediately after Desk, the question mark opens a native-style quick guide.
  It shows this chart's resolved hours and default task duration, explains Available,
  Events, Planned and `free`, and summarizes scheduling, Desk and completion styles.
  It also points to the main settings and the full guide. Help is read-only, not a second
  settings editor. Click again, click outside or press Escape inside Help to close it.
- **Eye off / Eye:** when expanded, Eye off offers to hide the entire rendered Nautilus UI,
  including Desk cards and the focus dialog. When hidden, Eye offers to expand it again.
  The compact state leaves only this expand control. The original plan outline stays hidden
  while Desk is selected, and the saved Desk preference is unchanged. Expand restores the
  spiral and, when Desk was selected, its cards. This is not a completed-task filter.
- **Calendar:** after Google Calendar reports Connected in Settings, the additional button
  imports timed busy events and dated Google Tasks for this chart's Daily Note.
  Option/Alt-click force-refreshes only the Google-managed strings.

The completed-visibility filter remains removed. Completed slices, estimate outlines and
their connected titles remain visible whenever the chart is expanded; Desk still shows unfinished tasks.
Unlike the in-flow segment Tips, Help is a temporary button-anchored popover. It does not
resize the SVG or change Desk width. Short viewports may scroll the Help card so its full
content and guide link remain reachable. Folding closes Help and retains the existing
expand-only compact control. Settings changes close the old Help snapshot; reopening shows
the updated resolved configuration. Roam's native image viewer dismisses Help and keeps
keyboard priority even when focus has not moved. Help adds no graph reads, writes or saved preference.

Every titled source record remains available either in the diagram or in the pending queue.
Fixed events, completed history and estimates, and genuinely scheduled tasks keep their
connected diagram labels. Ordinary titles wrap rather than disappearing when a label
budget is full. Narrow views retain side labels, major hours and a compact center date.
Timed labels stay on their slice's side.

The frame fits the titles actually displayed in each column and adapts to the local width.
Dense columns form compact stacks without spreading labels apart. Only the active task or event
needs a Current subtitle row; other titles leave no blank row. Text size, wrapping, time anchors
and the shell's relative geometry remain unchanged.

Height can adjust when column occupancy, visible Current rows, source text or queue membership
changes. Minute motion with unchanged column budgets, hovering and opening Help keep the SVG
size stable. A whole task can cease to fit before END; the queue must reflect that change rather
than keeping a stale slice. Expanding the queue adds only content below the SVG.

The spiral is the only time geometry. There is no completion-status node, separate upper
connection band or outer track. The lower queue is only for unfinished work, not an
inventory of completed history. It has no internal scrollbar.

### Past days and unscheduled work

On a **past** Daily Note, unfinished tasks are not replanned from START and are not counted
as active Planned demand or overload. They remain under **Unfinished**, collapsed by default,
with their original titles, estimates and local UIDs. Its yellow disclosure arrow and
readable yellow-family heading mark work that still needs attention; counts and duration
remain muted, and task rows use blue.
Nothing is moved to today or marked
complete. Completed estimates and real fixed ranges remain in the diagram.

Today, future days and undated views keep their existing scheduling order. Tasks that do
not fit a whole continuous gap appear under **Unscheduled**. Empty queues are absent.
Expand either queue to read full titles; click or Enter locates the original block, and
Shift opens it in the sidebar. DONE estimate overflow never enters an unfinished queue.
An overnight window remains today's active plan until its logical END, even after midnight.

CLOCK and completion stamps are optional. A local stamp such as `d14:30` anchors an estimate;
without it, the estimate still receives a slice through the allocation described above.
Inherited completion is identified as coming from its reference. For a sole reference (or
safe sole-reference chain), the chart may use the nearest explicit DONE owner's visible valid
`dHH:MM`, including after duration metadata. The source storage page is not a completion date:
the Tip says **Reference time interpreted for this plan** and never invents a date from page,
edit, create, drag, or load time. Explicit local TODO/DONE owns status; a local stamp or local
CLOCK wins, while an invalid local/source stamp or unreadable source remains unpositioned.
Prose, extra references, code or other non-duration context cannot supply a source endpoint,
including through intermediate links. This restricts chart placement only: existing TODO/DONE
inheritance, task identity and execution ownership remain unchanged.

A source completion at 23:54 with no duration keeps the default 15 minutes as **Estimate**,
not Actual. With END 20:00, its ordinary leader goes to END instead of filling a morning
gap. More shows the interpreted time and estimated 23:39–23:54 interval. Local markers,
local completion stamps and local CLOCK keep precedence; CLOCK ownership and statistics
remain local. Explicit zero estimates are not inflated. In an overnight window, `d01:15`
remains 01:15 on the plan clock; this does not guess a source completion date.

Before applying a source stamp, the chart verifies the referenced text and local CLOCK
coverage. If either cannot be read consistently, the completed title remains visible without
a fabricated slice, boundary or icon. A genuinely absent completion
stamp (and no local CLOCK) instead keeps the read-only **Estimated allocation** fallback: in
outline order, its whole estimate is placed in the first START-or-later free slot that fits,
skipping fixed events and anchored completions. Its Tip says it is not a recorded completion
time, and no `dHH:MM` is written. Source text/page changes refresh without a clock tick.
These are read-only projections: no markers or timestamps are copied into saved blocks,
no Actual is invented, and pending scheduling/capacity rules are unchanged.

Hover or keyboard-focus a record, available slot or past gap to read its context in a
centered, content-sized tip with 16px side insets. The preview always has two rows: one for
the title and one for metadata. Longer content widens the note up to the available local
width, not a universal 280px cap. At that limit, each row uses an ellipsis instead of wrapping.
Short content does not stretch across the chart. More reveals clipped text or extra information.

The preview has 38px content in a fixed 42px slot, with 2px above and below it. A faint
border, 4px corners and 4px vertical/6px horizontal padding add slight breathing room. Both the
title and metadata use 11px text with a 14px line height. More's visible text aligns with the
metadata row; its independent 24px hit area does not stretch over long titles. It stays neutral
until hover/focus and never breaks into letters. Idle tips hide their content but retain the
same small slot, so moving between tasks, gaps and empty space cannot shift the queue or Desk.
Only an explicit full-text action expands the reading area in page flow, without resizing
SVG or covering Desk. Expanded reading stays pinned; Less returns to the two-row preview.

Names match the chart's semantic colors: blue tasks, yellow events and neutral gray
completed records, without text gradients. Actual appears in a recorded completion's first
summary; an estimated allocation remains explicitly marked as an estimate. Decorative surface
gradients do not encode additional time or progress. Metadata, dates and gap explanations keep their own
colors; forced-color and print modes remain readable. Past gaps show their complete uncovered
range and duration, not proof of idle or wasted time. Click or Enter/Space pins the details;
Escape dismisses them. Changed ranges invalidate stale selection; completed records and
estimates keep their occupied intervals. Record expansion can also pin details and is invalidated
by source changes or removal.
The area does not follow the pointer or cover the plot. Click or Enter on a flexible task's
mark or label locates its original block; Shift opens it in the sidebar. These actions
never rewrite the task or its time. If the block is folded, navigation uses Roam's official
block API.

## Desk task view

Turn on the chart's **Desk** switch to expand cards below it; turn it off to hide
Desk. The switch reflects the actual view, including after a reload or control remount. The view uses Roam's `rm-desk-*` and Blueprint styles rather than a separate
font, size, or card theme. Desk stays within the same local renderer width as the
chart above, including centered Daily Notes, sidebars, and embeds. It does not
expand to the article wrapper or use a compensating negative margin.
Native masonry uses four-pixel grid rows and measured row spans: the next card can fill
space beneath a shorter card instead of waiting for an equal-height row. Tile resize and
image loading trigger remeasurement without changing DOM or task order. Native auto-fill
determines the column count; there is no fixed two-column layout or three-column cap. The embedded root does
not use Roam's full-page `rm-desk-page` marker: current host styles use that marker
to change ancestor padding and impose a viewport-sized canvas. Only native card
sizes are retained locally; opening this component must not change page spacing.
Search and New task share one flex-aligned tool group, with New task at the trailing
edge. The overview has no duplicate close X; use the chart's Desk switch to hide it.
Tab moves from Search to New task, then directly to the cards. The focus dialog's
Close button, backdrop dismissal and existing Escape behavior are unchanged.

Read-only card previews keep updating while a task editor or new-note draft is open.
Committed graph changes, including descendant folds, text and images, refresh the
background card and its masonry height without closing or remounting the editor.
During refresh, cards retain their last verified preview instead of clearing images and
rows before the replacement is ready. Text edits update existing rows and reuse each unchanged
visible image individually, so editing in the focus dialog or sidebar does not repeatedly collapse and
rebuild the background cards. Hidden images beyond the third, changes to that hidden count, and
reordering do not recreate the visible images that remain. Replacing one displayed source reloads
only that image. Switching between a single image and several images may rebuild that image area.
Image-source changes, folds and real content changes still update the preview; read failures remain
explicit. A failed image is not retried for text, alt text, or hidden-source changes. A new displayed
lifetime or an explicit preview reset may retry it.

The background stays inert while the focus dialog is open. These reads do not save an
unfinished input composition or copy the editor's uncommitted buffer into the graph.

- **Unfinished tasks only.** Each direct task becomes a card, including unscheduled
  work. Events, DONE blocks, and dividers are excluded. Implicit tasks and referenced
  state follow the existing rules; completed child logs remain inside active tasks.
- **Hide the duplicate outline.** While Desk is open, only the original child-block
  area below this Nautilus renderer is hidden, including events and completed logs.
  Nothing is deleted or collapsed in the graph. Other plans and the native editor's
  children remain visible. Hiding Desk or unloading restores the original area.
- **Drag moves the real block.** The left/right halves of a target card choose
  before/after (mirrored in RTL), changing actual outline order and planning priority. The footer's hover action,
  **Move to top**, moves that same UID to index zero, ahead of any hidden events or
  completed blocks. Dropping before the first active card also means actual index
  zero. Text, descendants, and referenced source blocks are not moved or rewritten.
  The previous view-only ordering cache and reset-layout control are gone.
  Drag feedback matches current native Desk: gray top-right position pills, a blue
  vertical insertion rail, and its resulting-position label. Gray positions refer
  to the full unfinished-task collection even during search; blue Alt counters
  refer to the first nine visible cards. No footer number slot or custom drag ghost
  is used. Background insertion uses the full collection's end, not a filtered order.
- **Remove from Desk** sits beside Move to top. A verified, childless, plain
  `((uid))` wrapper, optionally preceded by one `{{TODO}}` or `{{[[TODO]]}}` marker,
  is deleted locally; its referenced source is not deleted. Ordinary tasks,
  contextual references, and wrappers with local children move intact, with the
  same UID and subtree, to the end of the plan's owning Daily Note page. That can
  be a historical or future note: the destination is never guessed from today
  or the current route, and no page is created. Unverifiable ownership blocks
  the action. Finish editing or IME composition first. There is no destructive
  keyboard shortcut or focus-menu action.
- **Plus adds content under this plan.** **New task** in the overview and **+** in
  the focus header open a native-style draft. The first committed, nonblank input
  creates one direct child at the start of the current Nautilus block, then hands
  editing to Roam. Closing an untouched draft creates no empty block; IME text is
  not written before composition ends. No TODO marker is forced. Ordinary text is an implicit
  budget task, using the default estimate when no duration is given; its child notes/logs add
  no independent demand. Content classified as an event or DONE is saved but excluded from active cards.
- **Native focus editing.** Click a card to edit its original UID, path, and children
  with `renderBlock`; Shift-click opens it in the sidebar. The focus dialog is centered
  in the viewport, up to 880 CSS pixels wide, with 16px side gutters on smaller windows.
  The editor uses that wider space; background sidebars are not closed or allowed to
  squeeze it back into a narrow column. Native height and typography are unchanged.
  The header shows the selected task and collection count, such as **1 / 4**; drafts
  still show **new**. Responsive width changes do not remount the editor or create notes.
  The chart and card overview keep their existing widths. **Option/Alt + comma** is
  Next and **Option/Alt + period** is Previous. Navigation stops at the last card;
  Previous from the first card opens the new-note slot, as native Desk does.
  Esc within the mounted native editor belongs to Roam, including the tested
  Escape-before-fake-Copy prelude. The footer shows **esc Roam editor** there;
  focusing Desk chrome changes it to **esc Close**. Use Close, the backdrop, or
  Esc from Desk chrome to return to cards. Drafts retain their own Esc behavior. Holding Alt reveals number hints; **Alt + 1–9** opens
  the corresponding card. Existing keyboard bindings are unchanged.
  Horizontal trackpad gestures and **Shift + wheel** switch notes in the existing
  direction. Partial gestures follow the input and spring back; momentum does not
  repeatedly skip cards. Pixel, line and page wheel units are normalized. Ordinary
  vertical scroll, pinch zoom and nested horizontal scrollers remain native.
  Motion respects reduced-motion preferences and IME. Only the focused native
  editor is mounted; smooth feedback does not create editable neighbor copies.
- **Remember the view.** Desk mode is saved by graph and plan UID. Returning to a
  page, refreshing, reloading the extension, or expanding an already-folded chart
  restores the view without opening an editor or creating content. Folding does not
  change the preference; explicitly hiding Desk saves the off state. The preference
  is a localStorage flag, not task text, and does not sync across devices. A manual
  open that cannot save its preference reports the limitation.

Previews follow the full-page Desk rules: the root plus eleven counted descendant
rows, in outline order and at most two levels. Up to three raw image-only rows
are exempt from the count; blank image rows are pruned without losing their
images or necessary hierarchy context. Image URLs are deduplicated in encounter
order. Only explicit `open: false` folds a row. Hidden descendants and budget
truncation produce `...`. These are original-content projections, not summaries.
A childless plain reference can show its source block or page and children;
local children take precedence, and contextual references do not adopt another
subtree. Missing external roots show `(missing)`. Code remains literal. Unsupported
rich forms are not executed; this is not a replacement for Roam's full renderer.
Opening a card edits the complete original block, without changing source folds.
Markdown images outside inline/fenced code in
the card root, preview subtree, and resolved references use Roam's native `rm-desk-tile__image` /
`__images` layouts (one bounded image or up to three cells). Only `http`, `https`,
same-origin `blob`, and base64 raster-image URLs are inserted as image elements; arbitrary graph
HTML and unsafe schemes are not rendered. Encrypted or proprietary attachment
rendering is not specially adapted beyond URLs that the host image element resolves.
Search covers titles and direct child content beyond the displayed rows, not a
recursive descendant index. Staged public pulls, reference expansion, text,
images, watches, and retained models have explicit limits. Read/watch failures
show a retryable unavailable preview; incomplete search keeps the card visible
rather than treating unread content as a mismatch. Read–watch–read admission
protects registration races, including folding and reopening before a watch settles.
Only the focused card mounts a full editor. Plan membership shares the
existing Pull Watch; text updates do not remount the editor. Completing or removing
an active task advances focus. Browsing does not control CLOCK or alter Roam's
built-in starred/Desk collection.

### Safe outside-block references

Drag one ordinary native Roam block from the same window and graph onto a Desk card
(or the background). Desk preserves the original block and creates one bare native
reference, `((source-uid))`, under the current plan. It adds no TODO marker: plain text
stays plain, and an existing task checkbox is not duplicated. The source text, parent
and children stay untouched; the reference follows the source's state. New drops of
already-completed sources are declined with a clear message instead of reopening them
or silently adding an invisible card to this unfinished-items view.
Left/right card halves choose
before/after (mirrored in RTL), with the same native insertion rail and number.
Background adds after the last unfiltered active task (or first in an empty plan).
Accepted native transfers use the copy cursor; move-only or link-only transfers
are not imported. Files, pages, queries, embeds/renderers, events, ambiguous/multi-block and
cross-graph payloads are rejected. Nautilus ignores modifier gestures and leaves
those events entirely to Roam; it does not suppress Roam's own modifier behavior.
Repeated drops reuse the same deterministic wrapper. Existing legacy TODO wrappers
are recognized read-only for deduplication; this update does not rewrite or remove their
saved markers. Strict receipt adoption recognizes the exact bare or legacy wrapper at
its reserved ID, but a new create is confirmed only against the requested bare string.
After a confirmed add,
Remove from Desk of its childless local wrapper permits the source to be dropped
again with that same ID. A promoted wrapper still occupies the ID, so Desk does
not create another. An unconfirmed attempt in that running view is
verification-only; if its exact childless wrapper is later observed, that graph
state resolves the reservation and a later confirmed removal may re-add it. A
different wrapper does not resolve the reservation. Reload checks the same
reserved UID and never allocates a second UID for that source and plan. Imports require the public
`data.pull` and `data.block.create` APIs and a verifiable graph/type/user context.
Progress temporarily uses the existing title area, leaving Search and New task
unobstructed. Hover over a truncated message to read it in full. The
full message is also announced to assistive technology; terminal feedback clears
after five seconds and restores the title without moving the cards.

The import and Escape-prelude checks use synthetic graphs and a fake in-memory
Copy callback. The editor-first fix is implemented, but the live macro workflow
remains unvalidated: no physical drop, real clipboard, app switch, paste, or send
was exercised.

Desk removal, moves, and creation share the graph-scoped `outline` Web Lock.
Removal requires public `data.pull` plus the applicable `data.block.delete` or
`data.block.move` API, verified Daily Note helpers, and stable provider, graph,
type, and user context. It checks registered surfaces, focus, and composition;
compares fresh structural/source snapshots; makes one host mutation; then verifies
UIDs, sibling order, source content, and subtree preservation. Lost, timed-out,
no-op, or ambiguous responses retain a verification-only reservation in this
runtime, including across view disposal. Other Desk writes to that plan pause
while removal is unconfirmed. Refresh performs verification only, including after
late completion removes the card. There is no compensating rollback or blind retry.
These reservations are not durable transactions across extension/browser restarts.

Other moves and creation also check parent and task state before writing; UID, text, and order are read back afterward.
A native image zoom opened from the focus editor remains Roam's viewer: it takes
pointer, wheel, Tab, and Escape first while the mounted editor and its scroll stay
in place. Without that viewer, Desk's normal Escape behavior is unchanged.
A host API response alone is not confirmation. An uncertain create is checked
using its reserved UID, never blindly repeated with a new UID. Locks do not cover
other devices or manual writers; concurrent changes fail conservatively. Read
failures retain visibly stale cards and pause writes. Turn off the Desk switch to
inspect the original outline.

### Layout isolation

The page-scope CSS collision is now reproduced and corrected: current host CSS
made the old embedded page marker change wrapper padding, producing a 12px shift
in the narrow case. Removing that marker leaves existing anchors unchanged across
spacing/context regressions and avoids the page-only 60vh grid floor. Native pages
retain their own layout rules. A fresh check of the installed Desktop build is still
needed; these fixtures do not claim to diagnose every possible outer whitespace issue.

### Validation boundary

`PYTHONDONTWRITEBYTECODE=1 npm run test:desk` covers production adapters, projection,
layout, restoration, editor lifecycle, and preview races. The preview lifecycle
suite holds real raster responses across replacement, folding, and teardown. It
also checks exact watch cleanup, individual descendant field changes, deferred
code previews, and draft recovery without writing to a live graph.

Artifacts use `/tmp/nautilus-desk-verify`, `/tmp/nautilus-desk-collapse`, and
`/tmp/nautilus-desk-preview-lifecycle`. Override them with `DESK_TEST_OUT`,
`DESK_COLLAPSE_TEST_OUT`, and `DESK_PREVIEW_TEST_OUT` for separate runs. The feedback
suite (`npm run test:desk-drop-feedback`) uses `/tmp/nautilus-desk-drop-feedback`
(override with `DESK_DROP_FEEDBACK_TEST_OUT`);
`test:desk-scope` and `test:desk-drag-parity` use `/tmp/nautilus-desk-scope` and
`/tmp/nautilus-desk-drag-parity` (override with `DESK_SCOPE_TEST_OUT` and
`DESK_DRAG_PARITY_TEST_OUT`); `test:desk-polish` covers full previews, aligned
controls, wheel response, reduced motion and cleanup (`DESK_POLISH_TEST_OUT`).
`desk-removal.py` exercises the real footer against a synthetic graph
(`DESK_REMOVE_TEST_OUT`); no live graph deletion or promotion has been tested.
Set `ROAM_NATIVE_CSS` and `ROAM_BLUEPRINT_CSS` to host stylesheet snapshots to test
against actual Roam CSS. `ROAM_ICONS_CSS` and `ROAM_FONT_CSS` can supply native
icon/font styles with locally resolved assets. These fixtures do not establish
fresh live-host Pull Watch behavior.

On 2026-10-26, a read-only check in real Roam verified the native DOM and computed
styles, five-column embedded layout, native editor mounting, outline hiding and
restoration, and visible editor children. No live notes were created or reordered;
write behavior is validated in isolated fixtures. The native reference is Roam's
current [site.css](https://roamresearch.com/assets/css/less-compiled/site.css) and
[route-app.js](https://roamresearch.com/js/compiled/route-app.js). The extension does
not call private minified functions or bundle the Roam client source.

## Renderer upgrades

This single-entry policy supersedes earlier per-revision source-UID guidance.

The canonical source UID is permanently `roam-render-Nautilus-Log-r2-cljs`. The `r2`
spelling is retained as an opaque graph identity; it does not request another code block
when a future source revision is released. The current source is revision 2, with namespace
`nautilus-log-r2` and a version-local runtime bridge. Future source changes advance the
source marker, namespace, and bridge revision while retaining this code UID.

An absent canonical source is created once; byte-identical content is reused. A forward
upgrade replaces that same block only when its old bytes match a bundled published-source
SHA-256 and its title/header/source ancestry still verifies under `roam/render`. Custom,
same-revision divergent, unknown, or newer code is preserved and reported. Source ownership,
editor state, graph/user scope, and content are checked again after asynchronous work.
Git hashes remain build metadata, not version ordering. Source history belongs in Git;
normal upgrades do not create archived graph copies.

Automatic migration is limited to one unambiguous managed template reference and the
active Primary Plan reference, including an existing previous-date overnight owner. It
changes only the renderer UID. Prefixes, argument text, attributes, children, and order
remain intact. Active editors are not overwritten. Multiple or structurally unsupported templates and newer
renderer roots are not guessed, renamed, or migrated backward. Newer family members still
count as existing plans for discovery and duplicate prevention.

Keep one managed template in `roam/render` → `Nautilus Log`. Its label may change while
retaining `[[roam/templates]]`: the verified owning section and single renderer root identify
it, so startup, settings updates, and plan creation reuse the existing UIDs and full subtree.
Incomplete or conflicting marker blocks in that section are reported as unsupported, not
missing; they do not authorize another default template or a blank fallback plan. Existing
legacy-name templates on `roam/render` remain part of the same ambiguity check. Unrelated
templates under other owners are not adopted. Keep the managed template in this section;
there is no registry that follows arbitrary moves outside it.

An intentionally empty template is valid: it has one renderer root and no task/event
children. Reloading preserves that empty tree, and creating a plan copies only the root.
Ordinary notes stored elsewhere are never pulled back in or used to refill it. This is
not permission to clear a populated template to change its appearance.

The verified managed template uses a **Template preview** heading. Its fixed schedule,
reference tasks, estimates, native child hierarchy, and diagram remain intact. Remaining
capacity, no-fitting-slot/unscheduled totals, and time-elapsing indicators are hidden in
this template view, including their accessibility text. Actual dated plans retain their
normal time state. This presentation distinction never moves blocks, changes task text or
settings, or stops an active timer. Main, sidebar, and embedded copies share the same
verified template identity; unrelated renderers are not styled as templates.

Default template, render-reference, code-group, and canonical source UIDs are stable
identities. Graphs with legacy code can be explicitly consolidated: inspect every incoming
reference, change only supported renderer UID spans to the canonical entry, verify the
unchanged surrounding text and tree, then remove the old source only after its references
reach zero. Do not choose a template merely because it is populated or uses the newer UID;
an empty template may be intentional. Resolve that choice with the owner.

If a template reports **multiple renderer blocks**, inspect the container before changing it.
Keep the intended renderer and its complete subtree. A genuinely obsolete empty reference
or empty administrative holder can be deleted after checking that it has no incoming links.
Referenced source code and meaningful user content need separate handling, not automatic
cleanup. Reload after correcting the structure to clear the startup notice. The extension
never chooses or deletes an ambiguous root automatically. Notices follow whole-widget
folding and remain available when the chart is expanded.

A bounded `renderer-migration-pending` record is saved and read back before a reference
write. It holds graph/user identity, UIDs and SHA-256 hashes, with a 64-record / 32 KiB
limit and no block text. An uncertain result remains verification-only across reloads;
there is no automatic retry or replacement-plan fallback. Only the exact recorded after-hash
can retire a reservation; a different r2 invocation is not confirmation. Inspect the referenced block
and the original request rather than deleting/recreating the plan.

Source upgrades use a separate bounded `renderer-source-upgrade-pending` store with the
same exact-after-hash confirmation rule. No source body is stored in settings. A pending
source update cannot be retried or replaced by creating a second code block; a missing
canonical block is not recreated while its prior update is unresolved. Source readiness
and plan creation remain blocked until that receipt is confirmed.

Startup does not scan or rewrite historical pages. Explicit reference consolidation is a
separate operation; after it, those pages render through the same latest code entry while
their note content remains unchanged. A compatibility reader remains for graphs that have
not consolidated legacy references. Current chart, Desk, and Help retain their own bridge
ownership. Update all clients: older packages cannot be controlled retroactively and may
recreate legacy structures or retain old loaded code. Reload updated clients after a source
upgrade. The current renderer does not depend on mutable legacy globals.

## Execution Layer

The optional Execution Layer defaults to **off**. Its advanced settings remain hidden
until enabled. While it is off, Nautilus Log still mounts a 30px create/open launcher
and one calendar-day command, but no execution panel, 1s ticker, or CLOCK writer. The chart
may still read existing LOGBOOK/CLOCK history.

When no active plan exists, **+ Create today's plan** copies the managed template to the
calendar date. **Nautilus Log: Create or open today’s Daily Note plan** always targets that
date explicitly, regardless of the page you are viewing. The action appends a frozen copy
of the single managed renderer root and its complete ordinary descendant tree. Every
new block receives a new UID; references inside that tree are remapped and
external references remain unchanged. Any recognized Nautilus renderer already
on that page, including an empty or all-DONE plan, is locate-only. Multiple roots,
top-level template siblings, dynamic/unreadable content, or unavailable required
fields fail closed with a specific reason and **View template**. LOGBOOK/CLOCK
history is not copied. The root string is preserved, not regenerated from settings;
`open`, heading, alignment, and children view type are preserved too. No panel,
confirmation, or manual `;;` intervenes on a normal create click. Nothing is created
on load or at midnight.

Loading, confirmed absence, unsupported templates, partial writes, and failures
have separate states. **Check again** only rereads; a navigation failure only
retries opening. Creation requires a known graph, Web Locks, and a read-back
settings receipt with destination identifiers, parents/orders, and SHA-256 hashes,
not private template text. Settings are not a global lock. WebLocks coordinate
participating browser contexts, not devices or manual writers.

**Creation incomplete** opens diagnosis and verified-block counts. **Inspect created
blocks** is read-only and never clears partial status. **Continue creation** is
available only to the original in-memory operation: it verifies unchanged text,
attributes, parents, and order before appending just the missing blocks. After
reload there is no continuation from a newly read template. Corrupt receipts fail
closed; keep the created contents for inspection rather than deleting/retrying a
second copy. Occupied UIDs are never overwritten, and success requires full exact
tree readback, including the root's Daily Note membership.

Before the first template request, a date change stops the action. After writing
starts, it finishes the frozen original day and explains midnight without showing
that plan as today's ready state. Graph changes and unload stop following work;
already-issued host requests cannot be rolled back. A page created before a later
pre-template failure may remain empty. Such failures are retryable when no template
request was made.

No new per-second graph queries are added. Normal discovery can reuse runtime data.
Overnight selection reads at most the relevant calendar-day and previous-day candidates;
unknown global hours are resolved from supported plan arguments. Checks occur at
initialization, foreground return, midnight/END, relevant owner changes, and explicit
actions. Unchanged tracking ticks do not rediscover the date or reread template receipts.
A manually inserted plan is found at the next check, not on every keystroke.

When Execution Layer is enabled, the first Nautilus Log on the active workday's Daily Note becomes
the **Primary Plan** used by the topbar panel. After a successful create, the existing
capacity text or 136×4 energy bar returns and the plan is opened in the main window.
If CLOCK/POMO is already running without a plan, its timer and applicable stop
controls stay visible; use the create button in the panel's **Plan** empty-state.

When a plan is present, click the Nautilus topbar trigger to open the panel, Option/Alt-click it to locate
the Primary Plan in the main window, or Shift-click it to open or bring the same
block to the top of Roam's right sidebar.

| View | Purpose |
| --- | --- |
| Timing | Current Timing Line and recently closed tasks |
| Plan | Unfinished direct-child tasks from the Primary Plan |
| Review | Active workday's Planned, Actual, and valid variance states |

Switching tasks closes the previous CLOCK and opens the next at the same instant.
Before starting, Nautilus checks running CLOCKs rather than trusting a tab's cache.
Graph-scoped Web Locks serialize CLOCK writes across tabs in the same browser storage
partition, and notifications prompt other tabs to reread the graph. Missing graph
identity or Web Locks blocks CLOCK mutations. These locks do not coordinate other
profiles or devices, nor guarantee that Roam has finished synchronizing their data;
avoid controlling timers concurrently from those environments.
With **Keep Timing Line first in right sidebar** enabled, Clock In also opens or moves
the active task to the top of Roam's sidebar.

In the panel, Left/Right arrows and Home/End navigate the tabs. Structural updates
preserve focus and list position; completing a row moves focus to a surviving task
or the selected tab. Escape closes the panel and returns focus to its trigger.
Plan times after midnight include an explicit **next day** label.

### Active overnight workdays

For a November 1 plan with a 21:00–02:00 window, 00:30 on November 2 still belongs to
November 1: the logical minute is 1470 and 90 minutes remain. Plan, capacity, task actions,
and Review use that owner. Global hours take precedence when present; otherwise supported
renderer arguments define the window. An unreadable previous candidate is an error, not
proof that it is absent.

The lightweight launcher opens the active owner and names its date. In the execution
popover, the workday date and END are visible; a separate dated button opens or creates
the calendar-day plan. The calendar-day command has the same explicit target. Creation
retains its frozen date, template, receipts, and no-duplicate checks. It never recreates
yesterday or silently creates a second plan when an old Open target disappears.

At END, selection returns to the calendar date. No boundary automatically stops a CLOCK
or completes a task. A previous-owner timer keeps its date and explicit Stop control;
its task is not exposed as a writable member of the new plan. Queued actions recheck the
owner under the lock. Once accepted, an action keeps its original owner and instant
through subsequent CLOCK/completion writes rather than retargeting after rollover.

### Optional capacity energy bar

Enable **Show capacity as an energy bar** to replace the ordinary one-line
topbar token with a borderless two-level depth gauge. Its fixed 136×4px capsule
uses an OpenUsage-like slim profile, with fully rounded ends and no border, shadow,
or decorative end structure. The
track sits above the topbar centerline, while the lower row is one left-aligned
phrase such as `42% free · 3h20m planned`. The two rows fold symmetrically around the
centerline. While CLOCK or POMO runs, its timer and stop control remain centered
on that line instead of aligning to the track:

- the same gray-blue as Roam's right-side toolbar icons is flexible reserve
  after all unfinished demand;
- lighter sea green is unfinished planned demand reserved within today;
- the quieter cool-gray track is flexible capacity that has elapsed;
- `OVER +Xm` or `NO SLOT Xm` appears once in the lower summary, using the
  existing warning color without duplicating the warning on the track.

Every width uses the full day's flexible capacity as its denominator. Fixed events
remain excluded, untimed work uses Default Todo Duration, and the clock contracts
the bar once per minute without another Roam read or timer. Both energy and text modes
use the same live projection; time-only updates preserve task action nodes. Confirmed completion
from the panel keeps the exact planned reading visible, confirms that number in
place, and settles both track layers on one short width transition. A failed write
changes nothing; external TODO/DONE or duration edits redraw silently without a
completion cue. This is a time-capacity display, not a measure of physical or
mental health. In full
density the gauge itself is the clickable trigger, so the leading Nautilus icon
and divider disappear. Missing capacity data or constrained space restores only
the icon, leaving no detached bar or status text beside Roam search.

### Referenced task ownership

- A bare `((source TODO))` keeps its TODO/DONE state in the real source block.
  Completing it from Nautilus Log changes that source TODO to DONE; its CLOCK remains
  under the active workday's direct wrapper, so Actual belongs to that owner.
- An explicit outer `TODO ((source))` owns today's state. Completing it changes only
  the outer marker and never rewrites the reusable source.
- A bare reference whose source was already DONE is absent from Plan and Review. If
  the source becomes DONE after today's wrapper recorded Actual, Review keeps that
  wrapper as today's completed work.
- Nested reference chains follow the nearest explicit TODO/DONE owner. Nautilus Log
  watches only the exact sources used by the Primary Plan; it does not add a graph-wide
  status scan.

Recent retention defaults to 45 minutes. Standalone POMO remains inside **Execution Layer ·
Advanced** and shares its startup check: disable the separate Roam Logbook extension first,
even if you only want POMO. It has no independent entry or second timer runtime.
The Pomodoro threshold defaults to 45
minutes and changes the live signal without stopping work. When no task CLOCK is
active, the panel-header stopwatch starts a standalone count-up POMO. It writes no
Roam blocks and does not affect Actual, Planned, Review, or the spiral; starting a
task CLOCK clears it because CLOCK always has priority. While standalone POMO is
running, the same panel-header action becomes **Stop POMO**, so it remains available
even when a narrow topbar shows only the Nautilus icon. Completing another task does
not stop the currently focused CLOCK or reset its Pomodoro cycle. The forgotten-timer
warning defaults to 120 minutes and never stops or deletes a CLOCK. Enter `0` to disable
Recent or the forgotten-timer warning.

## Planned and Actual history

- Unfinished tasks are scheduled from Planned estimates.
- Completed flexible tasks prefer total valid Actual time within the owner's evidence bounds.
- Multiple CLOCK sessions remain separate in `LOGBOOK::`, while the spiral combines
  their total into one historical slice.
- Actual time is never capped at Planned time.
- Without Actual, completed tasks use their explicit estimate or Default Todo Duration
  (15 minutes by default). A local `d18:21` stamp anchors that duration when present.
- Without either local anchor, the estimate is allocated from START in outline order,
  around fixed events and anchored history. Dashed outlines and the tip distinguish
  estimated placement from recorded completion times. Genuine capacity overflow retains
  the task's title and duration; missing CLOCK or stamps never erase the estimate.
- CLOCK evidence starts at the owner's local midnight and includes at least the next
  calendar midnight, extending to overnight END when that is later. A normal 06:00–20:00
  budget still counts a 22:00 CLOCK. Local calendar boundaries handle daylight-saving changes;
  durations measure elapsed time while displayed endpoints remain local clock labels.
- In a 21:00–02:00 owner window, local `d00:15` is interpreted as next-day 00:15; a local
  23:30–00:15 CLOCK contributes 45 minutes to both chart and Review. An exact 24:00 endpoint
  can use matching local CLOCK evidence. Dateless referenced stamps keep their separate
  interpretation and do not acquire a source completion date.

Todo Trigger is optional. Its completion timestamp can supply the `dHH:MM` anchor,
but ordinary planning and completion do not require it.

## Settings

| Setting | Default |
| --- | --- |
| Language | English |
| Chart Start Time | 05:00 |
| Chart End Time | 21:00 |
| Component Prefix | `[[Nautilus Log]]` |
| Legend Max Length | 22 |
| Default Todo Duration | 15 minutes |
| Urgent Trigger Word | Empty |
| Google Calendar | Not connected; Primary calendar after connection |
| Completion timestamp | Off |
| Execution Layer · Advanced | Off |
| Show capacity as an energy bar | Off |
| Keep Timing Line first in right sidebar | On |
| Pomodoro Threshold | 45 minutes |
| Recent Retention | 45 minutes; `0` disables |
| Forgotten Timer Warning | 120 minutes; `0` disables |

Component Prefix is display-only text for newly inserted components. It may be
changed or left empty; Primary Plan detection follows Nautilus Log's stable
renderer identity instead of this label.

Chart start can be any whole hour from 00:00–23:00. Chart end can be 01:00–24:00;
an end hour at or before Start is explicitly labelled **next day**. For example,
21:00–02:00 is one continuous 300-minute window owned by the Daily Note where the
component appears. Existing templates keep working and the default remains
05:00–21:00.

Execution-specific settings are revealed only while **Execution Layer · Advanced** is
enabled.

Google Calendar is configured through one visible connection row: click
**Connect**, choose your Google account, and approve read-only Calendar and
Tasks access. Connected state and **Disconnect** remain visible in Settings;
users never enter developer credentials or Calendar IDs. Each chart click reads
only the selected date; there is no timer, background poll, or seven-day
prefetch. Timed Calendar events remain fixed; dated Tasks are imported as
flexible TODO/DONE rows with the configured Default Todo Duration. See
[Google Calendar sync](./google-calendar-sync.md).

## Commands

The Command Palette exposes:

- **Nautilus Log: Create or open today’s Daily Note plan** (always available; calendar date)
- **Nautilus Log: 1. Focus current block** (Execution Layer on)
- **Nautilus Log: 2. Clock out Timing Line** (Execution Layer on)
- **Nautilus Log: 3. Locate Primary Plan** (Execution Layer on)

Bind them in **Roam Settings → Hotkeys**. TODO context menus also expose Clock In and
Clock Out while tracking is on.

## Local acceptance and API limits

`npm test` includes the actual source-query/freeze/session/adapter path over a
low-level graph fixture. `PYTHONDONTWRITEBYTECODE=1 npm run test:ui` includes real
session clicks through both launchers, not fabricated ready-state responses.
Screenshots and results are in `/tmp/nautilus-real-today-plan`. Official Roam schema
and type evidence, exact integrity rules, and platform limits are documented in the
[full-template design](./plans/2026-09-10-full-template-creation-design.md).
No live Roam Desktop graph was used; native mutation/Pull/settings behavior remains
a live-validation boundary. `test:renderer-versions` evaluates complete frozen v1 and
current CLJS in both orders with real bridge/session/watch/Desk services and actual legacy
scaffold writes. `test:overnight-ui` checks both launchers, explicit calendar creation,
owner-date labels, 45-minute Review, absent global hours, and a running CLOCK across END.
Set `NAUTILUS_VERSION_OUT` or `NAUTILUS_OVERNIGHT_OUT` for separate output directories.
Skipped cases remain unverified; none of these fixtures certifies OS IME, atomic native
Undo, Calendar authorization, or cross-device synchronization.

## Data and safety

Actual time is stored as compatible Org-style graph data:

```text
{{[[TODO]]}} Task 30m
  - LOGBOOK::
    - CLOCK: [2026-08-22 Sat 10:00]--[2026-08-22 Sat 10:18] => 0:18
```

Disable the separate Roam Logbook extension before enabling Actual Time Tracking;
Nautilus Log refuses to start a second CLOCK writer. Multiple charts may exist on a
page, but only the first chart on the active workday's Daily Note becomes the execution panel's
Primary Plan. Breadcrumb and collapsed-path replicas skip expensive chart rendering;
right-sidebar views use the compact chart with a folded Schedule section. Unloading
the extension does not rewrite or delete user blocks.
