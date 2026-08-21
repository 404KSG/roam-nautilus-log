# Right-Sidebar Compact Schedule

## Decision

When Nautilus Flow renders inside Roam's right sidebar, initialize the compact
`Schedule` details list as folded. Keep the main-page compact list expanded by
default so the existing desktop behavior does not change.

## State model

The extension identifies the right-sidebar DOM context without writing to the
graph. The renderer uses that context only once to initialize a per-render
Reagent atom. Subsequent `<details>` toggle events update the atom, so a manual
open or close choice survives clock ticks and reactive task updates for the
lifetime of that render.

Breadcrumb and collapsed-path replicas remain suppressed by the existing,
separate context detector. Right-sidebar charts remain visible; only their
compact schedule list starts closed.

## Verification

The built-extension test verifies right-sidebar detection. Renderer contract
tests require controlled details state and reject the previous unconditional
`:open true` behavior. The full extension build and test suite must pass before
the Depot draft source commit is advanced.
