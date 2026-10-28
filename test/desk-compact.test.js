const test = require('node:test');
const assert = require('node:assert/strict');
const { readDeskPreview } = require('../src/desk-core');

test('compact panel budget halves the rendered/read/watch work on a long plain log, without losing direct search content', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ uid: `log-${i}`, string: `Log entry ${i}`, order: i, open: true }));
  function sample(limit) {
    const reads = [];
    const model = readDeskPreview('root', uid => { reads.push(uid); return uid === 'root' ? rows : []; }, limit);
    return { model, reads };
  }
  const compact = sample(5), route = sample(11);
  assert.equal(compact.model.rows.length, 5); assert.equal(route.model.rows.length, 11);
  assert.equal(compact.reads.length, 6); assert.equal(route.reads.length, 12);
  assert.equal(compact.model.watchTargets.length, 6); assert.equal(route.model.watchTargets.length, 12);
  assert.equal(compact.model.more, true);
  assert.match(compact.model.searchText, /Log entry 19/);
  assert.ok(rows.every(row => row.open === true));
});
