const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const icons = require('./fixtures/blueprint-toolbar-icons.json');
const component = fs.readFileSync(path.join(__dirname, '../src/component.cljs'), 'utf8');
const section = (start, end) => component.slice(component.indexOf(start), component.indexOf(end));

test('native toolbar preserves the published r2 source and original Blueprint glyphs', () => {
  assert.equal(crypto.createHash('sha256').update(component).digest('hex'),
    '2351148d35786212b68e285c4afc173325c0104a710150b1a7cbcdc7315dfe86',
    'paint changes must not silently rewrite the published renderer');
  const renderer = section('(defn blueprint-toolbar-icon', '(defn plan-writes-allowed?');
  assert.match(renderer, /:width "18" :height "18" :viewBox "0 0 20 20"/);
  assert.match(renderer, /:fill "currentColor" :stroke "none"/);
  assert.match(renderer, /:fill-rule "evenodd"/);
  assert.deepEqual(Object.keys(icons.icons).sort(), ['eye-off', 'eye-open']);
  for (const [name, geometry] of Object.entries(icons.icons)) {
    assert.ok(renderer.includes(JSON.stringify(name)) && renderer.includes(JSON.stringify(geometry)), name);
  }
});

test('Eye is the whole-widget disclosure action, never a completed-record filter', () => {
  const collapse = section('(defn collapse-button', '(defn switch-debug-button');
  assert.match(collapse, /:aria-expanded \(not @collapsed-state\)/);
  assert.match(collapse, /\[blueprint-toolbar-icon \(if @collapsed-state "eye-open" "eye-off"\)\]/);
  assert.match(collapse, /write-collapsed-state block-uid render-context next/);
  assert.doesNotMatch(component, /show-done-state|switch-done-visibility-button|"eye-on"/);
});

test('three main controls keep exact priority before optional Calendar', () => {
  const controls = section('(defn log-controls', '(defn render-context-probe');
  const positions = ['desk-button', 'help-button', 'collapse-button', 'calendar-button']
    .map(name => controls.indexOf(`[${name}`));
  assert.ok(positions.every((p, i) => p >= 0 && (i === 0 || positions[i - 1] < p)), positions.join(','));
  assert.doesNotMatch(controls, /tidy|settled-uids|crystal-ball/);
});
