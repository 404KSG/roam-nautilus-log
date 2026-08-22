# Changelog

## Unreleased — Nautilus Log v1

### Added

- Rebranded, isolated Nautilus Log render/template/runtime identifiers.
- Configurable chart start (05:00–08:00) and end (18:00–24:00) boundaries.
- Capacity header showing available time, remaining fixed-event occupancy, task
  demand, and overload/remaining slack.
- Dashed expandable list for tasks that do not fit before the selected end time.
- Compact red/yellow/blue dot legend for urgent items, events, and tasks.
- Per-instance collapse state, playback state, and clock state for multiple renders.
- Responsive compact layout, measured label truncation, past-time fading, and
  reduced-motion support.
- Compact schedules start folded when a Nautilus Log block is focused in the
  right sidebar, while remaining user-toggleable afterward.
- Fresh installs and existing preview installs default to English once; Chinese remains
  available from Language settings and is preserved after it is selected.

### Fixed

- DONE blocks no longer cause identical Roam writes.
- Midnight-crossing events are clipped at 24:00 and shown in a warning panel.
- Fragmented free time is distinguished from aggregate overload.
- Flexible task titles and connector lines now use one semantic blue while
  adjacent task slices retain their subtle fill variations.
- Unload no longer rewrites or deletes graph content.
- Right-sidebar renders avoid chart work and reserve no visible space.
- Template and code scaffolding updates are idempotent and Log-only.
- Render scaffolding is created sequentially so delayed Roam writes cannot race
  ahead of their parent blocks.
