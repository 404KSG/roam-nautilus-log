const test = require('node:test');
const assert = require('node:assert/strict');

let loaded;
const capabilities = () => loaded ||= import(`data:text/javascript;base64,${Buffer.from(require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/desk-capabilities.js'))).toString('base64')}#desk-capabilities`);

test('capability hints preserve legacy create and move but require modern import and removal APIs', async () => {
  const { readDeskCapabilities } = await capabilities();
  const legacy = readDeskCapabilities({ createBlock() {}, moveBlock() {}, deleteBlock() {}, data: {} });
  assert.deepEqual(legacy, { create: true, move: true, delete: false, import: false });
  const modern = readDeskCapabilities({ data: { pull() {}, block: { create() {}, move() {}, delete() {} } } });
  assert.deepEqual(modern, { create: true, move: true, delete: true, import: true });
});

test('capability hints fail closed for missing mutations without treating reads as writes', async () => {
  const { readDeskCapabilities } = await capabilities();
  assert.deepEqual(readDeskCapabilities({ data: { pull() {}, block: {} } }), {
    create: false, move: false, delete: false, import: false,
  });
});
