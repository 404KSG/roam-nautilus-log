# Optional Energy Bar Design

## Decision

Add one optional, layered capacity bar to the existing Execution Layer topbar.
The setting defaults off. While off, the current Nautilus icon, textual
`percent left` token, tooltip, timing states, density behavior, and runtime
remain unchanged.

When enabled, the bar replaces only the visible `percent left` token. It does
not add another topbar control, a task score, persistence, a graph query, or a
second timer.

## Model

The bar treats the configured day's flexible capacity as one track:

- **Reserve** is `slackMinutes`: currently available flexible time left after
  all unfinished task demand. This is the existing `left` metric.
- **Committed** is the unfinished demand that still fits inside current
  available flexible time. It is rendered as a lighter delayed-damage layer.
- **Elapsed** is full-day flexible capacity that is no longer available. It is
  the unfilled remainder of the track.
- **Overload** remains the authoritative `overloadMinutes`; the value beside
  the track becomes `OVER +Xm`. Fragmented demand uses `NO SLOT Xm`.

For a positive `totalAvailableMinutes`:

```text
available ratio = clamp(availableMinutes / totalAvailableMinutes)
reserve ratio   = clamp(slackMinutes / totalAvailableMinutes)
committed ratio = available ratio - reserve ratio
```

The DOM uses a committed layer whose width ends at the available boundary and
a reserve layer whose width ends at the free boundary. The untouched track is
elapsed capacity. This keeps the layers aligned to one denominator and avoids
inventing a completion percentage.

Planning adds or changes the committed layer without claiming that time has
already elapsed. As the clock advances, the available boundary contracts.
Completing a task removes its pending demand after the Roam graph confirms the
DONE mutation. If work finishes on estimate, elapsed capacity and removed
commitment balance; finishing early preserves more reserve, while delay or
overrun consumes it.

The metaphor is explicitly time-derived. It does not claim to measure physical
or mental health.

## Live time

The topbar already receives one-second `state.now` ticks. Energy mode reprojects
the existing cached Primary Plan at most once per wall-clock minute through a
pure shared execution projection. The calculation reads no Roam data, creates
no polling source, and preserves fixed-event, overflow, default-duration, and
overnight scheduling rules. Text mode continues using the existing cached
projection.

## Interface

Full density shows one continuous 104×18px track, aligned to the preceding
18px Nautilus icon; compact density uses 72×16px. The track has no internal
quarter ticks because those marks do not represent distinct data and make one
bar look like several. The exact existing percentage follows the track. The
word `left` is omitted in energy mode because the layered bar carries that
role; the tooltip and accessible name retain the full semantic summary. Icon
density continues yielding the whole capacity token to Roam search.

The palette is restrained and theme-safe:

- reserve: the existing positive color;
- committed/delayed damage: muted warm gold;
- elapsed track: low-contrast neutral;
- overload or no-slot: the existing warning color, a static cap, and an exact
  `OVER +Xm` or `NO SLOT Xm` cue outside the track.

No idle pulse, continuous glow, sound, particles, XP, streak, or loss state is
introduced. Width changes use one short transition. `prefers-reduced-motion`
removes it.

## Settings

The switch appears only beneath **Execution Layer · Advanced**:

- English: **Show capacity as an energy bar**
- Chinese: **用精力槽显示剩余容量**

Its description says that the bar maps time capacity: solid reserve is free
flexible time, the pale layer is unfinished planned demand, and the empty track
is elapsed flexible time. It defaults to off and updates the mounted topbar
immediately.

Internal key: `energy-bar-enabled`.

## Data and failure boundaries

- Missing Primary Plan or execution data hides the capacity token exactly as
  today; it never fabricates a full or empty bar.
- A zero-capacity day renders an empty neutral track with `0%`.
- Scheduled and overflow tasks both contribute to demand.
- Fixed events are excluded from the flexible-capacity denominator by the
  existing capacity calculator.
- Untimed tasks retain the configured default duration.
- External TODO/DONE, duration edits, task additions, reopenings, and Tidy all
  redraw from authoritative plan state.
- A failed completion leaves the committed layer and percentage unchanged after
  the existing error recovery.

## Files

- `src/timing-core.js`: shared pure execution projection and energy bar model.
- `src/timing-runtime.js`: use the shared projection without changing graph IO.
- `src/timing-topbar.js`: optional live projection, layered track, semantics,
  and setting-driven rendering.
- `src/index.js`: default-off switch and localized setting copy.
- `extension.css`: full/compact/dark/reduced-motion presentation.
- Tests: pure model, settings/default contract, topbar DOM/CSS contract, and
  no-extra-query runtime guarantees.
- README, guides, and changelog: optional behavior and exact semantics.

## Acceptance

1. A new or upgraded install stores `energy-bar-enabled=false` when missing.
2. With the switch off, the current textual topbar contract remains unchanged.
3. With the switch on, the bar replaces visible `left` text and keeps the exact
   percentage, tooltip, and accessible summary.
4. Reserve, committed, and elapsed widths use one full-day flexible-capacity
   denominator and remain clamped from 0–100%.
5. Time passage contracts current capacity at minute resolution without any
   Roam read or a new timer.
6. Confirmed task completion, external graph changes, overflow, fragmentation,
   and fixed events reuse authoritative capacity semantics.
7. Full and compact densities render the bar; icon density yields to search.
8. Light, dark, keyboard, and reduced-motion states remain legible.
9. No persistence beyond the boolean preference and no task schema are added.
10. Production build, full tests, bundle checks, source push, and a new Roam
    Depot Draft PR all succeed.
