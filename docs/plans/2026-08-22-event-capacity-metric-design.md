# Event Capacity Metric

## Decision

Add `Events` as the second metric in the Nautilus Log header:

`Available · Events · Demand · Remaining/Overload`

`Events` reports the fixed-event time that still occupies the scheduling window
from the effective current time through the configured chart end. It uses the
same merged future intervals as the scheduler, so overlapping events count only
once and past events no longer affect the value. On a non-daily page or during
playback, the effective current time follows the same cursor already used for
capacity and task placement.

## Presentation

The metric stays in the existing flat, left-aligned Linear-style header. Its
label and value use the event yellow already established by the chart legend;
no card, shadow, icon, or additional row is introduced. English uses `Events`
and Chinese uses `事件`. The remaining status continues to switch to warning
color only for overload or fragmented free time.

## Verification

Core tests cover localization, metric order and duration formatting. Existing
capacity tests verify that the event total is future-only and that overlapping
fixed intervals are merged. The full extension build and contract suite must
pass before release.
