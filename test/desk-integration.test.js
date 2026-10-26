const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

async function extension() {
  const bundle = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#desk-integration`);
}

test('compiled Desk is idle before opening and cannot reopen after destroy', async () => {
  const { createDeskView } = await extension();
  let reads = 0;
  let domCreates = 0;
  const view = createDeskView({
    host: {}, document: { body: {}, createElement: () => { domCreates += 1; } },
    readPlan: () => { reads += 1; }, watchPlan: () => { reads += 1; },
  });
  assert.equal(reads, 0);
  assert.equal(domCreates, 0);
  view.open();
  assert.equal(domCreates, 0, 'missing plan UID is not an implicit today-plan lookup');
  view.open({ planUid: 'any-plan' });
  assert.equal(domCreates, 0, 'missing inline host never falls back to a full-page overlay');
  view.destroy();
  view.open({ planUid: 'any-plan' });
  assert.equal(domCreates, 0);
  assert.equal(reads, 0);
});

test('renderer Desk button passes the clicked component and origin, without an execution-layer gate', () => {
  const source = fs.readFileSync(path.join(root, 'src/component.cljs'), 'utf8');
  const button = source.slice(source.indexOf('(defn desk-button'), source.indexOf('(defn tidy-button'));
  assert.match(button, /:planUid block-uid/);
  assert.match(button, /:pageTitle page-title-val/);
  assert.match(button, /:origin \(\.-currentTarget event\)/);
  assert.match(button, /\.-openDesk/);
  assert.match(button, /:container[\s\S]*:scope > \.nautilus-log-desk-host/);
  assert.match(source, /:class "nautilus-log-desk-host"[\s\S]*?:data-nautilus-desk-plan block-uid[\s\S]*?:ref desk-host-ref/);
  assert.match(source, /\.-registerDeskHost/);
  assert.match(source, /desk-host-ref[\s\S]*\.-closeDeskHost/);
  assert.doesNotMatch(button, /actual-time-tracking|createBlock|updateBlock|clock/i);
  const controls = source.slice(source.indexOf('(defn log-controls'), source.indexOf('(defn render-context-probe'));
  assert.match(controls, /\[desk-button block-uid page-title-val \(:controls copy\)\]/);
});

test('extension binds Desk to shared reads and destroys it before destroying the watch bridge', () => {
  const source = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
  const binding = source.match(/deskView = createDeskView\(\{([\s\S]*?)\n  \}\);/)?.[1] || '';
  assert.match(binding, /actions: deskActions/);
  assert.match(binding, /readPlan: planWatchBridge\.read,\s*watchPlan: planWatchBridge\.subscribe,/);
  assert.match(source, /deskView\?\.restoreMountedHosts\(\)/);
  assert.match(source, /openDesk: \(options\) => deskView\?\.open\(options\)/);
  assert.match(source, /closeDeskHost: \(container\) => deskView\?\.closeForHost\(container\)/);
  for (const section of [source.slice(source.indexOf('async function onload'), source.indexOf('function onunload')),
    source.slice(source.indexOf('function onunload'), source.indexOf('\nexport {'))]) {
    assert.ok(section.indexOf('deskView?.destroy()') >= 0);
    assert.ok(section.indexOf('deskView?.destroy()') < section.indexOf('planWatchBridge?.destroy()'));
  }
});
