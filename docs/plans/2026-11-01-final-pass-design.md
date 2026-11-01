# Nautilus Log final pass — 2026-11-01

## Accepted implementation contract

Renderer r2 uses the `nautilus-log-r2` CLJS namespace, `roam-render-Nautilus-Log-r2-cljs` source UID, and `window.nautilusLogR2` bridge. The integer renderer revision is the compatibility authority: a source behavior update advances the revision, namespace, and UID together. Git revisions are display metadata only. Legacy UIDs are recognized for reading and plan discovery but are never rewritten. A mismatched or newer r2-family source is retained and reported rather than overwritten. The r2 bridge has distinct object ownership, so legacy cleanup cannot close an r2 Desk, help popover, or renderer plan session. A narrow legacy facade remains available for existing historical render blocks.

The managed template moves to r2 while retaining its prefix and supported arguments. Migration is bounded: it is not a historical-page scan, does not rewrite arbitrary plans, and does not retry uncertain writes. Older loaded packages can still rewrite their own template reference; that residual boundary is documented rather than hidden.

Fixed events create a cumulative earliest-start floor for later flexible tasks in outline order. Valid ranges, including future DONE events, remain reservations until their written end. Invalid ranges do not reserve time. Scheduling never splits, reorders, or drops a task; a task beyond END is visible as overflow. Tidy moves completed tasks and elapsed events only, leaving future DONE reservations in their original relative position.

An active overnight plan owns its logical workday until END. Its owner date and local logical minutes must be shared by chart, execution capacity, CLOCK accounting, Review, and Tidy. CLOCK evidence uses the full owner calendar day, extended only where an overnight logical end is later; scheduling stays within the configured work window. If the previous-day candidate is unreadable, creation fails closed. If it is absent, normal calendar-today behavior remains explicit and no old Daily Note is created.

Actual remains a sum of recorded CLOCK durations. The spiral’s single completion-anchored interval is a projection, not evidence that sessions were continuous. Estimated completed allocations retain a restrained cue and accessible explanation without a second title row. “Planned now,” “Planned event,” and “open/unassigned” clarify forecast and capacity language. Desk uses New task / 新任务 while preserving order-zero insertion, implicit task/default-duration behavior, native editing, and unscheduled child logs.

Execution remains opt-in: off avoids the execution panel, one-second ticker, and CLOCK writer, while the chart can read existing history. POMO remains the established execution-layer entry and continues to require that layer and compatible Logbook ownership.

## Verification limits

Regression fixtures exercise pure scheduling, reservation, renderer identity, and synthetic host behavior. They do not certify Roam Desktop SCI, a live graph, Calendar authorization, or a legacy package already open in another client.
