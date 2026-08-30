# Nautilus Log control feedback design

## Decision

Keep the existing control size, color, spacing, hover background, and icon treatment unchanged. Remove the day-playback control and make the remaining four controls self-explanatory through a shared lightweight tooltip.

The four controls are:

- show or hide completed items;
- sync Google Calendar;
- tidy completed tasks and elapsed events;
- collapse or expand Nautilus Log.

## Hover help

Each control owns a localized action label through `data-nautilus-tooltip` and keeps the same label as its accessible name. The tooltip is CSS-only, appears on hover or visible keyboard focus, respects light and dark Roam surfaces, stays aligned to the right edge of the action row, and does not change button geometry.

Native `title` tooltips are not used because their delay and availability are inconsistent in Roam Desktop.

## Calendar progress

The Calendar control keeps its normal Blueprint calendar glyph while idle. During the existing synchronization promise, it switches to a rotating Blueprint refresh glyph, exposes `aria-busy="true"`, and remains disabled to prevent duplicate requests. When the promise settles, it immediately returns to the calendar glyph. No success check, new button, toast, color, or layout state is added.

The animation runs only while a real sync is in flight. Roam's reduced-motion rule suppresses the rotation for users who request reduced motion.

## Playback removal

Remove the playback button, its animation frame lifecycle, simulated timeline branches, localized copy, animation CSS, and playback-specific tests. The real-time minute refresh, NOW needle, historical pages, future pages, overnight carryover, capacity calculation, and scheduling behavior remain unchanged.

## Verification

- All remaining controls expose localized hover and focus help.
- Control geometry and existing hover styling remain unchanged.
- Calendar cannot be double-triggered while synchronizing.
- The refresh glyph exists only while the Calendar promise is pending.
- No playback state, animation frame, copy, or CSS remains.
- Full build and test suite pass.
