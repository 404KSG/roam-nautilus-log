# Changelog

## Unreleased

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
  existing capacity text / 136×6 energy bar returns and the plan opens in the
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
