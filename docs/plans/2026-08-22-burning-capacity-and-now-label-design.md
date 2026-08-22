# Burning Capacity and Now Label

## Intent

Make the capacity header explain which time pool is currently passing, and make
the red now needle readable without competing with the spiral's outer labels.
The flame is a state marker for elapsed capacity, not a claim that the user is
actively focused.

## Behavior

- `burningCapacityBucket` is the single pure decision seam. It returns
  `events` when the current minute is inside any unfinished fixed event,
  `available` when it is inside the configured workday but no fixed event is
  active, and `null` outside the workday. Intervals are half-open, so an event
  ending at `now` is no longer burning; overlapping unfinished events still
  burn the Events bucket.
- `calculateCapacity` exposes that bucket on the capacity result, and
  `capacityMetrics` marks only the matching Available or Events metric. The
  renderer adds a 16 px static outline flame with localized accessible text.
  It inherits the same neutral icon color and line treatment as the header
  controls instead of introducing another semantic color, and centers itself
  against the metric reading rather than using a font-baseline offset. The
  compact Overview summary repeats the active bucket and keeps any overload or
  no-fitting-slot warning after it.
- The now needle uses the same `now-time-atom` used by normal clock updates and
  playback. Its 24-hour value replaces the low-value year on the second line of
  the spiral center. There is no badge attached to the moving needle, so the
  time cannot cover slices or external labels. The center time is one visual
  step larger than the former year and uses the same red semantic family as the
  NOW needle. The needle and center time are rendered only for today/playback
  while `now` is inside the configured workday; both disappear outside that
  range instead of being clamped to a false start/end position. The year is not
  rendered.
- A neutral past-time overlay is drawn behind the grid and all task/event
  slices. It follows the spiral sector geometry from the configured workday
  start through the exact current minute, including a partial current hour such
  as 09:00–09:17. Future unscheduled sectors remain transparent. Existing past
  task/event fading stays above the overlay, so the overlay clarifies elapsed
  empty time without replacing semantic task and event colors.

## Rendering and compatibility

The existing wide header and compact Overview/Schedule split remain unchanged.
Only CSS variables and Flow-scoped classes are added. The flame SVG is
stroke-based (`fill: none`) to match the existing eye, playback, and collapse
icons. The SVG and Hiccup use syntax already accepted by Roam SCI; all
time-state decisions stay in the dependency-free JS core so tests do not need
a Roam graph.

## Verification

Core tests cover before-start, in-event, available, at/after event end,
workday end, ignored completed/non-meeting events, and overlap boundaries.
Core tests also cover partial-hour and bounded past-overlay segments. Contract
tests cover the bridge call, localized outline flame SVG, compact summary,
center time, removal of the needle badge/year, overlay render order, and
theme-aware CSS. `npm test` and `git diff --check` are the acceptance checks.
