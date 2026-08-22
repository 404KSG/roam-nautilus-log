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

One HTML tooltip is shared by the chart. In a wide view, its anchor sits just
outside the spiral on the radial midpoint of the hovered or focused interval,
instead of following the pointer across the chart. The measured tooltip is
rendered through a body-level portal, prefers that outside direction, flips to
the opposite side when needed, and finally shifts inside a 12px viewport safety
margin. It therefore neither covers the interval being inspected nor clips at
the bottom or right edge of a Roam workspace.

Scheduled items show their title, type, range, and duration. Available slots
show the slot label, range, and duration. English and Chinese labels come from
the existing UI copy seam. The panel remains visually quiet: one compact dark
surface, restrained shadow, and no arrow or decorative animation.

At compact chart widths (520px and below), hover inspection is intentionally
absent. Slice groups receive no hover/focus handlers, available-slot hit paths
are not mounted, and no tooltip portal exists. The existing compact Overview
and Schedule disclosures remain the only inspection surface.

## Performance And Safety

The renderer derives slot groups from the `freetime` rows already returned by
`fill-day`. Hovering performs no Roam reads or writes. The shared Reagent atom
stores only the current tooltip payload, radial anchor, and measured viewport
position. Positioning is a dependency-free pure function covered by boundary
tests. Background overlays and the now needle remain inert.

## Verification

Tests cover current-minute clipping, hour-boundary segmentation, invalid and
past slot removal, preferred placement, edge flipping, final viewport shifting,
localization, non-interactive grid ownership, compact-mode suppression, shared
tooltip markup, and the absence of new graph readers. The full existing test
and build suite must remain green.
