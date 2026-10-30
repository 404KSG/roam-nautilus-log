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
- A duration written after the reference overrides the source duration. Source
  completion time and CLOCK history are never inherited.
- Legacy `dNN%` text has no scheduling meaning. Nautilus Log keeps it as ordinary
  block text and always schedules the full estimate.

## Scheduling rules

1. Fixed events claim their written time ranges.
2. Pending direct-child tasks are read in Roam block order.
3. Starting at the current moment, complete tasks fill the next continuous gaps large
   enough for them.
4. Time passing moves unfinished work forward without changing priority.
5. Tasks that cannot fit before the configured end enter **Today won't fit**.

The scheduler is deterministic and does not generate estimates. A task remains atomic:
if it cannot fit one gap, it moves to the next suitable gap instead of being split.

## Header metrics

| Metric | Meaning |
| --- | --- |
| Planned | Remaining flexible-task demand; `left` percentage = `current free time ÷ full-day Available` |
| Remaining | Available time left after Planned demand |
| Overload | Demand beyond available time |
| No fitting slot | Time exists in total, but no continuous gap can hold an atomic task |
| Available | Flexible time remaining now / full configured-day flexible time |
| Events | Fixed-event time remaining now / full configured-day event time |

Overlapping events are counted as a union, so one minute is never counted twice. The
small flame marks whether the current minute is consuming Available or Event time.

## Visual language

- Red: urgent task
- Cool neutral fill: fixed event
- Light indigo fill: planned flexible task
- Stronger indigo fill: timed completion, with readable labels
- Indigo outline outside the hour grid: a record without a position on this time axis
- Dashed outline: pending work that has not been scheduled
- Red needle: current time, confined to the time spiral
- Pale, solid past fill: elapsed time without a recorded interval

Past gaps are factual schedule data, not a judgment that time was wasted.

## Chart controls

- **Desk (four-square icon):** expand or collapse unfinished-task cards below the chart, then click a card to focus and edit it.
- **Eye:** show or hide completed diagram records and their connected labels.
  It defaults to showing them and does not affect Desk, which only shows unfinished tasks.
- **Calendar:** after Google Calendar reports Connected in Settings, import
  timed busy events and dated Google Tasks for this chart's Daily Note.
  Option/Alt-click force-refreshes only the Google-managed strings.
- **Tidy:** move completed tasks and elapsed fixed events to the front while
  preserving the exact relative order of active work. Tidy moves direct-child
  wrappers by UID, never changes task text, times, references, or descendants,
  and offers one Undo unless the Plan is edited again first.
- **Collapse:** folds the entire rendered Nautilus UI, including any Desk cards,
  toolbar, and focus dialog. The compact state leaves only the existing expand
  control. The original plan outline stays hidden while Desk is selected, and the
  saved Desk preference is unchanged. Expand restores the spiral and, when Desk
  was selected, its cards.

Every titled source task or event has a visible diagram mark and a connected label.
Ordinary titles wrap inside the SVG rather than disappearing when a label budget is full.
At narrow widths the labels use two connected columns within the same diagram. The frame
uses the full source titles and local container width: source edits may change its height,
but clock updates, completion visibility and hover do not resize it.

Completed tasks without a usable interval, pending tasks that do not fit, and fixed ranges
outside the displayed hours remain in a separate **Not time-scaled** track around the
spiral. Each mark has its own label. Its angle and area are not clock time or duration;
a single record never becomes a full progress ring. Slots are reserved from the stable
source collection, so END does not redistribute existing untimed records. The original
time intervals, pending scheduler, capacity and Actual calculations remain separate.
Inherited completion is identified as coming from its reference; source time is not
borrowed for today's wrapper. There is no task inventory or scrolling Schedule below the plot.

Hover or keyboard-focus a record or available slot to read its context in a centered
area capped at 400px, inset by 16px in narrower workspaces. It wraps rather than scrolling.
The closed area reserves 64px and is invisible when idle. **Full text** explicitly expands
long content in the page, without a nested scrollbar, and pins it while you read. Collapse
it to resume the compact view. Changed or removed records invalidate the pinned text.
The area does not follow the pointer or cover the plot. Click or Enter on a flexible task's
mark or label locates its original block; Shift opens it in the sidebar. These actions
never rewrite the task or its time. If the block is folded, navigation uses Roam's official
block API.

## Desk task view

Click the chart's **Desk** button to expand cards below it; click again to hide
Desk. The view uses Roam's `rm-desk-*` and Blueprint styles rather than a separate
font, size, or card theme. Desk stays within the same local renderer width as the
chart above, including centered Daily Notes, sidebars, and embeds. It does not
expand to the article wrapper or use a compensating negative margin.
Native auto-fill determines the column count;
there is no fixed two-column layout or three-column cap. The embedded root does
not use Roam's full-page `rm-desk-page` marker: current host styles use that marker
to change ancestor padding and impose a viewport-sized canvas. Only native card
sizes are retained locally; opening this component must not change page spacing. Search, New note and Hide Desk
share one flex-aligned tool group, so the close X stays aligned with the plus
control at wide and narrow widths, with the same keyboard order.

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
- **Plus adds content under this plan.** **New note** in the overview and **+** in
  the focus header open a native-style draft. The first committed, nonblank input
  creates one direct child at the start of the current Nautilus block, then hands
  editing to Roam. Closing an untouched draft creates no empty block; IME text is
  not written before composition ends. No TODO marker is forced. Content classified
  as an event or DONE is saved but excluded from active cards.
- **Native focus editing.** Click a card to edit its original UID, path, and children
  with `renderBlock`; Shift-click opens it in the sidebar. **Option/Alt + comma** is
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
(or the background). Desk preserves the original block and creates one local
`TODO` reference wrapper under the current plan. Left/right card halves choose
before/after (mirrored in RTL), with the same native insertion rail and number.
Background adds after the last unfiltered active task (or first in an empty plan).
Accepted native transfers use the copy cursor; move-only or link-only transfers
are not imported. Files, pages, queries, embeds/renderers, events, ambiguous/multi-block and
cross-graph payloads are rejected. Nautilus ignores modifier gestures and leaves
those events entirely to Roam; it does not suppress Roam's own modifier behavior.
Repeated drops reuse the same deterministic wrapper. An unconfirmed attempt in
that running view is verification-only; reload checks the same reserved UID and
never allocates a second UID for that source and plan. Imports require the public
`data.pull` and `data.block.create` APIs and a verifiable graph/type/user context.
Progress temporarily uses the existing title area, leaving Search, New note, and
Hide Desk unobstructed. Hover over a truncated message to read it in full. The
full message is also announced to assistive technology; terminal feedback clears
after five seconds and restores the title without moving the cards.

The import and Escape-prelude checks use synthetic graphs and a fake in-memory
Copy callback. The editor-first fix is implemented, but the live macro workflow
remains unvalidated: no physical drop, real clipboard, app switch, paste, or send
was exercised.

Removal, moves, and creation share Tidy's graph-scoped `outline` Web Lock.
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
A host API response alone is not confirmation. An uncertain create is checked
using its reserved UID, never blindly repeated with a new UID. Locks do not cover
other devices or manual writers; concurrent changes fail conservatively. Read
failures retain visibly stale cards and pause writes. Hide Desk to inspect the
original outline.

### Temporary Desk diagnostics (Draft preview)

Diagnostics are **off by default** and reset on reload. Use Roam's command palette:

1. **Nautilus Log: Start Desk diagnostics (temporary)**, then reproduce the issue.
2. **Nautilus Log: Show Desk diagnostics** to inspect the report. **Capture layout**
   adds a current measurement; **Download report** exports a local JSON file.
3. **Nautilus Log: Stop and clear Desk diagnostics**, or **Close diagnostics**, to
   stop observation and erase the in-memory report.

The bounded report keeps at most 40 events: layout sizes/scroll positions and
fixed reason codes for Desk transitions and focus-dialog dismissal. It records
no note text, typed input, raw keys, URLs, graph/block identifiers, or credentials.
It does not use storage, send data, or write to the graph. Export happens only
when you click Download report. The build revision is included when available.
The report panel does not lock page scrolling or automatically take editor focus.

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

## Execution Layer

The optional Execution Layer defaults to **off**. Its advanced settings remain hidden
until enabled. While it is off, Nautilus Log still mounts a 30px today-plan launcher
and one create-or-open command, but it loads no execution panel, 1s ticker, CLOCK
writer, or LOGBOOK reader.

Click **+ Create today's plan** (or the command) to append a frozen copy of the
single managed Nautilus renderer root and its complete ordinary descendant tree
to the local-calendar Daily Note, regardless of the page you are viewing. Every
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

No new per-second graph queries are added. With execution on, discovery reuses
runtime data; with it off, checks occur at initialization, throttled foreground,
midnight, and explicit actions. A manually inserted template is found at the next
check, not by scanning on every keystroke.

When Execution Layer is enabled, the first Nautilus Log on today's Daily Note becomes
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
| Review | Today's Planned, Actual, and valid variance states |

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

### Optional capacity energy bar

Enable **Show capacity as an energy bar** to replace the ordinary one-line
topbar token with a borderless two-level depth gauge. Its fixed 136×4px capsule
uses an OpenUsage-like slim profile, with fully rounded ends and no border, shadow,
or decorative end structure. The
track sits above the topbar centerline, while the lower row is one left-aligned
phrase such as `42% left · 3h20m planned`. The two rows fold symmetrically around the
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
the bar once per minute without another Roam read or timer. In energy mode, the open
panel uses the same projection; time-only updates preserve task action nodes.
Text-only mode retains its existing cached projection. Confirmed completion
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
  under today's direct wrapper so Actual still belongs to today.
- An explicit outer `TODO ((source))` owns today's state. Completing it changes only
  the outer marker and never rewrites the reusable source.
- A bare reference whose source was already DONE is absent from Plan and Review. If
  the source becomes DONE after today's wrapper recorded Actual, Review keeps that
  wrapper as today's completed work.
- Nested reference chains follow the nearest explicit TODO/DONE owner. Nautilus Log
  watches only the exact sources used by the Primary Plan; it does not add a graph-wide
  status scan.

Recent retention defaults to 45 minutes. The Pomodoro threshold defaults to 45
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
- Completed flexible tasks prefer total valid same-day Actual time.
- Multiple CLOCK sessions remain separate in `LOGBOOK::`, while the spiral combines
  their total into one historical slice.
- Actual time is never capped at Planned time.
- Without Actual, Planned history requires an explicit completion anchor such as
  `d18:21`.
- Without an Actual end or completion anchor, Nautilus Log does not invent a history
  interval. The item remains visible as its own labeled, non-time-scaled diagram mark.
- For an overnight chart window, next-day CLOCK time remains part of the owning
  Daily Note until that window ends.

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

- **Nautilus Log: Create or open today’s plan** (always available)
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
a live-validation boundary.

## Data and safety

Actual time is stored as compatible Org-style graph data:

```text
{{[[TODO]]}} Task 30m
  - LOGBOOK::
    - CLOCK: [2026-08-22 Sat 10:00]--[2026-08-22 Sat 10:18] => 0:18
```

Disable the separate Roam Logbook extension before enabling Actual Time Tracking;
Nautilus Log refuses to start a second CLOCK writer. Multiple charts may exist on a
page, but only the first chart on today's Daily Note becomes the execution panel's
Primary Plan. Breadcrumb and collapsed-path replicas skip expensive chart rendering;
right-sidebar views use the compact chart with a folded Schedule section. Unloading
the extension does not rewrite or delete user blocks.
