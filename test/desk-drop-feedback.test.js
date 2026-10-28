const test = require('node:test');
const assert = require('node:assert/strict');
const { dropSide, insertionPosition } = require('../src/desk-drop-feedback');

test('native horizontal half split mirrors in RTL, independently of Y', () => {
  const rect = { left: 100, width: 200 };
  assert.equal(dropSide(100, rect), 'before');
  assert.equal(dropSide(199, rect), 'before');
  assert.equal(dropSide(200, rect), 'after');
  assert.equal(dropSide(299, rect), 'after');
  assert.equal(dropSide(100, rect, true), 'after');
  assert.equal(dropSide(200, rect, true), 'before');
});

test('native insertion number accounts for removing an existing item, including index zero', () => {
  for (let length = 1; length <= 12; length++) {
    for (const source of [null, ...Array.from({ length }, (_, i) => i)]) {
      for (let slot = 0; slot <= length; slot++) {
        const values = Array.from({ length }, (_, i) => i);
        // Mark the gap first, then remove the source; the marker's final
        // 1-based position is the label, not the original gap's position.
        values.splice(slot, 0, 'gap');
        const expected = values.filter(value => source === null || value !== source).indexOf('gap') + 1;
        assert.equal(insertionPosition(source, slot), expected, `${source}/${slot}/${length}`);
      }
    }
  }
});
