# Safe native-parity stage 1

## Current scope

Desk remains a projection of the current Nautilus plan. It shows only unfinished
cards (including unscheduled tasks). DONE roots, fixed events, dividers, empty
rows, page cards, membership expansion, Undo, source deletion, Sidecar ownership,
and personal native Desk state are outside this stage. Child notes and local CLOCK
content inside an unfinished task remain visible in its preview and editor.

## Implemented seams

- Public mutation capability hints gate New task, dragging, Move to top, strict
  removal, and external import. Create/move retain their documented legacy fallback;
  import and removal require their existing modern public contracts. Guards and
  readback remain authoritative, and **Refresh** rechecks capabilities without polling.
- A native `embed-path` card displays only its verified external source-page title.
  Local cards have no fabricated plan-page/date footer. The bounded page/source watches
  read after admission and update a rename or relocation without remounting the editor or
  reloading images; an unavailable watch exposes the existing explicit Refresh retry.
- A positioned duplicate native embed reuses guarded `moveTask` semantics only after
  the import lock settles. It revalidates graph/user/provider, wrapper/source identity,
  membership, target, capability, and exact full-order readback; an existing source is a
  warning without a move action, and unpositioned branches do not invent one.
- The maintained browser suite records view-level Alt+Digit behavior for visible and
  filtered order, entry/source identity, bounds, inputs, modifier rejection, modal/editor
  priority, and zero writes. An isolated synthetic composing key remains an observation,
  not a changed native behavior.

## Validation contracts

The removal-hint read budget is measured after the changed title and its preview
are visible and public reads have settled. A matched no-modern-removal control
retains legacy movement, separating the extra shared Plan/Daily Note ownership
reads from ordinary projection and preview reads. The overhead must stay constant
for 3 and 100 cards and at most three reads; an immediate pre-refresh zero is not
budget evidence.

The native geometry test retains native smooth scrolling, real launcher clicks,
and exact viewport x/y/width assertions. Programmatic focus used to prepare Alt-key
cases uses `preventScroll` so an earlier keyboard-test scroll cannot contaminate a
later import measurement. Isolated controls reproduced the viewport drift even
without performing an import; no product scrolling or CSS workaround is needed.

## Evidence boundary

These are public-adapter and synthetic-host checks, not live Roam/Desktop proof. No real
graph, native private function, source deletion, page import, Undo, or all-content Desk
projection was used or added.
