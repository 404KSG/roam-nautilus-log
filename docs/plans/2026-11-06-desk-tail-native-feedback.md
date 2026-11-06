# Desk tail reorder and native feedback

## Scope

Desk-only same-parent card reorder coordinates and confirmed add/remove feedback.
No source-editor, embed storage, Undo, or global move-API change is included.

## Decision

`moveTask` keeps its post-removal final index for strict readback. For a downward
same-parent move only, it sends `finalIndex + 1` to public `data.block.move`.
Roam interprets that public `location.order` as a pre-removal sibling slot; upward
moves and index zero are unchanged. The confirmed outline must still exactly match
the requested UID sequence after one write.

A Desk view owns one lazy Blueprint `Core.Toaster` container. It uses top position,
3-second timeout, `autoFocus: false`, `canEscapeKeyClear: false`, and at most three
toasts. Confirmed add/remove receipts are success, duplicate/already-absent results
are primary, and errors are warning. There is no Undo action. When Blueprint is
unavailable or throws, the existing polite Desk status is the truthful fallback;
the graph receipt remains confirmed and is never retried.

## Evidence boundary

The reorder regression uses production `moveTask` plus the public move adapter and
a host fake that independently applies the public pre-removal-slot contract. Browser
coverage uses real pointer coordinates on an unequal, image-bearing masonry card,
both card halves, and a grid gap, then checks final full-outline order and unchanged
strings. Notification coverage checks the public Blueprint `Toaster.create` surface,
semantic intent, bounded options, fallback, dedupe, and owned-container cleanup.

Synthetic browser checks do not certify live Roam Desktop or a real graph.
