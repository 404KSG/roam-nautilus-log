const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const component = fs.readFileSync(path.join(__dirname, '..', 'src', 'component.cljs'), 'utf8');
const entry = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
const helpers = fs.readFileSync(path.join(__dirname, '..', 'src', 'entry-helpers.js'), 'utf8');

test('the Roam renderer delegates schedule and capacity behavior to the tested Flow core', () => {
  assert.match(component, /flow-core-call "scheduleTasks"/);
  assert.match(component, /flow-core-call "calculateCapacity"/);
  assert.match(component, /flow-core-call "historicalDoneSlice"/);
  assert.match(component, /flow-core-call "truncateTextToWidth"/);
  assert.match(entry, /window\.nautilusFlowCore = flowCore/);
  assert.doesNotMatch(component, /\(abs \(- done-at duration\)\)/);
});
test('Flow scaffolding is isolated and unload is graph-safe', () => {
  assert.match(entry, /Nautilus Flow/);
  assert.match(entry, /roam-render-Nautilus-Flow-cljs/);
  assert.match(entry, /workday-end/);
  assert.match(helpers, /state !== true/);
  assert.doesNotMatch(helpers, /replaceRenderString\(/);
  assert.doesNotMatch(helpers, /deleteBlock\(/);
});
