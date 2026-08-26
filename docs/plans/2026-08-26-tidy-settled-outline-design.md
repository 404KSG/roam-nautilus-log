# Tidy settled-outline design

## Goal

Tidy should move settled direct children to the front and collapse only settled
items that are currently expanded. Active work must retain the user's outline
state, including after Roam recreates rows during a move.

## Behavior

- Settled means the existing Tidy input: completed tasks and elapsed fixed
  events, excluding the currently running task.
- After stable reordering, collapse only settled children whose current
  `block/open` value is `true`.
- Preserve unfinished children exactly as the user left them. If a move causes
  Roam to collapse an expanded active child, restore its original state.
- A collapse-only pass is a real Tidy change even when the order is already
  correct.
- Undo restores the original order and reopens only children that Tidy itself
  collapsed. If the user already reopened one, perform no redundant write.

## Performance and safety

Reuse the existing direct-child read and `settledUids`; add no graph scan,
poller, or watcher. Outline writes are limited to children whose state changes.
Keep move and outline mutations sequential so Roam can confirm each state. The
Undo order guard remains authoritative, and later user outline choices are not
overwritten.

## Verification

- Completed expanded children collapse; unfinished outline choices remain.
- Roam move-induced collapsing is repaired for unfinished expanded children.
- Tidy works when only outline state changes.
- Undo restores order and only the outline states changed by Tidy.
- Repeated Tidy is idempotent and the running task is never collapsed.
