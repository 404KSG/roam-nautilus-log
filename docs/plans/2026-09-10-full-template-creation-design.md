# Full-template one-click creation

## Decision

The 30px localized topbar action creates or opens today’s local-calendar Daily
Note from any page. For the single managed Nautilus template it freezes the
actual renderer root and its complete ordinary descendant tree, then appends a
new UID-mapped copy. It does not open a panel, require `;;`, copy yesterday,
start CLOCK/POMO, contact Google, or change the template.

The root string comes from the frozen renderer block, not from generated
settings. Fixed events, tasks, separators, nested children, TODO/DONE text,
and supported presentation fields (`open`, `heading`, `text-align`, and
`children-view-type`) retain source order and structure. References to UIDs
inside that frozen tree are remapped; references outside it remain unchanged.

## Safety model

`createTodayPlanSession` remains the only discovery, lock, write, confirmation,
and navigation path for the launcher, execution empty state, and command.
Creation freezes graph/date, uses the graph/date Web Lock and reserved root UID,
checks again inside the lock, preallocates all UIDs, confirms the source has not
changed before its first write, and appends the root at the Daily Note end.
Existing manual, empty, or all-DONE Nautilus plans are locate-only.

A full readback must match every expected UID, parent, child order, rewritten
string, and supported presentation field. A visible root alone is not success.
Failed writes are retained as `partial`; they are never deleted, overwritten, or
silently supplemented. The session keeps an opaque settings record containing
only operation identity and structural fingerprints (no template body). After a
reload it is diagnostic: incomplete content can be opened and checked, but it
is not automatically resumed from a newly read template.

## Boundaries

A missing managed template retains the pre-existing empty-component fallback.
Multiple candidates, multiple renderer roots, template top-level siblings,
dynamic/unreadable renderer content, unsupported host APIs, source changes, UID
collisions, or an unavailable safety record fail closed with a concrete reason.
The user can open the template for unsupported cases. Web Locks coordinate only
participating same-origin browser contexts, not devices or manual writers.

Before the first write a date/graph/unload change stops the operation. Once a
write begins, its frozen original date is read back; no later date receives the
content. Real Roam API behavior remains a live-validation boundary: automated
coverage uses only isolated host mocks and browser fixtures.
