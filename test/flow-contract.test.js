const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const component = fs.readFileSync(path.join(__dirname, '..', 'src', 'component.cljs'), 'utf8');
const entry = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
const helpers = fs.readFileSync(path.join(__dirname, '..', 'src', 'entry-helpers.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'extension.css'), 'utf8');

test('the Roam renderer delegates schedule and capacity behavior to the tested Flow core', () => {
  assert.match(component, /flow-core-call "scheduleTasks"/);
  assert.match(component, /flow-core-call "calculateCapacity"/);
  assert.match(component, /flow-core-call "historicalDoneSlice"/);
  assert.match(component, /flow-core-call "truncateTextToWidth"/);
  assert.match(component, /flow-core-call "resolveRendererSettings"/);
  assert.match(component, /flow-core-call "hourlyGridSegments"/);
  assert.match(component, /flow-core-call "uiCopy"/);
  assert.match(component, /flow-core-call "capacityMetrics"/);
  assert.match(component, /nautilus-flow:settings-changed/);
  assert.match(component, /\.addEventListener/);
  assert.match(component, /\.removeEventListener/);
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

test('Flow owns the previously tested controls and collapses without reserving chart space', () => {
  assert.match(component, /M3 9h18/);
  assert.match(component, /m9 13 3 3 3-3/);
  assert.doesNotMatch(component, /"▸" "▾"/);
  assert.match(css, /\.nautilus-flow-collapsed\s*\{[^}]*height:\s*0;/s);
  assert.match(css, /\.nautilus-flow-collapsed \.nautilus-flow-controls-top\s*\{[^}]*top:\s*-26px;/s);
  assert.doesNotMatch(css, /#roam-right-sidebar-content \.nautilus-flow-container/);
});

test('Flow uses a flat Linear-style header with left-aligned metrics and legend', () => {
  assert.match(component, /nautilus-flow-header/);
  assert.match(component, /nautilus-flow-metrics/);
  assert.match(component, /nautilus-flow-html-legend/);
  assert.doesNotMatch(component, /\[flow-legend-component/);
  assert.doesNotMatch(css, /filter:\s*drop-shadow\(0 4px 12px/);
  assert.doesNotMatch(css, /border:\s*1px dashed/);
});
