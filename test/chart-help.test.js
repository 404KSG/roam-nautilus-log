const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/log-core');
const help = () => require('../src/chart-help');

// Assert the replacement contract, not just a new icon beside a dormant Eye.
test('Help replaces the completed-visibility control in both languages', () => {
  for (const language of ['en', 'zh']) {
    const copy = core.uiCopy(language).controls;
    assert.ok(copy.help);
    assert.equal(copy.hideDone, undefined);
    assert.equal(copy.showDone, undefined);
    assert.equal(copy.doneScope, undefined);
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/component.cljs'), 'utf8');
  assert.doesNotMatch(source, /show-done-state|show-done-atom\?|switch-done-visibility-button/);
  const controls = source.slice(source.indexOf('(defn log-controls'), source.indexOf('(defn render-context-probe'));
  assert.ok(controls.indexOf('[desk-button') < controls.indexOf('[help-button'));
});

test('Help is English by default and explains the unassigned budget denominator', () => {
  const { chartHelpModel } = help();
  const model = chartHelpModel({ startMinutes: 300, endMinutes: 1260, defaultDuration: 15 });
  assert.equal(model.title, 'Nautilus Log');
  assert.match(model.setup, /05:00.*21:00.*15m/);
  assert.match(model.rows.find(row => row.key === 'left').text, /Available.*Planned/);
  assert.match(model.rows.find(row => row.key === 'left').text, /full-day Available/);
  assert.match(model.rows.find(row => row.key === 'left').text, /fully planned/);
  assert.equal(model.rows.find(row => row.key === 'left').label, 'free');
  assert.match(model.rows.find(row => row.key === 'schedule').text, /default off/);
  assert.match(model.settings, /POMO does not record Actual/);
  assert.match(model.rows.find(row => row.key === 'desk').text, /to the top/);
  assert.deepEqual(core.stableTidyOrder({ items: [{ uid: 'pending' }, { uid: 'done' }], settledUids: ['done'] }).map(row => row.uid), ['done', 'pending']);
  assert.match(model.guideUrl, /^https:\/\/github\.com\/404KSG\/roam-nautilus-log\/blob\/main\/docs\/guide\.md$/);
});

test('Help honors explicit Chinese, logical overnight hours, and zero without inventing values', () => {
  const { chartHelpModel } = help();
  const model = chartHelpModel({ language: 'zh', startMinutes: 1260, endMinutes: 1560, defaultDuration: 0 });
  assert.match(model.setup, /21:00.*次日 02:00.*0m/);
  assert.match(model.rows.find(row => row.key === 'left').text, /全天可安排/);
  assert.equal(model.rows.find(row => row.key === 'left').label, '未分配');
  assert.match(model.guideUrl, /guide\.zh-CN\.md$/);
  const invalid = chartHelpModel({ startMinutes: NaN, endMinutes: Infinity, defaultDuration: NaN });
  assert.doesNotMatch(invalid.setup, /NaN|Infinity|05:00|15m/);
  assert.equal(chartHelpModel({ language: 'unexpected' }).language, 'en');
});

test('Help guide links use only a validated public source revision', () => {
  const { chartHelpModel } = help();
  const revision = 'a'.repeat(40);
  assert.match(chartHelpModel({ revision }).guideUrl, new RegExp(`/blob/${revision}/`));
  assert.match(chartHelpModel({ revision: revision + '-dirty' }).guideUrl, new RegExp(`/blob/${revision}/`));
  assert.match(chartHelpModel({ revision: 'javascript:alert(1)' }).guideUrl, /\/blob\/main\//);
  const before = chartHelpModel(); before.rows[0].text = 'modified';
  assert.notEqual(chartHelpModel().rows[0].text, 'modified');
});

test('Help placement fits the viewport and flips above a low anchor', () => {
  const { helpPopoverPosition } = help();
  for (const [width, height] of [[1200, 900], [390, 640], [280, 260]]) {
    const p = helpPopoverPosition({ anchor: { left: width - 50, right: width - 18, top: 100, bottom: 132 },
      viewportWidth: width, viewportHeight: height, contentHeight: 500 });
    assert.ok(p.left >= 12 && p.left + p.width <= width - 12);
    assert.ok(p.top >= 12 && p.top + Math.min(500, p.maxHeight) <= height - 12);
  }
  const above = helpPopoverPosition({ anchor: { left: 700, right: 732, top: 700, bottom: 732 },
    viewportWidth: 1000, viewportHeight: 800, contentHeight: 300 });
  assert.ok(above.top + 300 < 700);
  assert.equal(helpPopoverPosition({ anchor: {}, viewportWidth: 0, viewportHeight: 0, contentHeight: 400 }), null);
});

test('partly scrolled-off Help anchors still keep the popup inside both viewport gutters', () => {
  const { helpPopoverPosition } = help();
  for (const [top, bottom] of [[-30, 2], [798, 830]]) {
    const p = helpPopoverPosition({ anchor: { left: 700, right: 732, top, bottom },
      viewportWidth: 1000, viewportHeight: 800, contentHeight: 900 });
    assert.ok(p.top >= 12 && p.top + p.maxHeight <= 788, JSON.stringify(p));
  }
});
