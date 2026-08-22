# Compact Overview

## Goal

Prevent capacity metrics and the color legend from overlapping in narrow Nautilus Log containers without shrinking or hiding useful information.

## Responsive behavior

Wide containers keep the existing two-row header: capacity metrics on the left, controls and legend on the right.

Compact containers at or below 520px show only the three controls in the header. Capacity metrics and the legend move into a separate `Overview` details panel between the header and chart. The panel is collapsed by default.

When the plan is overloaded or contains an unplaced task, the collapsed summary includes the warning label and duration, for example `Overview · Overload 45m`. This keeps critical status visible without reopening the full panel.

The existing compact `Schedule` panel remains independent because overview status and scheduled items serve different purposes.

## Layout

```text
                         [controls]
-----------------------------------
> Overview
-----------------------------------
              chart
-----------------------------------
> Schedule · 15 items
```

When expanded, Overview contains the same 2 × 2 metrics grid followed by the three-item color legend.

## Verification

- Contract-test that compact rendering has a dedicated Overview details panel.
- Verify the panel is initialized closed and exposes warnings in its summary.
- Verify compact CSS displays Overview and reduces the header to a right-aligned control row.
- Keep all existing wide-header and compact-schedule tests passing.
