# A single time spiral with complete diagram labels

## Current decision

Revised October 30, 2026. The user explicitly chose option A: connect untimed completions
to a named completed-status node, without guessing a time. Last-edit estimates were not
authorized. This supersedes the disconnected four-unit stubs, outer track, footer inventory
and experimental date-root wiring.

Nautilus is a changing time budget, not a status dashboard. The original unequal-radius
spiral is its only time geometry. The red needle is now; fixed events stay anchored;
pending whole tasks move through future continuous gaps in outline order. No scheduler,
END, capacity, CLOCK or reference-ownership policy changes in this design.

Every titled source task or event remains visible in the diagram. A count, hidden
accessibility node, omitted label or separate task inventory is not a substitute.
Linear-inspired restraint applies to presentation, not to replacing the original model
or claiming an official Linear palette. No downloaded artwork or font is shipped.

## Presentation seam

`src/chart-scene.js` exports `chartScene`, `chartPresentationFrame`,
`chartRecordAppearance` and `chartTipLayout` through `src/log-core.js`; `labelLayout`
is an internal helper. This seam has no graph, scheduler, clock, storage or mutation authority.

- Source titles, source status/ranges and local width determine three regions: an upper
  untimed-completion connection band, the real time spiral, and separate non-scheduled
  endpoints. Fixed ranges reserve their sides; pending titles reserve both timed and
  potentially unplaced space. The changing scheduled subset cannot resize the frame.
- Timed records alone have a spiral anchor. Their labels stay on the same side, ordered
  by angular position. Same-side curves share their horizontal routing coordinates;
  no label flips across the clock or follows an outer circular route to fill space.
- Untimed completions have no angle or spiral anchor. All their original titles remain
  in the upper left/right columns and connect to the boundaries of one named node:
  Completed / No timestamp, or 已完成 / 未记时. Its labels contain no count, date or hour.
  Each curve has a visible source-to-node path rather than a four-unit title stub.
- Only `untimed-completed` records enter this node. Known off-hours ranges and unplaced
  work retain separate square/diamond endpoints. No relation points to a guessed slice,
  date bead or clock axis. There is no below-chart inventory or outer track.
- Ordinary titles wrap in full. Balanced wrapping avoids unnecessary Latin word splits
  and isolated CJK final characters. Pathological titles retain their complete accessible
  text and explicit full-text action.
- Narrow containers still use side columns. Font measurement uses the same font family
  as the SVG; normal words can receive slightly more column space. Major hour ticks and
  a compact center date preserve clock readability without dropping task titles.
- Hour text receives an explicit inline font size. It must not rely on a CSS variable
  that the SCI/Reagent rendering path fails to emit. The current-time needle retains
  a readable, non-scaling stroke.

Explicit source edits, including status changes or new local CLOCK evidence, may move a
record between regions and change page flow. Clock-only updates, hover and completion
visibility may not. Eye visibility hides the completion node and its records together,
without re-running layout for a reduced collection. No untimed completions means no node.

## Truthful record projection

`partitionChartEvents` retains pending, timed-DONE and untimed-DONE collections for their
existing roles. Every completed local UID remains available to Tidy. Desk retains its
independent unfinished-task projection.

`chartScene` joins source records with the actual scheduling result. Fixed ranges,
pending plans, completion estimates and condensed CLOCK totals retain their provenance.
Known ranges are clipped only for drawing; details retain their full range.

A local `dHH:MM` stamp plus an estimate is sufficient for a completed slice. CLOCK remains
optional. Without a usable local completion time, a completed title stays visible but
receives no fabricated interval. Source completion timestamps are not borrowed for a
daily reference wrapper, and edit time is never treated as completion time.

The small title marks do not enter scheduling, capacity, Actual or CLOCK calculations.
The header retains overload and available-time information; the repeated footer overflow
counter is removed. Parsing warnings retain their separate disclosure.

## Materials and wall-clock recovery

Tasks use vivid indigo-blue, fixed events saturated gold, and timed completion history
solid neutral gray-blue. Elapsed fixed events use a quieter gold. A light diagonal pattern identifies unrecorded past time;
this is not a claim that the time was wasted. Patterns have mounted-instance IDs so
multiple charts cannot share an unintended SVG definition. Only actual past gaps receive
hatching, beneath recorded slices.

Current tasks and events use stronger fills and outlines. Explicit urgency overrides
ordinary slice materials. The header legend keeps three category dots. Completed titles
have no deletion line. The existing detail owner identifies the active title, connection
and slice or completion node, preserving completion color. Inactive connectors may recede;
other text is never dimmed into unreadability. No orbit or new navigation is introduced.

Clock recovery remains unchanged: minute ticks, foreground focus, visible-page return,
page show and owned CLOCK notifications share one refresh. An epoch-minute stamp handles
same-minute next-day return. All listeners and the one minute timer are released on
unmount. Tests must follow callbacks through exact scheduler intervals and rendered paths;
unchanged function bodies alone do not prove live movement.

## Details and preserved interactions

The centered tip fits its content, up to 280px with 16px narrow-container insets. Short
records need no redundant More action. The closed 44px slot is invisible when idle.
Explicit expansion stays in normal page flow, pins the selected record, and has no
internal scrollbar or overlay over following blocks.

Pointer, focus and expansion remain independent owners. Changes to a record's time,
status, provenance or presence, as well as eye-toggle, fold and unload, invalidate stale
detail. Existing click, Enter and Shift navigation is reused. No shortcuts are added.

Desk editing, IME, Escape, drag/import, previews, strict Remove, safe drafts, collapse,
preferences, calendar integration and the independent execution layer are outside this
presentation change. No global Roam padding, overflow or negative-margin compensation
is introduced.

## Required verification and limits

The actual-source SCI/Reagent gate checks source hashes, visible mark/title coverage,
real time claims, same-side routing, source-to-status-node endpoints, node/text bounds,
whole-connection highlight, eye visibility and node removal, label and marker collisions,
narrow hour sizes, unique pattern IDs, frame stability through END and overnight windows, reference/CLOCK
updates, full-text ownership, pointer/focus cleanup, main/sidebar/embed contexts, Chinese,
default/native styles and computed light/dark contrast. Graph writes, unexpected HTTP(S),
resource failures and page/console errors remain failures.

Native embed CSS can outdent its host before Nautilus mounts. Compare against that host
baseline, never conceal it with production-wide CSS. Explicit text expansion may scroll
the page; compare document-flow position rather than mistaking scrolling for resizing.

Private notes, screenshots, signed URLs and native assets stay outside the repository.
Isolated renderer tests and visual review do not certify an authenticated Desktop reload,
private host lifecycle, physical device input or every custom theme.
