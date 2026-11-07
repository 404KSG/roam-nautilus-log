# Desk removal recovery and native block origins

Baseline: `5e4d435083ee86c7c97173803d5f70fae56ce9ba`.

## Report and evidence boundary

A user reported an unconfirmed-removal warning followed by blocked imports until
refresh, and rejection of block drags from linked references. Screenshots show the
warning and a lower card count, but do not identify the exact host timing or field
change that triggered verification failure.

Controlled production-interface probes establish two reachable problems:
- Identical block UID, graph context and native payload succeed in ordinary/sidebar
  outlines but are rejected solely because a reference, query or embed view is an
  ancestor.
- Correct removal plus an unrelated sibling's presentation change fails full-node
  postcondition equality. A result that becomes readable after the first verification
  attempts also leaves a receipt blocking later imports until explicitly verified.

The probes are synthetic. They do not prove that the installed host changed a
particular field or resolved its promise before graph visibility.

## Removal postcondition

Admission still takes the complete strict snapshots. During the existing bounded
walk, mark the owned target/subtree and actual referenced source trees as protected.
After the one mutation, retain full equality for protected nodes, including their
presentation properties. A referenced source remains protected even when it is
also a Plan sibling.

For collateral siblings, ancestors and pages only, omit presentation fields from
the post-write comparison. Their UID, kind, content/title, parent/page identity,
child membership and order remain checked. This is narrower than ignoring all
formatting: owned/source formatting and every content or ownership discrepancy
still fail closed. Legacy snapshots without this classification retain full checks.

## Read-only reconciliation before a new import

Freeze the native DataTransfer synchronously as before. Revalidate the captured
provider/graph/type/user and cancellation state, then call the existing removal
verification outside the import's exclusive queue. That verification owns the
queue itself; nesting it inside an import would deadlock.

Only a confirmed old outcome permits the new import to enter its own guarded
lane. A missing/changed/conflicting target or source still blocks it. There is no
second delete/move, timeout-based receipt eviction, compensating write or fake
success. Scope and cancellation guards run again before any new write. Once the
controller explicitly reports the removal lock clear, the view retires its stale
retry indicator. Manual Refresh remains a read-only recovery route.

## Origin identity, not ancestor view class

A connected native block bullet uses its closest `data-block-uid` in the same
document. That UID must agree with the synchronously frozen native single-block
payload and graph URI; the graph reader still verifies the actual source. The
surrounding reference/query/embed/sidebar view is not an authorization or rejection
rule. An invalid new origin clears only the drag candidate, never an issued import.

Page headings/references, containers, ordinary text selections, files, multiple or
mismatched UIDs, cross-graph payloads and Desk's internal drag ownership remain
separate. Source eligibility and unfinished-task rules do not change: a query or
renderer container is not made importable just because real blocks inside its
view can be dragged. No source is moved or rewritten, and no completed source is
reopened.

## Maintained controls

- Removal tests cover delete and promotion with unrelated presentation changes,
  plus owned/source formatting, text, ownership and source-as-sibling conflicts.
- `test/desk-import-recovery.py` covers seven native-shaped source locations,
  payload/origin/type negatives, late delete and promotion followed by a new
  import, revoked DataTransfer access, genuine uncertainty, source conflicts,
  user changes and cancelled intents. It is included in both `test:ui` and
  `test:desk`, with `DESK_IMPORT_RECOVERY_OUT` for isolated artifacts.
- Keep all existing Node and browser gates. Use a clean final candidate, independent
  review, both default and complete-native styles, Git-free export and exact Draft
  publication artifact checks. No live graph mutation, physical OS drag or installed
  Roam certification is implied by these fixtures.
