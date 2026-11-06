# Native-host width verification

## Finding and scope

The apparent `sidebar / 520px` overflow was a test-harness error, not a demonstrated Desk-width defect. In `adaptive_density_contract`, one mounted chart moves between main, sidebar and embed hosts. The failing step had already moved into the embed host, but the document-overflow control and diagnostic context still described the initial sidebar.

The captured native stylesheet gives `.rm-embed-container` a `margin-right: -116px`. In the isolated fixture that host extends the document by 116px. Removing Nautilus leaves the same 116px; moving the empty fixture shell back to the sidebar returns it to zero. Temporarily removing that native margin also returns it to zero, and restoring the margin restores 116px. This counterfactual is diagnostic only: production CSS must not compensate for the fixture's host styling.

The minimal pre-fix transition reproduces the original result exactly: document overflow 116, stale host control 0, local plugin overflow 0. A direct sidebar load at 520px does not reproduce it.

## Test contract

`test/chart-renderer.py:write_page` now measures all three hosts before mounting the component, with the production stylesheet disabled. The native-only controls are frozen. Moving a rendered chart selects the control belonging to its actual parent; it never recalibrates from the candidate under test. The ordinary fixture shell also fits narrow browser viewports before the component mounts.

`test/chart-renderer-harness.js` reports the current DOM host, retaining the initial URL context separately for diagnostics. `coverage` requires that the reported host and selected control agree. Its overflow tolerance remains one CSS pixel, and its local-overflow, geometry, record-coverage and zero-write assertions remain intact.

`host_width_contract` adds:

- 14 same-instance host transitions across light and dark themes;
- 36 same-instance local-width checks spanning 280–960px;
- 21 checks across main/sidebar/embed hosts and 360–1200px browser viewports;
- three negative controls that deliberately add a genuinely oversized child.

The transition checks retain the SVG node, source rows and single clock timer. Each negative control must fail the width assertion without changing the frozen host controls; removing it must restore a passing result. A native embed's own overhang therefore cannot be used to conceal added plugin overflow.

## Launcher capability coverage

The historical 15 skipped combinations all attempted execution-popover checks on the creation/navigation-only launcher. Each corresponding execution-surface case was already executed. They were not 15 missing product behaviors.

`test/real-today-plan.py` now registers these as explicitly inapplicable launcher combinations and links each to its executed counterpart. Unexpected skips are failures. Two additional checks verify that normal, modified and keyboard launcher actions at narrow/wide widths do not create an execution popover or extra graph writes, and that all 15 counterpart tests actually passed. Inapplicable combinations are not counted as passing tests.

## Validation and limits

Run the existing Node suite and all 25 browser gates both with the default fixture styles and with complete captured native styles/fonts. Keep source identity, per-command exit codes and profile-specific output paths. The native chart gate must complete its original 15-case matrix, five stress cases and the added width checks; do not filter out the former failing transition.

All production files under `src/`, `extension.css` and dependency declarations remain unchanged by this correction. No live graph, authenticated Desktop interaction, physical drag/clipboard or OS-level IME operation is part of these isolated checks. Passing this matrix resolves the specific test anomaly; it is not an unlimited compatibility claim for every host version or custom theme.
