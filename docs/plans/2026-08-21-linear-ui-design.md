# Nautilus Log Linear-style UI design

## Direction

Use a calm, compact utility-header layout. The chart remains the primary
surface; status and navigation controls recede. Avoid card shadows, large
rounded banners, heavy dashed outlines, and decorative elevation.

## Header hierarchy

The component header is a flat, full-width row with two zones:

- Left: capacity metrics on the first line, then the three-item color legend.
- Right: completed-items visibility, playback, and collapse controls.

Metrics are separate semantic items rather than one centered sentence. Labels
use muted text; values use stronger contrast. The legend uses small color dots
and follows the same left edge. A subtle hairline may separate the header from
the visualization, but the header has no shadow or elevated card background.

## Localization

The settings-panel language is the source of truth for all extension-owned UI
copy. Changing it publishes the same runtime settings event used by chart
configuration, so already-mounted components update immediately. User-authored
task and event text is never translated.

English copy covers capacity labels, legend labels, controls, overflow and
warning summaries. Chinese remains available when the setting is `zh`.

## Supporting surfaces

The SVG legend is removed and replaced by the HTML header legend. The chart
loses its ambient drop shadow. Overflow and warning disclosures become flat,
compact rows with subtle separators instead of large dashed cards.

## Verification seams

- Public UI-copy/metric formatter: English and Chinese produce known labels.
- Runtime settings publication: changing language updates mounted renderers.
- Renderer contract: one header owns metrics, legend, and controls; the SVG no
  longer owns a legend.
