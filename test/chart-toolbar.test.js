const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const icons = require('./fixtures/blueprint-toolbar-icons.json');
const component = fs.readFileSync(path.join(__dirname, '../src/component.cljs'), 'utf8');
const section = (start, end) => component.slice(component.indexOf(start), component.indexOf(end));

test('toolbar uses the exact official Blueprint Clean and Eye glyph geometry', () => {
  const renderer = section('(defn blueprint-toolbar-icon', '(defn tidy-button');
  assert.match(renderer, /:width "18" :height "18" :viewBox "0 0 20 20"/);
  assert.match(renderer, /:fill "currentColor" :stroke "none"/);
  assert.match(renderer, /:fill-rule "evenodd"/);
  for (const [name, geometry] of Object.entries(icons.icons)) {
    assert.ok(renderer.includes(JSON.stringify(name)) && renderer.includes(JSON.stringify(geometry)), name);
  }
  const tidy = section('(defn tidy-button', '(defn calendar-result-popover');
  assert.match(tidy, /\[blueprint-toolbar-icon "clean"\]/);
  assert.doesNotMatch(tidy, /translate\(1 1\)|m16 22-1-4/);
});

test('Eye is the whole-widget disclosure action, never a completed-record filter', () => {
  const collapse = section('(defn collapse-button', '(defn switch-debug-button');
  assert.match(collapse, /:aria-expanded \(not @collapsed-state\)/);
  assert.match(collapse, /\[blueprint-toolbar-icon \(if @collapsed-state "eye-open" "eye-off"\)\]/);
  assert.match(collapse, /write-collapsed-state block-uid render-context next/);
  assert.doesNotMatch(component, /show-done-state|switch-done-visibility-button|"eye-on"/);
});

test('four main controls keep exact priority even when optional Calendar is present', () => {
  const controls = section('(defn log-controls', '(defn render-context-probe');
  const positions = ['desk-button', 'help-button', 'tidy-button', 'collapse-button', 'calendar-button']
    .map(name => controls.indexOf(`[${name}`));
  assert.ok(positions.every((p, i) => p >= 0 && (i === 0 || positions[i - 1] < p)), positions.join(','));
});
