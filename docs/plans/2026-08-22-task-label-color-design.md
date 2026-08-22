# Task Label Color

## Decision

Use one semantic blue for every ordinary flexible-task title and connector:
`var(--nautilus-log-task)`, which resolves to `#0899c8` in the light theme.
Keep the existing translucent blue palette for task slices so adjacent tasks
remain visually separable. A custom urgent color continues to override the
standard task blue, and completed items retain their gray treatment.

## Rationale

The former renderer converted each slice fill into an opaque label color. That
made ordinary tasks appear to have different importance even though the color
variation only reflected list position. Separating semantic label color from
decorative slice variation preserves readability without inventing meaning.

## Verification

A renderer contract test requires the shared task color variable, confirms that
ordinary task events pass it into the slice renderer, and verifies that both the
title and connector consume the same resolved color. The complete build and
test suite must pass before the Depot draft is updated.
