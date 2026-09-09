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
  available flexible time. It is rendered as a lighter planned-demand layer.
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

Full density becomes one compact two-level instrument. The upper-left row is a
continuous 136×6px fully rounded depth-gauge capsule. The lower row becomes one
quiet, left-aligned sentence, such as `70% left · 3h20m planned`, whose left edge
matches the track. CLOCK or POMO elapsed time occupies a separate right cell
that spans both rows and centers on the Roam topbar axis, so the track never
shrinks or changes scale when timing starts. The previous percentage to the
right of the track is removed. CLOCK uses the timer alone; POMO keeps a small
`POMO` mode label beside it. Thread count stays in the accessible summary and
popover rather than competing with time workload in the topbar.

The Nautilus icon and divider dot disappear while the complete energy
instrument has authoritative capacity data. The entire instrument remains the
same clickable trigger. If data is unavailable, or responsive density yields to
Roam search, the Nautilus icon returns as the safe 30px navigation affordance.
The capsule has no metallic border, bevel, internal quarter ticks, shadow,
decorative end structure, or idle animation. Its lower labels separate stronger
tabular values from quieter words; only a real warning turns the lower metric
into a status color.

The palette is restrained and theme-safe:

- reserve: exactly Roam's right-side toolbar icon gray
  (`#5c7080` in the default light theme; `#bfccd6` in Blueprint dark);
- committed: lighter sea green (`#a8cfba`, dark-theme `#8fbfa6`) so unfinished
  planned demand remains distinct from both neutral time states;
- elapsed track: cool low-contrast gray (`#dce1e5` in light themes);
- ordinary percentage, planned duration, and timer: neutral gray-blue;
- overload or no-slot: the existing warning color appears only in the exact
  lower `OVER +Xm` or `NO SLOT Xm` cue, without a duplicate track marker.

Track and fill layers stay flat and fully rounded: no border, inset ring, outer
shadow, boundary shadow, body gradient, decorative pseudo-elements, idle pulse,
or continuous glow. Two equal 14px rows place the track center 7px above the
Roam topbar axis and the lower summary center 7px below it.
The 13px tabular timer spans both rows and centers directly on that axis; POMO's
smaller mode label remains secondary, and its adjacent stop glyph
uses the same axis without shrinking its button target. The lower values and
labels read as one left-aligned phrase separated by a quiet middle dot. Width
changes share one 360ms transition with no layered delay. Confirmed panel
completion keeps the planned reading visible and briefly emphasizes its weight
for 320ms; it never covers, fades, or recolors `OVER` / `NO SLOT`. External graph
updates redraw without that confirmation. `prefers-reduced-motion` removes the
width transition and the confirmation emphasis.

The shortcut tooltip uses nested border/fill triangles rather than a rotated
square. The inner triangle overlaps the surface by one pixel, covering the top
border beneath it and avoiding a visible seam at both 1× and Retina scale.

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

- Missing Primary Plan or execution data hides the capacity token and restores
  the Nautilus icon; it never fabricates a full or empty bar or an invisible
  click target.
- A zero-capacity day renders an empty neutral track with `0%`.
- Scheduled and overflow tasks both contribute to demand.
- Fixed events are excluded from the flexible-capacity denominator by the
  existing capacity calculator.
- Untimed tasks retain the configured default duration.
- External TODO/DONE, duration edits, task additions, reopenings, and Tidy all
  redraw from authoritative plan state.
- A failed completion leaves the committed layer and percentage unchanged after
  the existing error recovery.
- Completing a task closes only that task's running CLOCK. A different focused
  task and its continuous Pomodoro state remain untouched.
- Icon-only density may hide the adjacent POMO close glyph, but an active
  standalone POMO always retains an accessible Stop POMO action in the panel
  header.

## Files

- `src/timing-core.js`: shared pure execution projection and energy bar model.
- `src/timing-runtime.js`: use the shared projection without changing graph IO.
- `src/timing-topbar.js`: optional live projection, layered track, semantics,
  and setting-driven rendering.
- `src/index.js`: default-off switch and localized setting copy.
- `extension.css`: full/icon-only/dark/reduced-motion presentation.
- Tests: pure model, settings/default contract, topbar DOM/CSS contract, and
  no-extra-query runtime guarantees.
- README, guides, and changelog: optional behavior and exact semantics.

## Verification

- `npm test`: core, runtime, and UI contracts.
- `python3 test/energy-bar-settlement.py`: local browser regression checks using
  the real topbar module and stylesheet with an in-memory runtime. Requires an
  existing Python Playwright and Chromium installation; it does not access Roam.
  Covers readable completion, failure, external changes, both warning types,
  light/dark themes, repeated completion, unload, and reduced motion. Temporary
  screenshots and results are written to `/tmp/nautilus-energy-bar-verify`.

## Acceptance

1. A new or upgraded install stores `energy-bar-enabled=false` when missing.
2. With the switch off, the current textual topbar contract remains unchanged.
3. With the switch on, full density shows the fixed-scale bar above exact
   `percent left` and unfinished planned duration; CLOCK/POMO timing appears to
   the track's right without resizing it.
4. Reserve, committed, and elapsed widths use one full-day flexible-capacity
   denominator and remain clamped from 0–100%.
5. Time passage contracts current capacity at minute resolution without any
   Roam read or a new timer.
6. Confirmed task completion, external graph changes, overflow, fragmentation,
   and fixed events reuse authoritative capacity semantics.
7. Full density renders the bar; constrained space shows only the leading icon,
   while an active standalone POMO remains stoppable from the panel header.
8. Completing a non-focused task never stops the focused CLOCK or resets its
   Pomodoro cycle.
9. Light, dark, keyboard, and reduced-motion states remain legible.
10. No persistence beyond the boolean preference and no task schema are added.
11. Production build, full tests, bundle checks, source push, and the existing
    Roam Depot PR update all succeed.
