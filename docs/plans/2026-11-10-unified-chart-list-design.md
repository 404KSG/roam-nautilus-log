# Unified Chart and List views

## Accepted interaction

Help is leftmost and the icon-only Chart/List switch is rightmost. Connected Calendar
sits between them. Chart shows the spiral and unfinished-task Desk cards. List shows
the existing native editable children, including events and completed records. Roam's
own caret folds the whole region; expansion restores the selected view.

The control row keeps one upper-right anchor in both views. Both modes retain
identical top spacing and responsive horizontal padding. Actions align to the
header's top rather than moving as the metrics and legend disappear; List can
still use a shorter header. This is a local workspace anchor, not viewport-fixed.
The switch hint is owned by the same host but rendered into the document body;
its original in-tree CSS pseudo hint is suppressed only for that owned control.
This escapes native outline paint layers without lifting or moving the buttons.
The hint follows current action text, keyboard focus, viewport edges and scrolling,
and is removed on Escape, native fold or host teardown. Shared control-row/embedded
native-menu collision layout is outside this hint repair.

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

Outline claims are token-scoped within one bundle. Separately evaluated bundles
have separate claim maps, so a retired bundle's delayed cleanup can remove the
same DOM flag after a successor has claimed it. Each live owner therefore watches
only the direct native outlines' owned visibility flag as well as their membership,
and reasserts the flag when required. Scans disconnect before writing and rebuild
only current-node watches; unchanged attributes are not rewritten. List/unload
releases disconnect first, so no inactive owner can keep the outline hidden.

Read-only authenticated DOM inspection on 2026-11-10 confirmed owning blocks marked
`rm-block--open` / `rm-block--closed` and their own `rm-caret-open` / `rm-caret-closed`
caret. Native `rm-caret-hidden` is decorative and also appears on blocks with children;
it must never override expansion. Empty-plan access uses membership from the existing
shared Plan subscription, preserving the last verified result during read failures. Observe
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
`test/view-control-anchor.py` checks all control positions, repeated same-point
clicks, native-fold restoration, connected Calendar and light/dark/main/sidebar/embed
surfaces. It detects both the former 12px vertical jump and compact inset changes.
`test/view-tooltip.py` paints a competing native-outline layer to reproduce the
missing List label. It checks both action labels, keyboard focus/Escape, viewport
flipping, scroll, pointer transparency, original anchors and fold/unmount cleanup.
`test/plan-view-lifecycle.py` covers delayed native mount/unmount, retaining the outline
claim until cleanup, native focus dismissal, parked IME draft recovery, independent
sidebar folds and teardown. It separately evaluates the real outline module to
check retired-bundle cleanup, the successor's protection and subsequent List release.
Existing v1 coexistence checks keep historical behavior.
`test/plan-fold-stability.py` reproduces the original failure: 16 decorative caret
changes caused 15 fold transitions without any native expansion change. The repaired
main/sidebar cases produce zero transitions and retain the other simultaneously
mounted copy. Empty-plan access and idempotent delivery have separate coverage.

These are synthetic graphs and editors; the live native inspection establishes DOM
shape, not a live end-to-end gesture or OS IME certification.
