# Conservative core interval optimization

Baseline: `a1759a2f810651b9f72889a072eb7036e08769da`. The user requested a
whole-plugin review with Grok and small, evidence-backed performance improvements.

## Selected changes

- `scheduleTasks` advances a per-call index through already normalized, sorted,
  merged fixed intervals. Its scheduling cursor never moves backward, so consumed
  intervals need not be searched again for every task.
- `overlappingFixedEventUids` sorts a copy and retains the furthest-ending earlier
  interval. A later start strictly before that end identifies an overlap. Other
  active predecessors have already been marked. The result still filters the
  original event sequence, retaining UID order and duplicate-UID behavior.

The first removes repeated interval searches after normalization. The second
replaces pairwise overlap checks with an O(F log F) sort and O(F) scan. Neither
changes the public interface, stores a cross-call cache, mutates inputs, or writes
to Roam. Whole tasks, finite END, fixed reservations, half-open boundaries, duration
rounding, queue order and overflow remain unchanged.

## Evidence

A deterministic probe compared both public results with the actual baseline on
1,500 seeded inputs and checked input preservation. Literal cases cover whole-task
placement, no overtaking, containment and touching boundaries. Instrumented copies
counted interval comparisons; uninstrumented copies supplied supporting timings.

| Tasks / fixed events | Scheduling interval-end checks | Overlap relation checks |
| --- | ---: | ---: |
| 20 / 5 | 99 → 19 | 10 → 4 |
| 100 / 20 | 1,849 → 79 | 190 → 19 |
| 500 / 400 | 94,375 → 1,000 | 79,800 → 399 |

These are synthetic work counts, not live Roam latency. Ordinary small-plan timing
differences are negligible; the useful result is avoiding repeated scans in dense
plans. The overlap sort cost is included in the algorithm's complexity.

`test/log-core-intervals.test.js` adds eight public-contract tests, including an
independent minute-grid scheduler oracle over 1,000 day/overnight cases and a
pairwise conflict oracle over 1,500 unsorted cases. Frozen inputs catch mutation.
The semantic tests pass before and after this behavior-preserving refactor.
Two controlled mutants—skipping a fixed interval and treating touching endpoints
as overlap—fail the maintained assertions, not test setup.

## Rejected or deferred alternatives

Removing the renderer's minute dependency is unsafe. A silent external CLOCK edit
from 10 to 30 minutes then remains displayed as 10 at the next minute; an explicit
CLOCK signal is not a substitute for that freshness boundary.

Pausing hidden-chart parsing and grouping completed CLOCK payloads had measurable
prototype gains, but both change the published CLJS body. The existing source
upgrade guard correctly refuses a changed body at the same source revision.
This small pass does not weaken that guard or introduce a larger source/namespace/
bridge upgrade. Those prototypes are not shipped.

The CLJS source, renderer identity, CLOCK/estimate ownership, Desk membership,
Calendar authorization/reconciliation, graph guards and visual design remain
unchanged. This is not a claim of full native Desk parity or installed-host
certification.

## Release gate

Require a clean candidate, full Node tests, both complete browser profiles,
current-source Grok review, independent verification, a Git-free source export,
and exact source/manifest/CI/publisher/four-file linkage. Update only the existing
Draft PR1520; do not merge or mark it Ready automatically.
