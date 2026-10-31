# Changelog

## Unreleased

### Added

- Past blank intervals can be inspected with hover, click or keyboard focus. Contiguous
  gaps keep their complete range and duration across hour boundaries, with a neutral
  explanation that actual activity is unknown. Click or Enter/Space pins details; Escape
  dismisses them, and changed intervals invalidate stale selection. Hidden completed
  estimates still occupy their intervals; unfinished past-day tasks remain in their queue.
- Task/event detail names retain their static light/dark gradient, with solid fallbacks
  for forced colors and print. Dates, category dots, metadata and gap explanations keep
  their own colors.
- Roomy tips use local width rather than a universal 280px cap. Above 360px, titles and
  displayed metadata wrap completely; More reveals extra information. Compressed views
  retain a bounded preview and explicit full text.
- Tips use compact two-line note chrome: 36px normal content in a 38px minimum slot,
  2px vertical/6px horizontal padding and 4px corners, without shrinking the 12px/11px type.
  More spans both rows with its 24px hit height intact. Wide wrapping and explicit expansion
  grow in page flow without covering Desk. The SVG's empty tail is 2px; time paths, center
  and label positions are unchanged.
- Desk uses only the sliding control; its name appears on hover or keyboard focus and
  remains available to screen readers. Checked state follows the actual view and saved
  preference through Hide Desk, reload, fold/expand and replacement controls. Click,
  Space/Enter, Alt navigation and reduced motion remain supported.
- Past unfinished tasks no longer get replanned from START into false historical slices
  or counted as active Planned demand. They remain in a default-collapsed Unfinished
  queue. Today/future tasks without a fitting whole slot enter Unscheduled. Queues preserve
  full titles, estimates, original UIDs and navigation; no task is moved or completed.
  Unfinished uses a yellow disclosure arrow and a readable yellow-family heading;
  counts and duration remain muted, task rows use blue, and Unscheduled remains neutral.
- Source-sized frames stay stable for ordinary motion of the same diagram members, hover
  and Eye. Genuine queue membership changes (including before END), day relation changes
  and source edits may relayout. Queue expansion does not resize the SVG. No empty duplicate
  overflow band or production host-padding compensation is introduced.
- Native Desk masonry is retained, not rebuilt. Additional geometry checks verify that
  later cards fill beneath the shorter column, while existing resize and image-load tests
  retain native row spans and task/DOM order.

- Completed tasks without actual timing now receive spiral slices using their explicit
  estimate or Default Todo Duration (15 minutes by default). CLOCK and completion stamps
  are optional. Unanchored estimates are allocated from START in outline order around
  fixed events and anchored history, without changing pending scheduling or Actual.
  Dashed gray outlines identify estimated placement and remain visible over pending
  forecasts. Genuine capacity overflow retains the title and duration. The rejected
  Completed / No timestamp node and its upper connection band are removed.
- Red urgency, yellow events and blue tasks form the current category palette. Separate
  darker text tokens keep light-theme labels readable without turning the legend dots brown.
  Readable neutral completion text without
  strike-through, and whole-connection focus replace the disconnected, faded
  presentation. Other text is not dimmed. No completion time is inferred from
  last edits or borrowed from a reference source.

- The minute clock now resynchronizes on foreground focus, visible-page return,
  page show and CLOCK updates, including a same-minute next-day resume. The new
  integration gate verifies scheduler intervals and actual SVG path movement;
  fixed events remain anchored and still block pending work.
- The chart retains its time vocabulary: blue tasks, yellow fixed events,
  solid gray completion history and pale hatching for unrecorded past time. Current
  tasks and events remain outlined. The spiral is the only time geometry; the rejected
  outer track and its status badges are removed. Explicit urgency remains authoritative.
- Short tips fit their content without stretching across the workspace. Roomy views show
  the full title and current metadata without a redundant title-unlocking action. Narrow
  previews and extra metadata can explicitly expand, without internal scrollbars or overlays.

- Every titled source record remains in the diagram or the pending queue. Completed
  estimates connect to their slices; DONE estimate overflow and out-of-window ranges keep
  separate endpoints and never enter the unfinished queue. Estimated positions are not
  recorded completion times. Timed labels stay on their slice's side. Desk retains its
  independent unfinished-task projection.
- Source-sized frames replace the rejected finite label budget. Ordinary titles wrap,
  including CJK, and narrow views retain connected diagram labels instead of a scrolling
  Schedule. Frame height follows the diagram membership, its source titles and local width,
  not pointer movement or ordinary minute motion within the same membership. The spiral,
  whole-task scheduler, Actual and completed-estimate allocation remain intact.
- Details stay centered within the local workspace. Wide content wraps in page flow;
  explicit expansion can pin additional information or narrow-view full text. The minimum
  38px slot is invisible when idle. The rejected below-chart completion list, its reserved
  gap, and wheel-based text reading are removed.
- Narrow charts keep side labels, readable major hour ticks and a compact center date.
  Hour sizes are applied directly to SVG text instead of relying on a CSS variable that
  the renderer did not emit. Past-time patterns have unique mounted-instance IDs.
  No new dependency, font, navigation shortcut, graph-write authority or persistence
  feature is added.

- Remove from Desk deletes only verified childless plain local reference wrappers.
  Content-bearing cards move with the same UID and subtree to the plan's verified
  owning Daily Note, including historical/future notes. Public APIs, overview/focus
  admission, graph serialization, exact preflight/readback, and retained uncertain
  reservations guard the action. No source deletion, page creation, copy/recreate,
  compensating write, or destructive shortcut is added. Tests use synthetic graphs.

- Desk accepts one ordinary same-window, same-graph native Roam block drop as a
  local TODO reference while preserving the original. Files, pages, renderers,
  events, ambiguous payloads, and cross-graph sources are rejected. Modifier
  gestures are ignored by Nautilus and remain Roam-owned. Repeated drops and
  reloads use the same reserved UID rather than allocating another wrapper UID.
- Internal and accepted external drags use current native Desk's gray top-right
  full-collection position pills, vertical insertion rails, and resulting-position
  labels. Left/right halves choose before/after (mirrored in RTL). The previous
  custom footer badge is removed. Alt-only blue counters retain visible first-nine behavior. Ready updates reconcile
  detached sources and clear stale drag state without attempting a stale move.
- The Draft preview includes opt-in Desk diagnostics through the command palette.
  It defaults off, retains at most 40 local in-memory geometry/reason events, and
  clears on stop, panel close, or unload. It does not record note/input text, raw
  keys, URLs, graph identifiers, or credentials, and does not send data or write
  to the graph. A report can be downloaded only by an explicit user action.
  The native page-scope cause of horizontal movement is fixed below; confirmation
  in the updated live Desktop build and unrelated whitespace remain separate.
  The editor-first Escape fix covers the simulated copy prelude only; the live
  macro's clipboard/navigation/send workflow remains unvalidated.
- Nautilus Desk reuses Roam's native Desk/Blueprint styles, native grid-span
  masonry, and the same local width as the chart above. It hides only the
  original plan's child outline while active and restores it on close or unload.
  Graph/plan-scoped view flags survive page navigation and reload in localStorage.
- Drag sorting and the footer's Move to top now move the original outer block,
  changing actual outline priority and scheduling. Writes share the outline lock,
  revalidate the target, and verify the result. View-only ordering has been removed.
- Plus controls open a native-style draft under the current Nautilus block. First
  committed text creates one direct child; untouched drafts create nothing. Buffered
  input and uncertain responses are handled using a reserved UID, without blind
  duplicate creation. Native editing then uses the original block and its children.
- Native Next/Previous boundaries, the new-note slot, search, and Alt+1–9 selection
  are supported. Completed tasks and events remain excluded as cards; completed
  child logs remain visible. Browsing does not control CLOCK or Roam's own Desk
  collection. An earlier read-only Roam probe verified styles, the then-five-column layout,
  native editor mounting, and outline hiding/restoration. Graph writes are tested
  with isolated adapters, not by modifying live notes.

### Fixed

- Removed the timestamp gate that suppressed completed estimates even when their
  durations were already known. Timestamped, fixed-event and CLOCK-backed history keep
  their existing interval rules. The fallback is a read-only display allocation: no
  timestamp writes, reference-source time borrowing, edit-time inference or Actual credit.
- Roam's namespace-free pre-reader compatibility remains guarded: no `::unseen`
  or other auto-resolved keyword is required. The actual detail-state initializer
  is checked independently of standalone SCI evaluation.
- Shift + wheel now supports devices that report horizontal intent on deltaY,
  normalizes line/page units, and follows partial gestures with native-style
  snap-back. Momentum is latched to one card per gesture; stale frames/timers
  cannot change a later editor. Existing keyboard shortcuts stay unchanged.
- Card previews now follow full-page Desk traversal: root plus eleven counted
  descendants, two levels, explicit-false folding, three raw image-row exemptions,
  hierarchy-aware image pruning, stable image deduplication, and hidden-content
  indicators. References, missing roots, code literals, and direct-child search
  have explicit behavior. Staged public reads and resource limits replace the
  former compact five-row approximation. Read/watch failures remain visible;
  watch admission rereads the source and survives fold/reopen races.
- Desk width now matches the chart's local renderer rather than the article
  wrapper. Responsive native columns remain; no negative-margin breakout or
  native full-page ownership marker is reintroduced.
- Embedded Desk no longer claims the native `rm-desk-page` route marker. Current
  Roam CSS used that descendant to reset ancestor wrapper padding, reproducing
  the reported 12px shift. Native card sizes are scoped locally without changing
  host ancestors or inheriting the page-only 60vh canvas floor. Spacing/context
  round trips cover the failure; genuine native pages keep their own rules.
- Escape from a mounted native editor now remains with Roam, including the
  mocked Escape-before-Copy prelude. The footer hint follows editor versus chrome
  focus. Desk chrome, Close/backdrop, and drafts retain their deliberate Escape
  behavior; no real macro, clipboard, app switch, paste, or send workflow was run.
- External-drop ownership now blocks later native graph-drop handlers and
  preserves the original source. Feedback stays inside the existing title area,
  without moving cards or covering Search, New note, or Hide Desk. Terminal
  messages clear after five seconds; lifecycle cleanup also clears their timers.
- Alt-only hint labels now reconcile after ordinary ready reorder, add, remove,
  and filter updates so Alt+Digit matches the visible card number.
- Search, New note and the close X share a single flex-aligned tool group. X is
  centered with the plus control rather than absolutely positioned against the
  title. Narrow layouts avoid a third control row; compact search, far-right
  close and Search → New note → Hide Desk keyboard order are preserved.
- A legacy later `gap` rule can no longer turn Desk's 4px masonry tracks into a
  giant reserved blank area: the Desk grid explicitly keeps its native zero
  row-gap while retaining the 12px column gap. Sparse/tall cards and responsive
  widths are measured against the last card and following ordinary block.
- Folding hides the entire widget, including Desk cards, toolbar, and native focus
  layer, while keeping the original outline hidden when Desk is selected. The
  expand control and saved Desk preference remain. Expanding restores the overview;
  explicit Hide Desk or unload restores the ordinary outline. Buffered drafts
  survive folding without duplicate creation or an unexpected focus dialog.
  Unconfirmed IME input stays uncommitted across folding and pending creates;
  closing the view does not flush that partial text into the graph.
- Card overviews now render safe Markdown image links from the card root,
  bounded preview subtree, and resolved references with the host's native single
  and multi-image tile classes. Unsafe schemes and arbitrary graph HTML are not
  inserted. Code examples remain literal, including references inside code.
  Scoped preview watches refresh changed descendants without remounting unrelated
  thumbnails. Registration cleanup waits for pending host calls, and search-mode
  refreshes no longer depend on an intersection callback. Browser regressions
  hold real raster responses across replacement, folding, and teardown; graph and
  image content are synthetic, with offline and cached-native stylesheet profiles.

### Changed

- The optional capacity bar keeps its 136px horizontal scale but reduces the
  capsule from 6px to 4px high, matching the slimmer visual weight of OpenUsage.
  The two 14px rows, center-axis alignment, colors, warning text, width motion,
  completion confirmation, reduced-motion behavior, and icon fallback are unchanged.
- Opening the execution panel keeps its header and a static loading skeleton
  instead of flashing “Checking today's plan.” The topbar stays visually stable
  during that check. Loading remains accessible through the dialog's busy state
  and status label; no task rows or actions appear until validation completes.
  Plan validation, cancellation, and the bounded paint yield are unchanged.
- Calendar mapping writes keep a `google-calendar-sync-pending` WAL, fail closed
  on unreadable/foreign/old-scope journals, park uncertain creates as conflicts,
  and preserve local edits. The settings default for that key is an empty string
  that the journal parser treats as absent; filling defaults does not overwrite an
  existing WAL. Same-UID graph reads may be reused only until JavaScript yields.
  Google list reads use connection-scoped metadata TTL, a small concurrency cap,
  and a per-paginate budget; incomplete reads do not call reconcile. These are
  local synthetic-adapter bounds, not a live Google latency claim, and malformed
  journals are not bulk-migrated.
- CLOCK renderer history overlays per-owner entries (15s TTL, 256 LRU) and does
  not cache a failed read as empty. Chart plan sessions bind provider generation;
  a replaced watch cannot revive writes, and unavailable reads stay stale rather
  than looking like a confirmed empty tree.
- Plan Tidy uses the outline lock (separate from Calendar mapping), keeps a
  still-safe Undo token on no-op, expires a token after partial Undo, and confirms
  collapsed rows actually expanded before reporting Undo success. Toast failures
  after finished writes do not rewrite the result as `changed: false`. Unknown
  (`changed: null`) means a mutation was attempted but not confirmed.
- Execution popover rendering snapshots settings once per synchronous render
  instead of reading language and related keys once per task row. Plan Tidy no
  longer re-reads the parent outline once per settled uid on no-op open checks,
  and a collapse `setOpen` that resolves without sticking is visited at most once
  per uid. These are duplicate-work reductions on local synthetic fixtures. A
  previous single-lane run reported 15-row settings gets 204→90 and
  interleaved-n15 child reads 29→6; this combined tree must be re-measured
  before quoting new numbers. The 50ms paint-budget fallback, Primary Plan
  create/locate and receipts, CLOCK-over-POMO, pending shell (no “Checking
  today’s plan” flash), Undo/partial/unknown flags, and a fresh parent/order/open
  read after every real awaited write are unchanged. This does not claim that live
  Roam’s ~1s open or shortcut feel is fixed.
- Primary Plan Daily-tree materialization prefers a synchronous reverse
  `data.pull` (`:block/_page` plus `:block/_children`) and falls back to the
  existing Datalog query when pull is missing, thenable, unreadable, or reverse
  fields are absent. Present but malformed `:block/string` / `:block/order` /
  parent uid values stay in the projected tuples so the original validator can
  fail closed; they are not dropped as an empty Daily Note or replaced by a
  later Primary. CLOCK queries, `readDailyPageUid`, receipt/freshness checks,
  and create/locate fail-closed behavior are unchanged. This is a compatibility
  fast path plus fallback, not a claim that the live execution popover is already
  faster.
- Direct child outline reads (`readChildren`) prefer a synchronous `data.pull` of
  `:block/children` (`uid` / `string` / `order` / `open`) and fall back to the
  existing Datalog query when pull is missing, thenable, unreadable, the parent
  uid does not match, or the children field is absent. Missing `:block/open` still
  means false, matching `get-else`. Tidy, Calendar mapping, and LOGBOOK drawer
  confirmation keep the same filter/sort contract. This is a compatibility fast
  path plus fallback, not a claim that Tidy or Calendar is already faster in live
  Roam.
- External chart labels may reuse a local `placeExternalLabels` pass via
  translate; that is an operation-count saving in Node, not a Roam UI jank fix.
- OAuth worker route handlers now `await` and return sanitized JSON on thrown
  errors in source/tests only. This is not a deployed worker change.
- LOGBOOK 256-character variants remain; urgent-keyword and live Google connection
  behavior are unchanged.

### Added

- A 30px topbar control and **Nautilus Log: Create or open today’s plan** can
  create or locate today's Primary Plan without turning on the Execution Layer.
  The click path freezes and copies the complete single managed renderer root and
  ordinary descendant tree at the end of the local-calendar Daily Note. Every
  copied block gets a fresh UID; internal references are remapped and external
  references are retained. Any legal renderer already on that page is locate-only.
  Multiple roots, unsafe template top-level siblings, dynamic/unreadable content,
  or missing safety capabilities fail closed and offer template review; no source
  template is changed, nothing auto-creates at midnight, and no historical note
  is rewritten. Execution Layer off still has this launcher, but not CLOCK
  writes, a 1s ticker, or the execution popover. After a confirmed create, the
  existing capacity text / 136×4 energy bar returns and the plan opens in the
  main window. Running CLOCK/POMO remains visible when no plan exists, with a
  create action in the Plan empty-state.
- Creation is guarded by graph-scoped Web Locks, a reserved date-specific root
  UID, unique preallocated descendant UIDs, click-time source freezing, source
  revalidation after awaited page/receipt writes, and full exact tree readback.
  A minimal graph/date settings receipt stores destination topology and SHA-256
  hashes, not template text. Partial status survives locate, tracking, reload,
  and discovery. Only the original in-memory intent can explicitly continue
  missing nodes after validating every written block; reloads never reconstruct
  missing content from a new template. Pre-template failures remain retryable.
  Midnight before the first template request stops creation; afterward the frozen
  original day is completed and reported. Graph changes/unload stop following work,
  not an already-issued host request. Unchanged ticks use cached integrity.
- Real-session Node/browser acceptance exercises actual source queries, freezing,
  mutation adapters, both launchers, and the shared command over an isolated
  duplicate-rejecting graph. It covers failure/continuation/reload routes, midnight,
  timer priority, and English/Chinese dark, keyboard, and narrow-screen UI.

### Fixed

- Recent entries expire without graph reads. Hidden tabs skip elapsed UI work.
  Plan watch bursts coalesce before graph reads, and unchanged refreshes preserve
  execution action nodes, focus and scroll. Stable time ticks do not measure
  topbar geometry.
- Opening the idle execution popover now shows a cancellable checking shell
  before the full Daily Note read. A scoped root hint allows that read to wait
  for a paint opportunity (`requestAnimationFrame` plus a 0ms macrotask), with a
  50ms (~3 frames at 60Hz) scheduler budget as a bounded fallback if the frame
  path does not finish. This budget does not promise that an actual paint always
  happens first. The hint never certifies Primary selection or a creation
  receipt. Same-turn discovery is reused instead of reading the Daily Note
  twice. Closing performs no graph reads, and Escape/outside clicks cannot
  reopen a dismissed panel when validation finishes. Whole-root recreation and
  partial-tree guards remain intact.
- The actual execution shortcut tooltip and lightweight tooltip now share a
  border-box, viewport-clamped, wrapping theme; long explanations no longer escape
  a 320px bubble. Absent/unconfirmed plans show no fake 100% capacity. Unsupported,
  partial, and read-failure states have short labels and visible diagnostic actions,
  not a nonfunctional `Use ;;` prompt. Plan empty state also offers View template.
- Template reads normalize native `:children/view-type` and presentation defaults,
  reject unknown properties/history/extra renderers, and bound depth/size/cycles.
  Canonical trees are serialized once instead of recursively escaping JSON.
- CLOCK starts now check running records under a graph-scoped browser Web Lock;
  cross-tab invalidation refreshes other execution views without per-second queries.
  This is browser-local coordination, not a distributed lock across devices.
- Background refreshes no longer enable actions before a pending write settles.
  Cancelled reads resume afterward. Stop/delete retain the selected CLOCK UID,
  preserve newer foreign CLOCKs and closed history, and completion/reconciliation
  reread current records before writing. Failed writes refresh actual graph state.
- Plan labels preserve next-day times instead of truncating them to `24:00`.
  In energy mode, the topbar and open panel share one minute-level capacity projection.
- Panel updates preserve task-control focus and list position. Tabs support arrow
  keys and Home/End; Escape returns focus to the trigger.
- Cancelled or repeated runtime initialization no longer leaves timers or resurrects
  commands and UI after unload. Rapid tracking toggles settle in request order.
- Trying to start standalone POMO while CLOCK is focused no longer leaves the
  execution actions in a working state.

## 1.1.0 — 2026-08-30

### Added

- The Execution Layer now offers a default-off capacity energy bar for the
  topbar. One layered time track shows flexible reserve, unfinished planned
  demand, and elapsed capacity on the existing full-day denominator; confirmed
  panel completion keeps the planned reading visible, confirms it in place, and
  settles both layers on one short width transition. It reuses the
  current Primary Plan and timer state, adds no graph query or polling source,
  yields to Roam search at icon density, and honors dark and reduced-motion
  themes. Its borderless two-level depth gauge uses a fixed 136×6px track above
  a left-aligned `% left · planned duration` summary. Those rows fold evenly
  around the Roam topbar centerline, where the larger CLOCK/POMO timer and stop
  control remain centered without changing the track scale. The fully rounded
  capsule uses Roam's right-side toolbar icon gray (`#5c7080`) for free reserve,
  keeps planned demand lighter green, and carries no border, shadow, decorative
  end structure, or overload marker. Overload and no-slot warnings appear once in the exact
  lower text. The shortcut tooltip uses a seam-free two-layer pointer. The full
  gauge replaces the leading icon, while missing data or constrained space
  restores the 30px icon fallback.
  Existing `left` text remains unchanged while the option is off.
- Optional, read-only Google Calendar sync now imports timed busy events into
  the exact date and Nautilus Plan represented by the clicked chart. The new
  control uses Blueprint's native Calendar glyph, contacts Google only from a
  user click, and keeps short-lived OAuth access tokens in memory.
- Imported events use a compact managed subtree for source links, location, and
  a shortened description. Normal sync preserves Roam edits; Option/Alt-click
  force-refreshes managed strings while user-created descendants remain safe.

- A one-click Tidy control now moves completed tasks and elapsed fixed events
  to the front of the Plan with stable ordering. Active task priority, fixed
  times, references, descendants, and spiral placement remain unchanged; the
  native toast offers one conflict-safe Undo.
- Modifier-clicking the Nautilus topbar trigger now routes the Primary Plan
  without changing normal click: Option/Alt-click locates it in the main window,
  while Shift-click opens or brings one deduplicated copy to the top of the right
  sidebar.
- Chart windows may now start at any whole hour from 00:00–23:00 and end at
  01:00–24:00; an end at or before Start is treated and labelled as next day.
- Overnight events, capacity, elapsed time, hover slots, and the current-time
  needle share one continuous timeline owned by the plan's Daily Note.

### Changed

- Roam Depot now loads the root stylesheet only once instead of embedding the
  same CSS payload inside `extension.js`; the build also uses Webpack's native
  source-asset support and no longer depends on `css-loader` or `text-loader`.
- Compact and right-sidebar timelines now keep hover and keyboard-focus detail
  without opening a floating panel. A stable one-line context rail reuses the
  chart's lower whitespace, preserves task/event/available semantics, and leaves
  the wide viewport-aware tooltip unchanged.
- Remaining capacity now leads the chart, compact Overview, execution panel,
  and topbar. Full-density topbars show the neutral `left` label beside the
  semantic percentage; the existing hover surface adds cached free/total and
  planned values above its unchanged shortcut guidance. Only numeric values
  inherit positive or warning tones, and compact/icon density still yields to
  Roam search without adding another popover or data reader.
- Flexible task slices and compact Schedule rows now navigate instead of
  incrementing hidden progress. Normal activation scrolls to the task in the
  current surface, Shift opens it in the right sidebar, and collapsed targets
  fall back to Roam's official block navigation. Legacy `dNN%` text is now
  ordinary content and no longer changes duration or scheduling.
- Calendar sync feedback now uses a compact, anchored result popover instead
  of one wrapping debug-style tooltip. Zero change counters stay hidden, event
  and task inventory remain secondary, local deletions receive an explicit
  restore hint, and the stable hover help always keeps Option-click discoverable.
- The four remaining chart controls keep their existing geometry and visual
  treatment while gaining reliable localized hover and keyboard-focus help.
  Calendar temporarily swaps to a rotating Blueprint refresh glyph only while
  a real synchronization request is pending.
- The non-essential day Playback control and its simulated clock path have
  been removed; the real NOW needle and normal minute refresh are unchanged.
- Tidy now collapses only expanded settled items after ordering while preserving
  unfinished outline choices; Undo restores both order and only the outline
  states changed by Tidy.
- The Tidy control now uses the supplied Lucide `brush-cleaning` glyph at the
  same quiet 18px outline weight and interaction surface as the neighboring
  chart controls.
- All four chart controls now share an 18px icon canvas and a 32px click target;
  the denser Tidy brush is optically centered at 16.5px for balanced visual weight.
- Spiral depth is based on hours elapsed from the configured start, preserving
  the default 05:00 profile while keeping pre-05:00 and next-day sectors visible.
- Direct flexible blocks no longer need a TODO marker to participate in Plan,
  Timing, completion, capacity, and the spiral.
- Referenced tasks now use one daily-instance model across the spiral, topbar,
  Plan, Timing, and Review. A bare reference inherits its source TODO/DONE;
  an explicit outer TODO or DONE owns today's status and can reopen a completed
  source. Local duration overrides source duration instead of adding to it.

### Fixed

- Standalone POMO now exposes an accessible Stop POMO action inside the panel,
  so it can always be ended when responsive icon-only density hides the adjacent
  topbar close control.
- Completing a non-focused Plan task now closes only that task's own CLOCK;
  another focused task and its continuous Pomodoro cycle remain untouched.
- Shorthand upgrades now recover an existing customized Nautilus template and
  renderer identity instead of creating another active template generation.
  Legacy render blocks receive the current renderer code in place, duplicate
  template entries are retired non-destructively, and historical Daily Notes
  remain unchanged—so prefixes such as `[[log]]` survive an update without a
  graph-wide replacement.
- Imported Google Calendar `Open` links now retain Google's original event
  target while adding the authorized Primary calendar account as a safe,
  encoded account hint. Missing or invalid hints and non-Calendar links fall
  back unchanged, with no extra Calendar request or background work.
- Tidy now treats every visibly completed direct child—including a bare
  reference whose source is already DONE—as settled, while continuing to move
  only today's wrapper. Reordering also preserves each Block's existing
  expanded or collapsed outline state instead of folding active work.
- The Nautilus topbar shortcut hint now appears reliably on hover and keyboard
  focus, even while a timer is refreshing the trigger state, using the same
  compact surface, pointer, and light/dark treatment as Roam's native popovers.

- Timing, Plan, and Review now identify a Nautilus component by its stable
  renderer instead of the optional display prefix, so custom or empty prefixes
  continue to expose the Primary Plan without admitting unrelated renderers.
- The folded right-sidebar Overview now leads with the canonical allocation
  summary—planned, free/over/no-slot, and percent left—instead of transient
  burning-bucket context.
- Depot builds now parse the SCI component source with Clojure's reader before
  packaging, preventing delimiter errors from reaching Preview installs.
- Source completion time and CLOCK history are never inherited by a
  daily wrapper. A bare reference to completed content stays complete and is
  excluded from today's execution; adding an outer TODO explicitly reopens it,
  and later completion updates only that daily wrapper.
- Moving a reusable reference into the Primary Plan or changing its outer
  TODO/DONE marker or local duration now refreshes the spiral and Execution
  Layer immediately. One shared graph-native watcher coordinates parent
  membership, direct-child edits, and referenced source edits for every render
  of the plan, without adding a high-frequency poller.
- The spiral now hydrates referenced task content through the same authoritative
  UID resolver as the Execution Layer when Roam omits `block/refs` strings from
  a nested Pull Watch snapshot, keeping planned totals and percent left aligned.
- Shared Plan snapshots now replace missing or stale nested reference text with
  the source block's current string before publishing. A bare reference to a
  completed source therefore remains DONE and consumes no planned capacity;
  only an explicit TODO on today's wrapper reopens it.
- Nested bare-reference chains now inherit the nearest explicit source
  TODO/DONE status, matching their already-recursive title and duration. A
  completed reusable task therefore stays out of Plan even when today's block
  reaches it through an intermediate reference.
- Expanded compact Overviews now show only Available, Events, and the legend;
  the canonical planned/free-or-over/left summary remains in the disclosure
  row instead of being repeated in the body.

## 1.0.2 — 2026-08-23

### Added

- The optional Execution Layer now includes a standalone count-up POMO for
  estimate-first work: start it from the panel header, monitor `elapsed · POMO`
  in the topbar, and close it directly without creating a task CLOCK.
- Standalone POMO restores from its absolute start after navigation or refresh,
  reuses the configured Pomodoro threshold, and marks only its live text red
  after the threshold while continuing to count upward.

### Fixed

- Standalone POMO and task CLOCK are strictly mutually exclusive: CLOCK always
  wins a same-tick race, Clock In clears POMO first, and restored stale POMO
  state is removed when an active CLOCK already exists.
- Per-second standalone POMO ticks update only the compact topbar signal; they
  do not query the Roam graph or rebuild Timing, Plan, or Review.

## 1.0.1 — 2026-08-23

### Fixed

- Historical Daily Notes now render the configured workday as elapsed, keep
  their unrecorded time hatched, and expose no actionable Available-slot hover
  targets, current-time needle, or burning-capacity marker.
- The Execution Layer now resolves direct block-reference tasks with the same
  semantics as the spiral, so task demand, remaining capacity, and no-fitting-slot
  status agree between the popover and chart.

## 1.0.0 — 2026-08-22

### Added

- Rebranded, isolated Nautilus Log render/template/runtime identifiers.
- Configurable chart start (05:00–08:00) and end (18:00–24:00) boundaries.
- Capacity header showing available time, remaining fixed-event occupancy, task
  demand, and overload/remaining slack.
- Dashed expandable list for tasks that do not fit before the selected end time.
- Compact red/yellow/blue dot legend for urgent items, events, and tasks.
- Per-instance collapse state, playback state, and clock state for multiple renders.
- Responsive compact layout, measured label truncation, past-time fading, and
  reduced-motion support.
- Compact schedules start folded when a Nautilus Log block is focused in the
  right sidebar, while remaining user-toggleable afterward.
- Fresh installs and existing preview installs default to English once; Chinese remains
  available from Language settings and is preserved after it is selected.
- Optional Actual Time Tracking, defaulting off with no topbar, poller, commands,
  or CLOCK writes until explicitly enabled.
- The optional Execution Layer is now a prominent advanced entry in Settings;
  dependent execution options stay hidden until the master switch is enabled.
- A Blueprint-native topbar execution surface with Timing and flat Primary Plan
  tabs, one-click task completion, `unresolve` idle state, and `locate` navigation.
- A compact `unresolve · Nautilus` identity in the popover header exposes the
  Primary Plan navigation target without adding another row.
- The identity itself now locates the Primary Plan and advertises that action with
  a persistent chevron plus hover/focus feedback; the redundant right-side locate
  icon is removed.
- The Nautilus identity hover surface is now a complete rounded rectangle with an
  independent, evenly spaced divider before the Timing and Plan tabs.
- Compatible Org-style `LOGBOOK::` / `CLOCK:` persistence, serialized single-clock
  switching, numerically configurable recent Threads, and a shared configurable
  Pomodoro threshold.
- Numeric Recent-retention and forgotten-CLOCK warning settings, including 0 to
  disable either behavior, live Recent time-left labels, and a distinct long-running
  CLOCK warning state.
- A focused-row `trash` control with two-click confirmation deletes only the current
  open CLOCK; all task-completion actions use Blueprint's `confirm` icon.
- Actual/Planned row metadata and deterministic selection of the first Nautilus
  Log component on today's Daily Note as the one Primary Plan.
- Default component prefix `[[Nautilus Log]]` and default chart range 05:00–21:00.
- Shortcut-ready Command Palette actions and TODO context-menu actions for Clock
  In, global Clock Out, and Primary Plan navigation.
- Optional native right-sidebar fronting for the current Timing Line, enabled by
  default whenever Actual Time Tracking is on.
- Completed flexible tasks now condense all valid closed CLOCK sessions for the
  displayed date into one completion-anchored Actual slice; Planned remains the
  fallback, and cross-midnight sessions are clipped to the day.
- A lightweight daily Review tab lists all Primary Plan tasks, distinguishes
  live/paused/untracked states, and compares Planned with Actual only for the
  completed tasks that have same-day CLOCK history.
- A compact execution-panel capacity strip keeps Available plus the current
  Remaining, Overload, or No-fitting-slot result visible across all three tabs.
- Plan now separates deterministically scheduled work from a folded Unscheduled
  today section, including projected time ranges and section duration totals.
- Direct slice and keyboard focus now reveal one compact tooltip with the item
  type, exact time range, and duration; future blank regions expose equivalent
  Available slot information without adding persistent chart labels.

### Fixed

- Planned progress is now applied exactly once in both the spiral and Execution
  Layer, so a `60m d50%` task consistently occupies 30 minutes.
- The renderer and Execution Layer now share one tested parser for `30m`, `30min`,
  `1h`, `1h30m`, and fixed time ranges, including localized warning codes.
- Routine CLOCK refreshes now query only Primary Plan, focused, and Recent task UIDs;
  the full LOGBOOK scan is reserved for startup compatibility reconciliation.
- Clock In and task switching mutate cached CLOCK state and confirm only the changed
  block instead of scanning unrelated graph history.
- Pomodoro restoration no longer performs an unawaited settings write, eliminating
  stale-clear races during rapid task changes.
- Mounted charts recompute whether they represent today's Daily Note after midnight.
- The Execution Layer now follows the English/Chinese language setting, including
  tabs, capacity, task metadata, Review states, controls, and accessibility labels.

- Wide-layout timeline tooltips now anchor outside the spiral, measure before
  appearing, escape chart clipping through a body-level portal, and flip or
  shift within the browser viewport; compact layouts mount no hover surface.
  Their SVG center and radial direction now share one coordinate contract, so
  left-side evening items expand outward instead of back across the spiral.
- The decorative spiral grid no longer intercepts pointer events, so hovering
  the actual task or event slice behaves the same as hovering its outer label.
- Expanding or folding Unscheduled today no longer makes the focused Plan row
  alternate between its projected interval and the live Timing label.
- Execution-panel capacity metrics now keep the normal UI typeface across Roam
  themes by matching the rendered chart metrics; the metrics sit together on
  the left, and Unscheduled rows no longer draw a decorative left rail.
- Timing, Plan, and Review lists retain scrolling without exposing native
  scrollbar chrome inside the execution popover.
- Compact right-sidebar Overview metrics stay adjacent instead of being spread
  across the row; only the disclosure arrow remains right-aligned.
- DONE blocks no longer cause identical Roam writes.
- Midnight-crossing events are clipped at 24:00 and shown in a warning panel.
- Fragmented free time is distinguished from aggregate overload.
- Flexible task titles and connector lines now use one semantic blue while
  adjacent task slices retain their subtle fill variations.
- Unload no longer rewrites or deletes graph content.
- Right-sidebar renders use a compact chart with folded schedule details; breadcrumb
  and collapsed-path replicas avoid chart work and reserve no visible space.
- Template and code scaffolding updates are idempotent and Log-only.
- Render scaffolding is created sequentially so delayed Roam writes cannot race
  ahead of their parent blocks.
- Disabling time tracking closes and confirms active CLOCK records before removing
  the entire execution surface; failure preserves the enabled state.
- Legacy overlapping open CLOCK records reconcile to the newest focused task.
- The execution popover now paints cached state before graph refresh, schedules
  periodic graph scans as idle work, and updates only elapsed text on each tick;
  Timing/Plan switching no longer competes with per-second full DOM rebuilds.
- The focused task restores the explicit Blueprint `log-out` Clock Out control,
  and Clock In restores the Roam Logbook-style right-sidebar interaction.
- Planned and Remaining now occupy the first metric row, with Available and Events
  together on the supporting capacity row.
- Clock In starts native sidebar navigation before graph validation; confirmed
  windows preview immediately while an authoritative queued pass preserves dedupe.
- Clock In now gives Roam's native sidebar a browser task to paint before any
  synchronous graph validation, warms the sidebar-window cache read-only after
  startup, and reuses the confirmed CLOCK/Primary Plan snapshots instead of
  rescanning the full Daily Note at the end of the click path.
- Clock In now preserves Roam's synchronous `getWindows`/`addWindow` fast path
  in the original click stack and never waits for the sidebar-open animation;
  older hosts retain a deduplicated wait-and-retry fallback.
- CLOCK Out and task switching confirm the one changed CLOCK block by UID rather
  than rescanning every LOGBOOK drawer between mutations.
- The execution panel updates only action availability during a queued mutation,
  and unchanged installation polling no longer invalidates every rendered chart.
