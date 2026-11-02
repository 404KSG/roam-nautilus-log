# Published v1 regression fixture

These three files are exact copies from `404KSG/roam-nautilus-log` commit `f0bb0d9030421f19e4c3556a4d0a6b193de66c9d`. They retain that revision's MIT license (see the repository LICENSE).

They are test inputs, not current implementation. Do not update their namespace, renderer UID, global bindings or scaffold behavior. The renderer coexistence gate evaluates the complete old CLJS alongside the current source and runs the actual old scaffold against an isolated graph. It tests both mount orders, later old-source evaluation/writes, current bridge replacement, retained historical reads, stale cleanup, source refusal and final watch cleanup.

| File | SHA-256 |
| --- | --- |
| component.cljs | `46aa29a547da49d6143e73e84eb270f4e0b94344736607ef5b258fddef36e1c4` |
| entry-helpers.js | `bac23c4b710632dbb38421c9af3d9beffff3ecad501e7371e9c27ab37f8c9593` |
| render-context.js | `4dc2733de8dc9e5b523aa36165c4b001980abd736a39484cd978fb8fe13ab422` |

The graph, native editor boundary and browser are synthetic. This gate does not certify live Roam Desktop, operating-system IME, native Undo or other devices. It cannot stop an old client from editing its legacy code blocks or managed template; all clients should be updated.
