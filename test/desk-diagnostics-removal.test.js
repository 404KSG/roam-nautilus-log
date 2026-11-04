const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const retired = /createDeskDiagnostic|deskDiagnosticCommands|Desk diagnostics|nautilus-desk-diagnostics|临时 Desk 诊断/;

test('temporary Desk debugging has no module, command registration, panel, collector or documentation', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/desk-diagnostics.js')), false);
  for (const file of ['src/index.js', 'src/desk-view.js', 'extension.css', 'docs/guide.md', 'docs/guide.zh-CN.md', 'CHANGELOG.md']) {
    assert.equal(retired.test(read(file)), false, file);
  }
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.ok(!scripts['test:ui'].includes('test/desk-diagnostics.py'));
  assert.ok(!scripts['test:desk'].includes('test/desk-diagnostics.py'));
});

test('compiled Desk retains normal operations without exposing a diagnostic API', async () => {
  const bundle = read('extension.js');
  assert.equal(retired.test(bundle), false, 'retired command or panel in shipped bundle');
  const extension = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#desk-debug-removal`);
  let reads = 0, dom = 0;
  const view = extension.createDeskView({
    host: {}, document: { body: {}, createElement: () => { dom++; } },
    readPlan: () => { reads++; }, watchPlan: () => { reads++; },
  });
  assert.equal(view.diagnostics, undefined);
  for (const key of ['open', 'registerHost', 'closeForHost', 'restoreMountedHosts', 'close', 'destroy']) assert.equal(typeof view[key], 'function', key);
  view.destroy();
  assert.equal(reads, 0); assert.equal(dom, 0);
});

test('required creation-recovery notices and normal Desk shortcuts remain', () => {
  assert.match(read('src/today-plan-view.js'), /export function createPlanDiagnostics/);
  assert.match(read('src/today-plan-launcher.js'), /diagnostics\.show\(\)/);
  assert.match(read('src/timing-topbar.js'), /calendarDiagnostics/);
  assert.match(read('extension.css'), /nautilus-log-timing__plan-diagnostics/);
  assert.match(read('src/desk-view.js'), /const action = deskShortcut\(event\)/);
  assert.match(read('src/desk-view.js'), /nativeEditorOwnsEscape\(event, mount\)/);
});
