# Execution Layer discovery

## Goal

Make Nautilus Log's optional execution workflow easy to discover without enabling it
automatically or adding persistent notices outside Settings.

## Design

- Rename the master switch to **Execution Layer · Advanced** / **执行层 · 进阶**.
- Describe benefits before implementation details: focus, CLOCK timing, task switching,
  one-click completion, and daily Review.
- Keep the master switch off by default so planning-only use remains lightweight.
- While off, show only the master entry. Reveal sidebar, Pomodoro, Recent, and forgotten
  timer options after the switch is enabled.
- Rebuild the standard Roam settings panel on each master-switch change; do not inject
  global Settings CSS or a custom onboarding overlay.

## Acceptance

- A fresh install clearly exposes the optional advanced capability.
- Disabled execution settings do not create visual noise or imply that they are active.
- Enabling the switch reveals every existing execution setting without changing its
  stored value or runtime behavior.
- English remains the default UI language; Chinese copy remains selectable.
