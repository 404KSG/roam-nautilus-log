# Changelog

## Unreleased — Nautilus Flow v1

### Added

- Rebranded, isolated Nautilus Flow render/template/runtime identifiers.
- Configurable chart start (05:00–08:00) and end (18:00–24:00) boundaries.
- Capacity header showing available time, task demand, and overload/remaining slack.
- Dashed expandable list for tasks that do not fit before the selected end time.
- Compact red/yellow/blue dot legend for urgent items, events, and tasks.
- Per-instance collapse state, playback state, and clock state for multiple renders.
- Responsive compact layout, measured label truncation, past-time fading, and
  reduced-motion support.

### Fixed

- DONE blocks no longer cause identical Roam writes.
- Unload no longer rewrites or deletes graph content.
- Right-sidebar renders avoid chart work and reserve no visible space.
- Template and code scaffolding updates are idempotent and Flow-only.
