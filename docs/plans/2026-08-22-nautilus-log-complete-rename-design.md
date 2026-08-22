# Nautilus Log Complete Rename

## Decision

Rename the complete product from **Nautilus Flow** to **Nautilus Log**. The rename covers user-facing copy, technical identifiers, repository metadata, Roam Depot metadata, templates, render UIDs, CSS, runtime globals, tests, and documentation.

The user's `exuberantia` graph is migrated globally rather than preserving historical prose. Exact legacy variants are replaced everywhere:

- `Nautilus Flow` → `Nautilus Log`
- `Nautilus-Flow` → `Nautilus-Log`
- `nautilus-flow` → `nautilus-log`
- `nautilusFlow` → `nautilusLog`

Generic words such as `Flow`, `Nautilus`, or `flow` are not replaced on their own.

## Product and code identity

The canonical repository is `404KSG/roam-nautilus-log`. New templates use:

```text
[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}
```

The package, ClojureScript namespace, renderer bridge, runtime globals, events, CSS classes and variables, local collapse key, loading copy, accessibility copy, and test names use the Nautilus Log identity. The internal scheduling module is renamed from `flow-core` to `log-core` so the old product name does not remain as an architectural label.

## Graph migration

Migration uses the official Roam CLI against `exuberantia`:

1. read graph guidelines;
2. search every exact legacy variant and resolve affected page/block UIDs;
3. retain an in-session mapping of UID, original string, and replacement string;
4. update page titles and block strings by explicit UID;
5. read every changed UID back;
6. repeat all four searches and require zero legacy matches.

The migration changes content but does not delete blocks or descendants. A failure stops further writes and reports the exact UID and expected replacement.

## Release order

The source code is renamed and fully tested first. The GitHub repository is then renamed, followed by the Roam Depot Draft manifest and successful Build/Publish checks. Only after the new Draft is available is the live graph migrated. This minimizes the interval in which new render UIDs exist without a matching extension build.

## Verification

- Production webpack build succeeds.
- All Node and renderer contract tests pass under the new names.
- A bounded repository search finds zero legacy variants outside the historical rename design itself.
- GitHub source, manifest source commit, PR comment, and shorthand all reference `roam-nautilus-log` and the same commit hash.
- All changed Roam UIDs read back correctly and follow-up searches return zero legacy matches.
