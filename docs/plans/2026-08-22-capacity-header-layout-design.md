# Capacity Header Layout

## Goal

Make the Nautilus Flow header easier to scan without turning it into a dense dashboard. Keep the existing flat Linear-style presentation, align related information, and show task load in context.

## Layout

The header uses two columns with two visually matched rows:

```text
Available  7h31m / 9h  Events  3h15m / 7h            [controls]
Planned    1h45m / 19% Remaining 5h46m     Urgent · Event · Task
```

- The left column is a 2 × 2 metrics grid.
- The first row contains Available and Events.
- The second row contains Demand and the dynamic status: Remaining, Overload, or No fitting slot.
- The right column places the three controls on top and the right-aligned color legend beneath them.
- The header remains flat: no card background, shadow, or enclosing border beyond the existing bottom divider.

## Current / total ratios

Available and Events use the same ratio grammar:

- the bold value before `/` is the remaining duration from the current minute;
- the muted value after `/` is the total duration across the configured chart range;
- the total stays stable as time passes and after a fixed event is completed;
- overlapping fixed events are merged before summing, so their shared minutes count once;
- total Available is the configured chart duration minus the merged fixed-event duration;
- the burning flame follows the complete ratio, identifying which current value is decreasing.

Fixed events retain their explicit written range after completion. Completion timestamps continue to reconstruct historical slices only for flexible tasks.

## Demand percentage

Demand shows both duration and flexible-time utilization:

```text
Demand 1h45m / 19%
```

The percentage is `demandMinutes / availableMinutes`, rounded to the nearest whole percent. Values above 100% remain visible and use the warning color. When no flexible time is available, zero demand displays 0%; positive demand displays an em dash instead of dividing by zero.

## Responsive behavior

The 2 × 2 metric grid remains intact in narrow containers. Column and legend spacing become tighter, while the right-side legend stays aligned beneath the controls. Existing chart compact-mode behavior is unchanged.

## Verification

- Unit-test normal, unavailable, and overloaded percentage calculations.
- Unit-test clipped, completed, and overlapping fixed events in the stable totals.
- Contract-test the two-column header, 2 × 2 metrics grid, right-aligned action group, and percentage styling.
- Contract-test the muted denominator and flame ordering.
- Run the production build and full test suite.
