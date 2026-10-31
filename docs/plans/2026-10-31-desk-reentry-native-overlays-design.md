# Desk re-entry and native image overlays

## Decision

Desk remains a projection of the graph, not a separate collection. A confirmed local TODO reference is represented only by its graph wrapper. If that childless wrapper is removed, dropping the same unfinished source again may recreate the same deterministic wrapper ID. An unresolved create remains verification-only and never receives a retry or fallback ID.

The focus editor remains Roam's mounted editor. Roam's enhanced image viewer is a portal modal, so it paints and receives interaction above the focus dialog without remounting the editor or changing its selection, IME state, or scroll.

## Causes and fixes

`createDeskActions` retained an import reservation after successful readback. Its `attempted` flag then treated a later, genuinely absent wrapper as an unresolved create. It also compared an old source fingerprint before checking an existing wrapper, so an ordinary source edit made a valid duplicate drop fail.

Confirmed creates and strict deterministic-wrapper adoption now release the in-memory reservation, including a wrapper observed after an ambiguous result, alongside a source/order change, or while the source itself is also in the plan. A different duplicate or the direct source alone never resolves that reservation. A concurrent source or order change still reports failed confirmation of the requested action, even when the exact wrapper's identity has been confirmed and its reservation released. Duplicate/source-in-plan checks remain before any new mutation. Once `create` starts, an absent, malformed, or foreign reserved ID remains verification-only; there is no retry or fallback ID. The attempted flag is set immediately before the host create, after the final context check, so cancellation before that call does not latch the source.

The host image portal establishes its own `z-index: 1` stacking context, while the body-mounted focus Desk uses native level 19. A control at `z-index: 1000` inside the portal cannot escape that context. A scoped `:has()` rule raises only `#rm-modal-portal` while both the focus layer and an enhanced image container exist, to level 20. Desk's key handler yields while that viewer is open, and its backdrop does not dismiss the editor beneath it. The viewer therefore keeps pointer, wheel, Tab, and Escape ownership.

## Product review

The current architecture supports the intended workflow: fixed events reserve time, unfinished tasks follow block order, and overflow stays visible. Estimates are sufficient for planning; CLOCK and standalone POMO remain optional. Desk should make the existing blocks easier to act on while preserving their source context and ownership. A new planning database, mandatory tracking, or a separate image viewer would add maintenance and interaction costs without resolving these failures.

This release prioritizes completing the collection cycle and yielding to native editing tools. Keep the existing one-editor model, shared scheduling projection, and bounded preview reads. Shorter tasks can make rescheduling easier, but task duration should remain the user's choice rather than a hard limit.

## Boundaries and follow-ups

No change is made to removal promotion, removal verification, scheduling, settled history, charts, settings, timers, or wrapper-ID persistence. A promoted wrapper still occupies its deterministic ID and remains a collision rather than creating another wrapper.

1. If an in-flight create plus extension reload produces a duplicate in a reproducible test, assess cross-owner coordination without weakening verification-only behavior.
2. If a live host version changes the image portal selector or stacking model, update the narrowly scoped host contract after an observed failure rather than applying a global z-index override.
3. A future clearer collision message for promoted wrappers is acceptable only if it preserves the same no-write behavior.

## Validation limits

Node tests exercise add, duplicate, edit, delete/re-add, lost-response, collision, cancellation, concurrent source/order changes, and late adoption with a direct source also present. The browser fixture runs three complete add/remove/re-add cycles through production actions without reloading, preserving the source and deterministic UID. Its host-shaped portal checks pointer hit testing, control clicks, real browser wheel input, and keyboard ownership even with focus left on Desk chrome; editor identity, scroll and selection survive. The overlay regression fails on the original source with both image and control hit tests false. These fixtures simulate the graph and editor; they do not certify live Roam drag, clipboard, IME, or host interaction. Live native-browser inspection remains separate.
