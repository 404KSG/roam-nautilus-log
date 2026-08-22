# Timeline Hover And Available Slot Design

## Goal

The spiral should explain any visible scheduled slice and every future gap
without adding persistent labels or another dashboard. Hovering or keyboard
focusing the chart reveals the exact type, range, and duration of the item
under inspection.

## Interaction Contract

- Task and event slices remain the primary interactive layer. Their full SVG
  group, including the external label, exposes one shared tooltip.
- The decorative hourly grid never receives pointer events.
- Synthetic `freetime` rows become a dedicated hit layer above the grid. A
  future gap is neutral, gains a restrained dashed outline only while active,
  and never looks like a task or event.
- A gap containing the current minute begins at now and is labeled `Available
  now`; later gaps are labeled `Available slot`.
- Crossing an hour boundary creates multiple spiral paths inside one logical
  hover group, so the tooltip still reports one continuous range and duration.

## Tooltip

One HTML tooltip is shared by the chart. It is positioned from the hovered or
focused SVG group, stays within the visual container, ignores pointer events,
and uses the chart's existing typography. Scheduled items show their title,
type, range, and duration. Available slots show the slot label, range, and
duration. English and Chinese labels come from the existing UI copy seam.

## Performance And Safety

The renderer derives slot groups from the `freetime` rows already returned by
`fill-day`. Hovering performs no Roam reads or writes. The shared Reagent atom
stores only the current tooltip payload and position. Background overlays and
the now needle remain inert.

## Verification

Tests cover current-minute clipping, hour-boundary segmentation, invalid and
past slot removal, localization, non-interactive grid ownership, shared tooltip
markup, and the absence of new graph readers. The full existing test and build
suite must remain green.
