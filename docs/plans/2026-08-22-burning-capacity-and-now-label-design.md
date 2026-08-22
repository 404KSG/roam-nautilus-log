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
  renderer adds a small static SVG flame with localized accessible text. The
  compact Overview summary repeats the active bucket and keeps any overload or
  no-fitting-slot warning after it.
- The now needle uses the same `now-time-atom` used by normal clock updates and
  playback. Its 24-hour label sits just outside the center ring, remains
  horizontal, and is rendered only for today/playback while `now` is inside the
  configured workday. The line and label disappear outside that range instead
  of being clamped to a false start/end position.

## Rendering and compatibility

The existing wide header and compact Overview/Schedule split remain unchanged.
Only CSS variables and Flow-scoped classes are added. The SVG and Hiccup use
syntax already accepted by Roam SCI; all time-state decisions stay in the
dependency-free JS core so tests do not need a Roam graph.

## Verification

Core tests cover before-start, in-event, available, at/after event end,
workday end, ignored completed/non-meeting events, and overlap boundaries.
Contract tests cover the bridge call, localized flame SVG, compact summary,
needle label, and theme-aware CSS. `npm test` and `git diff --check` are the
acceptance checks.
