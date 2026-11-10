# Unified Chart and List views

## Accepted interaction

Help is leftmost and the labeled Chart/List switch is rightmost. Connected Calendar
sits between them. Chart shows the spiral and unfinished-task Desk cards. List shows
the existing native editable children, including events and completed records. Roam's
own caret folds the whole region; expansion restores the selected view.

The view switch changes presentation only. It does not write task text, membership,
order, source folds or the native parent's graph `open` property. Current views have
independent graph/plan/main-or-sidebar localStorage preferences. Missing, invalid or
unavailable storage defaults to Chart. Old Desk and Eye flags remain untouched for
historical renderers and are ignored by this policy.

## Owners and lifecycle

`component.cljs` owns the stable toolbar and mounts chart content only in an expanded
Chart view. The Desk host remains mounted to retain its local owner across modes.
`plan-view-host.js` reads that surface's native state, owns its preference and emits
view changes. `desk-view.js` retains its existing session/editor/preview ownership.
The current bridge exposes `togglePlanView`; historical `openDesk` retains its toggle
semantics.

List parks an existing Desk using its folded state, including nonempty uncommitted
drafts. It waits for the serialized native editor lane to finish before releasing
its original-outline claim. A quick return to Chart cancels that release by checking
the current mode. Native folding retains the Chart session and its claim, drops any
body-mounted focus layer and pauses previews. Returning to Chart resumes the same
session. Overview Escape does not save a new view; the switch owns that choice.

Read-only authenticated DOM inspection on 2026-11-10 confirmed owning blocks marked
`rm-block--open` / `rm-block--closed` and their own `rm-caret-open` / `rm-caret-closed`
caret. A childless block's `rm-caret-hidden` keeps the view control reachable. Observe
only the owner and native control subtree; descendant content is not a fold signal.
No private graph content or images were captured or committed.

## Renderer upgrade

The source advances to revision 3 with a separate namespace and bridge. Its permanent
`roam-render-Nautilus-Log-r2-cljs` UID is unchanged. The exact published revision-2
source hash remains a registered predecessor; custom, newer and same-revision-divergent
source is preserved by the existing verified source upgrade mechanism.

## Evidence and limits

`test/plan-view.py` runs the exact current CLJS with production presentation and Desk
controllers, covering main/sidebar/embed, English/Chinese, dark mode, keyboard order,
Calendar position, native folding, refresh restoration and original-outline identity.
`test/plan-view-lifecycle.py` covers delayed native mount/unmount, retaining the outline
claim until cleanup, native focus dismissal, parked IME draft recovery, independent
sidebar folds and teardown. Existing v1 coexistence checks keep historical behavior.
These are synthetic graphs and editors; the live native inspection establishes DOM
shape, not a live end-to-end gesture or OS IME certification.
