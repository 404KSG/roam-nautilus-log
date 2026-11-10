# Unified Chart and List views

## Accepted interaction

Help is leftmost and the icon-only Chart/List switch is rightmost. Connected Calendar
sits between them. Chart shows the spiral and unfinished-task Desk cards. List shows
the existing native editable children, including events and completed records. Roam's
own caret folds the whole region; expansion restores the selected view.

The control row keeps one upper-right anchor in both views. Both modes retain
identical top spacing and responsive horizontal padding. Actions align to the
header's top rather than moving as the metrics and legend disappear; List can
still use a shorter header. Nonempty List credits the native space already below
full control hit rects. Plain outlines target an 8px gap; native embeds reserve only
their settings-bar height plus 2px. The calculation subtracts our own padding before
crediting space, avoiding a resize feedback loop. `list-clearance.js` observes only
active List layout: owner/shell direct children, original outline contents/visibility,
and current native tool sizes. Resize callbacks schedule writes outside delivery.
Empty/folded/Chart views stop these observers and add no List space. Membership uses
the existing verified Plan watch; failed reads retain the previous value. Controls
keep their local workspace anchor.

One hint manager owns Help, Calendar and view labels in the document body. The
original pseudos are disabled immediately only on the current renderer's own toolbar.
Per-control hovered/focused references support sibling transitions and focus fallback;
Escape dismissal persists until fresh input. The attribute observer follows real hover/focus interest, including a suppressed
Calendar label whose attribute is absent while its popover is open. It restores the
label after asynchronous close without requiring pointer movement. Escape closes
an open popover without dismissing that future label; a subsequent Escape dismisses
the label itself. Position/visibility listeners exist only while pending or visible.
Open Help/Calendar popovers suppress hints.
The shared paint, typography, arrow and 9px gap prefer below; only insufficient
viewport-bottom room flips the hint above. Scroll/focus updates preserve positioning,
and native fold or host teardown clears labels, timers, descriptions and listeners.
Off-screen anchors and document hiding intentionally dismiss the hint until fresh
pointer/focus/key input, retaining the existing view-hint policy. Popup suppression
is temporary within the same interaction, so its watcher survives async close.

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
surfaces. Realistic native settings retain a 28px box at opacity zero and move to
`top: -28px` on hover, matching authenticated read-only DOM inspection on 2026-11-10.
Fixtures with 0/8/16px native spacing verify only 30/22/14px extra padding and 2px clear
hit space; dynamic spacing, plain/empty/fold cleanup, independent menu/edit actions
and stable padding are checked. This also detects the former 12px vertical jump.
`test/view-tooltip.py` paints a competing native-outline layer to reproduce clipped
Help and view labels. It checks all toolbar hints, focus fallback, live Calendar copy,
popover suppression and stationary-hover recovery after async close, styling, edges,
scroll, pointer transparency, nested ownership
and teardown.
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
