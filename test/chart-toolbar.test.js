const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contract = require('../src/renderer-contract');
const component = fs.readFileSync(path.join(__dirname, '../src/component.cljs'), 'utf8');
const section = (start, end) => component.slice(component.indexOf(start), component.indexOf(end));

test('the new view renderer registers an exact source upgrade from the published predecessor', () => {
  const hash = crypto.createHash('sha256').update('```clojure\n ' + component + ' ```').digest('hex');
  assert.equal(contract.REVISION, 3);
  assert.ok(contract.RELEASED_RENDERER_SOURCES.some(source => source.revision === 2 && source.sha256 === '5abc676245d7078959f19e804a65a355c3323d5e9af4fc1c067c70f3c57af81e'));
  assert.ok(contract.RELEASED_RENDERER_SOURCES.some(source => source.revision === contract.REVISION && source.sha256 === hash));
  assert.equal(contract.CODE_UID, 'roam-render-Nautilus-Log-r2-cljs');
});

test('the current renderer has a chart/list switch and no Eye state or completed-record filter', () => {
  assert.doesNotMatch(component, /eye-open|eye-off|collapse-button|collapsed-state|show-done-state|switch-done-visibility-button/);
  const button = section('(defn desk-button', '(defn calendar-result-popover');
  assert.match(button, /:role "switch"/);
  assert.match(button, /nautilus-log-view-label/);
  assert.match(component, /:onViewChange/);
});

test('Help comes first, optional Calendar second and the view switch last', () => {
  const controls = section('(defn log-controls', '(defn render-context-probe');
  const positions = ['help-button', 'calendar-button', 'desk-button'].map(name => controls.indexOf(`[${name}`));
  assert.ok(positions.every((p, i) => p >= 0 && (i === 0 || positions[i - 1] < p)));
  assert.doesNotMatch(controls, /tidy|collapse-button/);
});
