# Responsive Capacity Token

## Purpose

Keep today's remaining flexible-time percentage visible across Roam without
allowing Nautilus Log to reduce the native search field below a useful width.
The indicator belongs to the optional Execution Layer and disappears with that
layer, preserving the default lightweight planner.

## Information hierarchy

The Roam search field always wins horizontal space. Nautilus Log uses three
progressive-density states derived from the search field and control widths:

- Full: `15:02 · POMO · 32% left ×`
- Compact: `15:02 · 32% ×` (idle: Nautilus icon plus `32%`)
- Icon: only the Nautilus icon

The indicator uses tabular numerals, inherited Roam typography, no badge
background, and warning color only for overload or fragmented capacity. Hover
and accessible labels expose the full `planned · free/over/no slot · left`
summary. Clicking the capacity value opens the Plan view.

## Data and performance

The token reads `planSnapshot.execution`, which is already cached by the timing
runtime. Its summary is memoized by execution-object identity and language, so
one-second POMO/CLOCK ticks update elapsed text without recalculating capacity
or querying the graph. A `ResizeObserver` watches layout only; it performs no
Roam reads or writes and is disconnected on unload.

## Responsive rule

Density is a pure function of `search width + current control width`. This sum
is stable when the flex layout reallocates space, avoiding breakpoint loops.
The full state requires room for a 420 px search field and full controls; the
compact state requires the same search reserve plus compact controls; otherwise
the control falls back to the icon.

## Acceptance

- Search retains priority in full, compact, and icon states.
- Idle, POMO, and CLOCK modes all expose capacity when space permits.
- Extremely narrow layouts show only the Nautilus icon.
- Missing plans show no fabricated percentage.
- Overload and no-slot states remain accessible and visually distinct.
- No capacity-specific graph polling or SVG redraw is introduced.
