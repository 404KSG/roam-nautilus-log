# Compact timeline hover context

## Decision

Keep the existing viewport-aware floating tooltip in wide layouts. At the compact
container breakpoint (`<= 520px`), expose the same timeline details through a
stable one-line context rail layered into the SVG's existing lower whitespace.

The compact rail must not follow the pointer, cover the spiral, resize the chart,
or push the Schedule section. It appears only while a timeline slice or available
slot is hovered or keyboard-focused.

## Compact presentation

```text
● Making                         Task · 10:00–10:45 · 45m
```

- The dot preserves the timeline semantic: task, event, completed, or available.
- The title truncates first; time metadata stays readable and uses tabular numerals.
- The rail is a quiet light/dark surface with a hairline border and no heavy popover
  shadow.
- Full action guidance stays in the slice's accessible label rather than adding a
  third visual line.

## Interaction contract

- Wide timeline: slice highlight plus the existing floating tooltip.
- Compact timeline: slice highlight plus the fixed context rail.
- Mouse leave and blur clear the detail immediately through the existing shared
  hover state.
- Resizing across the compact boundary clears stale hover state once, but ordinary
  ResizeObserver updates inside the same mode do not dismiss an active rail.
- Task click-to-locate behavior remains unchanged.

## Verification

- Contract tests cover both responsive renderers, the persistent rail slot, semantic
  tones, focus parity, and the absence of pointer interception.
- Existing tooltip geometry tests continue to protect the wide renderer.
- The full build and test suite must pass before updating the Depot source commit.
