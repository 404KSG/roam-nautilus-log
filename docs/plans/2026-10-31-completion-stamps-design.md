# Completion timestamps: bounded ownership design

`completion-stamps-enabled` is independent and off by default. A confirmed user TODO→DONE action can append a local `dHH:MM` suffix. This records a completion time for estimated chart placement; it does not measure Actual or start CLOCK/POMO.

## Surfaces and transition boundary

The native adapter captures trusted checkbox and Cmd/Ctrl+Enter intent at document level. This includes the main outline, right sidebar, and Desk's dynamically mounted editor outside `.roam-body`. It changes neither native event propagation nor Desk placement. It freezes the target UID, instant, graph/provider/user context, and action generation before Roam handles the event.

Native IDs require complete `block-input-<window>-<9-character UID>` framing. Inline references resolve a validated `.rm-block-ref[data-uid]` without inventing a nested source editor. An outer checkbox belongs to its own block main; a nested child's checkbox belongs to the child. Selected roots are resolved individually, without admitting unselected descendants. At most 20 targets and 64 pending jobs are accepted. Unrelated text fields cannot borrow selections behind a dialog.

The adapter reads only those UIDs through public Pull and short-lived Pull Watches. Registration uses EDN lookup strings and a settlement latch installed before the host call. Synchronous callbacks, asynchronous registration, rejection, removal, and deadline settlement are covered. Fallback reads are finite, at 0/50/150/400/800/1300/1900/2400 ms, within a 2.5-second observation budget. Native graph confirmation and editor redraw can settle at different times; one early graph notification is not the last opportunity to check the editor.

After both match, a separate 2.5-second preparation budget covers acquiring the CLOCK lock and preparing ownership. The writer signals immediately before issuing its first block update, after the final safety checks. That signal ends the adapter's preparation deadline; the writer then owns the existing bounded host-result/readback and receipt path. An observation deadline cannot cancel a valid already-issued write and strand its suffix without a receipt. Monotonic expiry also prevents a suspended timer callback from reviving old unissued work. Timeouts report one notice per gesture; they do not trigger passive backfill or automatic retry. There is no permanent polling loop or global graph scan.

Only an exact marker transition with otherwise identical text qualifies. Cmd/Ctrl+Enter freezes its verified raw textarea as an expectation even when its TODO marker has not reached the graph yet. Roam cycles the raw editor from no marker to TODO to DONE, then saves after a debounce; admitting only a previously stored marker would silently drop rapid keyboard completion. The observed committed text must differ from the saved text at gesture time and exactly match the raw-buffer transition before the writer acts. This excludes an already stored DONE value and never saves the buffer on the user's behalf. Read-only rendered text is never compared as an editing buffer. Composition is scoped to the writer and cleaned up on lifecycle changes; an unmounted editor cannot leave a permanent composition flag.

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

Automated acceptance uses deterministic Node tests and an isolated browser graph with native-shaped rendered text, textarea edits, inline references, nested children, and dynamic body portals. Cold-path regressions cover a 550 ms editor redraw, a 900 ms native commit, delayed lock acquisition, a 1000 ms issued write with verified ownership/removal, expiry after suspension, and a later native change beyond the observation budget. It includes trusted input, both keyboard modifiers, rapid no-marker→TODO→DONE editor cycles with a modeled 700ms graph-save debounce, multiselect, composition events, owned reopen/recompletion, passive changes, conflicts, and teardown. Runtime integration checks source versus wrapper ownership, the shared CLOCK instant/lock, and refusing unsafe editing before CLOCK closure. These fixtures do not certify live Roam Desktop, OS-level IME, or atomic native Undo. Development does not change real user tasks or plugin settings.
