# Completion timestamps: bounded ownership design

`completion-stamps-enabled` is independent and off by default. A confirmed user TODO→DONE action can append a local `dHH:MM` suffix. This records a completion time for estimated chart placement; it does not measure Actual or start CLOCK/POMO.

## Surfaces and transition boundary

The native adapter captures trusted checkbox and Cmd/Ctrl+Enter intent at document level. This includes the main outline, right sidebar, and Desk's dynamically mounted editor outside `.roam-body`. It changes neither native event propagation nor Desk placement. It freezes the target UID, instant, graph/provider/user context, and action generation before Roam handles the event.

Native IDs require complete `block-input-<window>-<9-character UID>` framing. Inline references resolve a validated `.rm-block-ref[data-uid]` without inventing a nested source editor. An outer checkbox belongs to its own block main; a nested child's checkbox belongs to the child. Selected roots are resolved individually, without admitting unselected descendants. At most 20 targets and 64 pending jobs are accepted. Unrelated text fields cannot borrow selections behind a dialog.

The adapter reads only those UIDs through public Pull and short-lived Pull Watches. Registration uses EDN lookup strings and a settlement latch installed before the host call. Synchronous callbacks, asynchronous registration, rejection, removal, and deadline settlement are covered. Fallback reads are finite, at 0/50/150/400 ms; a 750 ms deadline also cancels work awaiting the writer or lock. There is no polling loop or global graph scan.

Only an exact marker transition with otherwise identical text qualifies. Cmd/Ctrl+Enter can freeze its raw textarea as an expectation, but the host must commit that exact text and transition before the writer acts. Read-only rendered text is never compared as an editing buffer. Composition is scoped to the writer and cleaned up on lifecycle changes; an unmounted editor cannot leave a permanent composition flag.

Superseding gestures, disable/enable cycles, graph/provider/user changes, navigation, unload, and Undo/Redo invalidate pending intent. Native Undo/Redo is neither intercepted nor repaired. Native completion plus its later suffix may remain separate undo steps. A host write already issued cannot be canceled by this public API; an unresolved result is reported without a blind retry.

## Shared writer and CLOCK integration

Native writes share the existing `nautilus-log:clock:<graph>` guard. Nautilus's completion command already holds that guard, so its direct path must not acquire it again. The command checks editor/context safety before closing CLOCK and passes the same frozen instant into CLOCK closure and marker-plus-stamp writing. The direct path can change the marker and add a suffix in one update. Feature-off keeps the legacy completion path and installs no active native timestamp listeners or watches.

The writer checks context, generation, current committed text, and editing state around asynchronous hashing and immediately before a write. Host calls have a bounded result wait and exact readback confirmation. A rejected response can still be confirmed by readback. An unresolved call blocks reissue for the same owner until it settles; it never claims unchanged text merely because the response was lost.

## Text and ownership

A suffix is exactly one final ` dHH:MM`. Existing completion fields, including manual, old-plugin, calendar, duplicate, malformed, or code-literal times, prevent an additional suffix. Reference IDs, URL spans, ordinary words, and legacy `dNN%` progress are not completion fields. Reopen removes only a terminal suffix with a matching receipt and unchanged body. No history migration or backfill runs.

Receipts use the existing extension setting `completion-stamp-receipts`. Each holds graph, graph type, user UID, block UID, token, action time, and SHA-256 of the body with only the task marker normalized. Task text and completion history are never stored. The limits are 64 receipts and 32 KiB; retention follows operation order, not wall-clock order. String and object stores are validated for exact fields, scopes, hash shape, timestamps, counts, and UTF-8 size.

A missing, corrupt, evicted, stale, or foreign-scope receipt cannot authorize deletion. Changed body text also prevents deletion. Receipt persistence is read back and compared by field values. Failure after a confirmed stamp write leaves the suffix intact and warns that ownership was not safely saved. On reopen, receipt removal must be persisted and its absence verified before the suffix is deleted. Failed revocation preserves the suffix. If the later text update fails, the receipt remains revoked so an identical manual token cannot inherit its authority.

## Coexistence and verification limits

A public `window.roamjs.loaded` identity for `todo-trigger`, or an unrecognizable existing registry, blocks optional stamping. Nautilus warns but never inspects or changes Todo Trigger settings. Users must disable that extension on every client; disabling only its Append Text option does not clear the loaded-identity check.

Automated acceptance uses deterministic Node tests and an isolated browser graph with native-shaped rendered text, textarea edits, inline references, nested children, and dynamic body portals. It includes trusted input, both keyboard modifiers, multiselect, composition events, owned reopen/recompletion, passive changes, conflicts, and teardown. Runtime integration checks source versus wrapper ownership, the shared CLOCK instant/lock, and refusing unsafe editing before CLOCK closure. These fixtures do not certify live Roam Desktop, OS-level IME, or atomic native Undo. Development does not change real user tasks or plugin settings.
