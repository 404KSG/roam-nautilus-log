const test = require('node:test');
const assert = require('node:assert/strict');
const { masonryLayout, orderDeskTasks, moveDeskTask } = require('../src/desk-core');
const tasks = (...uids) => uids.map((uid) => ({ uid }));

test('masonry fills the shortest column with natural heights, not equal-height rows', () => {
  const layout = masonryLayout([160, 80, 120, 60], 660);
  assert.equal(layout.columns, 2);
  assert.deepEqual(layout.items.map(({ x, y }) => [x, y]), [[0, 0], [338, 0], [338, 96], [0, 176]]);
  assert.equal(layout.height, 236);
  assert.equal(layout.cardWidth, 322);
});

test('masonry follows container width, supports narrow sidebars, and has no overlapping cards', () => {
  const heights = [80, 280, 92, 170, 160, 68, 260, 130];
  for (const width of [220, 390, 600, 760, 1040, 1600]) {
    const layout = masonryLayout(heights, width);
    assert.ok(layout.columns >= 1 && layout.columns <= 3);
    for (const [i, item] of layout.items.entries()) {
      assert.ok(item.x >= 0 && item.x + layout.cardWidth <= width + 0.01);
      for (let j = i + 1; j < heights.length; j += 1) {
        const other = layout.items[j];
        if (item.x === other.x) assert.ok(item.y + heights[i] <= other.y);
      }
    }
    if (width < 576) assert.equal(layout.columns, 1);
  }
  assert.deepEqual(masonryLayout([], 660).items, []);
  assert.equal(masonryLayout([], 660).height, 0);
  assert.equal(masonryLayout([100], 0).height, 0);
});

test('drag ordering is a view projection; new tasks append and source outline is unchanged', () => {
  const original = tasks('a', 'b', 'c');
  const order = moveDeskTask(original, 'a', 'c', true);
  assert.deepEqual(order, ['b', 'c', 'a']);
  assert.deepEqual(orderDeskTasks(original, order).map(({ uid }) => uid), order);
  assert.deepEqual(original, tasks('a', 'b', 'c'));
  assert.deepEqual(orderDeskTasks(tasks('a', 'b', 'c', 'new'), ['c', 'gone', 'c', 'a']).map(({ uid }) => uid), ['c', 'a', 'b', 'new']);
  assert.deepEqual(orderDeskTasks(original, null), original);
  assert.deepEqual(moveDeskTask(original, 'c', 'a', false), ['c', 'a', 'b']);
  assert.deepEqual(moveDeskTask(original, 'a', null, true), ['b', 'c', 'a']);
  assert.deepEqual(moveDeskTask(original, 'missing', 'a', true), ['a', 'b', 'c']);
  assert.deepEqual(moveDeskTask(original, 'a', 'a', false), ['a', 'b', 'c']);
});
