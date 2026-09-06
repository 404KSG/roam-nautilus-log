# Bundle optimization design

## Goal

Reduce Nautilus Log's shipped JavaScript without changing runtime behavior or
depending on files that Roam Depot does not guarantee to load.

## Decision

Keep `extension.js` as one entry bundle and let Roam Depot load the existing
root `extension.css` separately. Remove the CSS import, Webpack CSS rule, and
unused `css-loader` dependency. This eliminates duplicated CSS payload while
preserving the documented Depot artifact contract.

Use Webpack 5's built-in `asset/source` module for the Clojure renderer instead
of the legacy `text-loader`. This removes another build dependency without
changing the renderer string contract.

Do not introduce dynamic JavaScript chunks in this change. Depot documents
`extension.js` and optional `extension.css`, but does not guarantee discovery
or hosting of additional Webpack chunks. Do not minify the embedded Clojure
renderer yet; its source is written into Roam and should retain reader-safe
syntax until a dedicated transform has stronger validation.

## Verification

- Compare the production `extension.js` byte and gzip sizes before and after.
- Run the complete test suite and Clojure reader validation already used by the
  repository build.
- Confirm `extension.css` remains in the repository root and unchanged.
- Confirm the Webpack build emits one JavaScript asset with no extra chunks.

## Result

- `extension.js`: 306,247 bytes → 254,936 bytes (51,311 bytes / 16.8% smaller).
- Gzip: 78,575 bytes → 71,168 bytes (7,407 bytes / 9.4% smaller).
- The build still emits exactly one JavaScript asset, while Roam Depot receives
  the unchanged root `extension.css` as its documented optional stylesheet.
- `css-loader`, `text-loader`, and their now-unused transitive packages were
  removed from the lockfile.
- The complete suite passes: 230 tests, 0 failures.
- This machine has no `clojure` executable, so `build.sh` would skip its optional
  reader pass; the repository's SCI delimiter/reader contract test passed.

Webpack's default 250,000-byte advisory remains because the JavaScript bundle is
4,936 bytes over that generic threshold. The remaining weight is application
code plus the embedded ClojureScript renderer, not a removable third-party
runtime dependency. Crossing the threshold by hiding the warning or adding
undocumented runtime chunks is intentionally out of scope for this safe pass.
