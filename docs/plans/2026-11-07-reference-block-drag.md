# Native reference-block bullet imports

Baseline: `64053ed3c598e478e2367701adfe0ae286eda0ad`.

## Diagnosis and gesture boundary

The import eligibility resolver returned text only for the dragged block itself.
Nested reference reads returned empty strings. A pure reference, multi-hop chain
or existing local TODO reference therefore lost its title and was rejected as
not-a-task; contextual prose could survive the same incomplete resolution.

The frozen first-party native drag/add path preserves the UID supplied by the
block bullet. A reference-wrapper block is still that dragged block, not an
instruction to flatten it into its ultimate target. The stored Desk embed must
continue pointing to the dragged UID, and its native editor must open that verified
immediate source.

The supplied native example includes completed content. Nautilus's previously
confirmed unfinished-task scope remains different: inherited DONE is declined,
while an existing local TODO retains its established precedence. No marker is
added to reopen a source.

The inline `rm-block-ref` text probe was a diagnostic hypothesis. The inspected
native span exposes click/Shift-click behavior, not an independently established
dragstart contract. The separate draggable native example is a page component.
This pass does not manufacture an inline-text drag gesture from those clues.

## Bounded source evidence

`readDeskReferenceSourceEvidence` reads normalized public block entities into a
per-snapshot map, following the same block-reference tokens used by task-instance
resolution. It preserves the root UID and detects missing dependencies, cycles,
unsupported source kinds and target-Plan references before mutation.

Limits are fixed: eight lookup levels including the dragged block, 128 distinct
blocks, 2,048 children per source entity, 1,024 expansion steps and 2 MiB source/evidence
and conservative expanded-text budgets. Reused nodes still count toward expansion
cost and cached subtree height is checked when reached through a deeper path.
Large child membership is refused before normalizing/sorting it. Source reads use
a shallow child projection; Plan-outline reads retain child text because they need
it. A projection-sensitive test proves eligibility does not request unused
source-descendant bodies.

The resolver consumes only this verified map. No mutable cross-call cache, guessed
title, source rewrite, CLOCK copy or renderer change is introduced. Existing task
marker, duration and range precedence remain in the shared task core.

## Async and write boundaries

A source fingerprint now includes the normalized evidence of all dependencies.
Direct sources without references retain their existing opaque fingerprint form.

- Read initial evidence before UID reservation.
- After awaited reservation/receipt observation, read a fresh dependency snapshot
  before the remaining synchronous ancestry/order checks and one create.
- Re-read all dependencies after create. An unavailable or changed post-write
  snapshot is an unconfirmed result, not a claim that nothing was written.
- Preserve exact-wrapper adoption even when dependency readback cannot confirm the
  action. Logical deduplication must not confirm another issued write.
- Before positioned duplicate movement, revalidate the complete fingerprint under
  the existing exclusive lane. Recheck it after the one move; uncertainty never
  authorizes a second move or compensation.

Synchronous native payload freezing, graph/provider/type/user guards, cancellation,
cycle checks, deterministic entry UID, strict order readback and the recent
read-only removal-recovery flow remain in force.

## Verification

Public import tests cover pure/multi-hop/local-marker references, local TODO over
nested DONE, known empty dependencies with local prose, inherited DONE, missing
and cyclic data, depth/count/expansion/byte/child budgets, dependency changes across
reservation and host writes, lost responses, context changes and exact-wrapper
adoption without duplicate creation.

`test/desk-reference-drag.py` adds 23 synthetic-browser cases for native bullet
identity, exact stored carrier, immediate-source editor UID, unchanged source and
reference leaf, source CLOCK remaining source content, missing/cyclic/ineligible
references, duplicate positioning and dependency changes before/after mutations.
It is included in `test:ui` and `test:desk`, with `DESK_REFERENCE_DRAG_OUT` for
isolated artifacts. Inline text remains a negative control, not a claimed feature.

The initial eligibility/origin diagnostic matrix and all fixture failures
remain in the task evidence. One fixture restored a function using a bare evaluated
assignment, which Playwright then invoked; wrapping the assignment in an arrow
function corrected only the fixture, without changing its assertions.

These are synthetic public-interface/native-shaped tests and dated static native
source evidence, not a live gesture capture or installed-host certification. Keep
all existing 27 browser gates and add the new reference gate; preserve renderer,
CSS, planner, CLOCK and removal contracts. Publish only the existing Draft after
clean-candidate review, complete tests, Git-free export and exact artifact linkage.
