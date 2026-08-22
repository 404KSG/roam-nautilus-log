# Execution Panel Capacity And Plan Classification

## Goal

The execution panel should answer two questions without becoming another dashboard:

1. How much flexible time is still available today?
2. Which unfinished tasks still fit into today's deterministic schedule?

The panel must remain fast, compact, and visually consistent with the existing Linear-inspired execution layer.

## Information Architecture

A quiet capacity strip sits below the Timing / Plan / Review tabs and remains visible in every view. It shows `Available` plus one outcome:

- `Remaining` when all unfinished tasks fit;
- `Overload` when demand exceeds flexible capacity;
- `No fitting slot` when total capacity exists but a task cannot fit into a continuous gap.

The Plan view is divided into `Scheduled today` and `Unscheduled today`. Scheduled rows show the exact projected interval and planned duration. The Unscheduled section always exposes its count and total duration, but its rows are collapsed by default to preserve the compact panel.

`Unscheduled today` is a forecast, not a prohibition. Its tasks retain Clock In, Complete, and navigation actions. Reordering tasks in Roam, shortening an estimate, completing work, or changing the day boundary can move a task back into the scheduled section.

## Data And Performance Contract

- `log-core` remains the only scheduling authority.
- The execution runtime derives fixed events, pending tasks, capacity, scheduled rows, and overflow rows from the already cached Primary Plan tree.
- Opening or switching the popover must not perform another graph query.
- Runtime refreshes recalculate the projection; the existing one-second ticker only updates live elapsed text between graph refreshes.
- Task order remains the direct-child order in Roam. No AI or automatic priority reordering is introduced.

## Visual Contract

- Use typography, spacing, borders, and neutral surfaces already present in the execution panel.
- Capacity metrics explicitly inherit the execution-panel UI typeface so Roam themes cannot substitute editorial typography.
- Do not add filled metric cards, gradients, or shadows.
- Scheduled rows remain neutral; the focused row keeps its existing pale-blue state.
- Unscheduled status uses restrained amber metadata only; rows do not gain a left rail, outline, shadow, or disabled appearance.
- Section headers use small uppercase labels, compact totals, and a Blueprint chevron for disclosure.

## Verification

Tests cover fixed-event subtraction, overload, fragmented capacity, source-order preservation, scheduled intervals, collapsed overflow disclosure, action availability, day-end zero capacity, and the no-extra-reader contract. The full build and existing Timing / Review regressions must continue to pass.
