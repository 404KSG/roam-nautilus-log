# Release performance and readiness — 2026-11-02

Baseline: `8fcae54f4f83f42e24d92d7bd0dbbeda5d977c8e`. The user requested final whole-plugin review with Grok, measured optimization, repair of confirmed issues, and Ready-for-review submission of Depot PR #1455.

## Selected changes

1. Cache the exact fenced renderer source string lazily in `entry-helpers.js`. Production currently inlines two copies. Temporary builds reduced JS from 689,947 to 551,168 bytes and gzip from 197,674 to 165,869 bytes. The immutable r2 source body, fence whitespace, UID, namespace, and source verification stay byte-identical. Keep one JavaScript bundle and external CSS; add no chunks or CLJS transform.
2. Cache exact text widths within each `textMeasure` closure. Each font/measurer has a separate cache, rebuilt for every layout call; never retain widths across font-loading, language, viewport or later frame changes. Bound the cache to 4,096 short strings and cache finite numeric widths only. Preserve lines, title characters, cue placement, frame geometry, and the shared canvas font-restoration rule for real measurements.
3. Group cold-read CLOCK entries by owner once, preserving entry identity/order and readable-owner semantics. Validate the whole batch before populating caches. Keep TTL, LRU, owner coverage, graph scope and invalidation unchanged; do not replace the authoritative pull with the narrower fallback query.

## Baseline evidence

Synthetic unique-title layouts (supplied deterministic measurement): 20/100/300 rows make 4,429/22,443/67,925 width calls for 278/1,156/3,360 distinct strings. Cold CLOCK reads for 20/100/200 owners and 12 entries each make 4,800/120,000/480,000 owner-field visits from one source read. These operation counts and Node timings are not live Roam latency.

Scaffold checks are retained. Its mock returns entire entities regardless of pull patterns; the measured serialized bytes do not establish live host costs and do not justify dropping ownership checks around awaits.

## Release boundaries

Keep Current task / Current event wording, pointer red, retired automatic outline reordering, default-off event ordering and timestamps, future DONE reservations, native block/reference/IME ownership, one spiral, aggregate Actual, overnight owner and full-day/DST evidence, Calendar/OAuth policy and the existing POMO entry. No live graph mutation or authentication is part of this pass.

Parent supplements Grok's source review in authentication/reconciliation, native Desk mutations, execution UI, and bridge/session boundaries. Confirmed issues require reproducing regression tests before repair. Generic cleanup alone is not a release requirement.

## Measured implementation

The same synthetic workloads now make 278 / 1,156 / 3,360 text measurements for 20 / 100 / 300 rows, matching their distinct strings. CLOCK owner-field visits are 240 / 1,200 / 2,400 for 20 / 100 / 200 owners with 12 entries each; each batch still uses one source read. Four complete frame-output hashes match the baseline, including a 280px narrow layout. The renderer-source regression also changes the graph source after caching and requires a mismatch, so construction caching cannot hide later graph edits.

Parent source inspection covered Calendar authorization and reconciliation, privacy/storage correspondence, Desk mutation/removal ownership, the active-workday controller, renderer bridge ownership, and execution-popover activation/deferred refresh/teardown. No additional high-confidence blocker was reproduced. No network or live graph was used. Independent final review and frozen acceptance remain release gates.

## Acceptance

Compare baseline and final operation counts and bundle sizes using identical inputs/options. Verify exact layout outputs and renderer bytes, per-frame font freshness, CLOCK grouping order/coverage, and failed-read behavior. Run the full Node suite and all configured browser gates on a frozen clean candidate. Preserve existing skipped cases as limitations. Obtain a final Grok re-review, verify CI and published artifacts byte-for-byte, then mark the existing PR Ready for review; do not merge it.
