const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Guard against leaving a hidden command/API or restoring the retired control.
test('retired outline control has no production module, bridge, command, glyph or copy', () => {
  for (const file of ['src/tidy-plan.js', 'src/tidy-commands.js']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
  for (const file of ['src/index.js', 'src/component.cljs', 'src/log-core.js', 'src/chart-help.js', 'src/timing-roam.js', 'extension.css']) {
    assert.equal(/tidy|crystal-ball|stableTidyOrder|childOrderMoves|showActionToast|updateGraphBlockOpen|nautilus-log-toast-action/i.test(read(file)), false, file);
  }
});

test('compiled bundle cannot expose the removed factories or command, but retains Desk and Calendar', async () => {
  const bundle = read('extension.js');
  assert.equal(/createPlanTidy|createTidyCommands|settledUidsForTidy|tidyPlan|Tidy Primary Plan|crystal-ball/.test(bundle), false, 'retired API in compiled bundle');
  const extension = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#removed-outline-control`);
  for (const name of ['createPlanTidy', 'createTidyCommands', 'settledUidsForTidy']) assert.equal(extension[name], undefined);
  for (const name of ['createDeskActions', 'createCalendarReconciler', 'createTimingRuntime', 'createCompletionStampWriter']) assert.equal(typeof extension[name], 'function', name);
});

test('current guides and Help no longer advertise the removed action', () => {
  for (const file of ['README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'docs/guide.md', 'docs/guide.zh-CN.md', 'docs/google-calendar-sync.md']) {
    assert.equal(/\btidy\b|crystal-ball|brush-cleaning|Desk\s*[/／]\s*整理|整理已完成任务/i.test(read(file)), false, file);
  }
  assert.equal(fs.existsSync(path.join(root, 'docs/plans/2026-08-26-tidy-settled-outline-design.md')), false);
});
