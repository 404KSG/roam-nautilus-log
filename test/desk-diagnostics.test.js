const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeskDiagnostics, createDeskDiagnosticCommands, COMMANDS } = require('../src/desk-diagnostics');

function fixture() {
  let reads = 0, tick = 0, frameId = 0;
  const frames = new Map(), observers = [];
  const document = { body: {}, documentElement: { clientWidth: 1000, scrollWidth: 1000 },
    querySelectorAll: () => { reads++; return []; } };
  const host = {
    innerWidth: 1000, innerHeight: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0,
    performance: { now: () => ++tick },
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target, options) { this.target = target; this.options = options; }
      disconnect() { this.disconnected = true; }
    },
  };
  for (const key of ['localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'WebSocket', 'roamAlphaAPI', 'location', 'navigator']) {
    Object.defineProperty(host, key, { get() { throw new Error(`Forbidden host access: ${key}`); } });
  }
  document.addEventListener = () => { throw new Error('No global event/input listeners allowed'); };
  return { host, document, frames, observers, reads: () => reads,
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); } };
}

test('diagnostics default off and do no observation or layout work until explicitly started', () => {
  const f = fixture(), d = createDeskDiagnostics(f);
  assert.equal(d.isEnabled(), false);
  assert.equal(d.capture('manual'), false);
  d.afterLayout('after-open');
  assert.equal(f.reads(), 0); assert.equal(f.observers.length, 0); assert.equal(f.frames.size, 0);
  assert.deepEqual(d.report().events, []);
  d.destroy();
  assert.equal(d.start(), false); assert.equal(f.reads(), 0);
});

test('recording is bounded, reason/metadata/revision allowlisted, and reports cannot mutate stored data', () => {
  const f = fixture(), d = createDeskDiagnostics({ ...f, revision: 'PRIVATE_SECRET' });
  d.start();
  d.capture('PRIVATE_SECRET', { key: 'PRIVATE_KEY' });
  let r = d.report();
  assert.equal(r.revision, 'unknown'); assert.equal(r.events.at(-1).reason, 'other');
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  d.capture('shortcut-back', false);
  assert.equal(d.report().events.at(-1).trustedAction, false);
  for (let i = 0; i < 100; i++) d.capture('manual');
  r = d.report();
  assert.equal(r.events.length, 40); assert.equal(r.dropped, 63);
  r.events[0].reason = 'MUTATED';
  assert.notEqual(d.report().events[0].reason, 'MUTATED');
  assert.deepEqual(f.observers[0].options, { childList: true });
});

test('stop/restart/destroy clear records and reject late frames and observer callbacks', () => {
  const f = fixture(), d = createDeskDiagnostics(f);
  d.start(); d.afterLayout('after-open');
  const oldFrame = [...f.frames.values()][0], oldObserver = f.observers[0];
  d.stop();
  assert.equal(f.frames.size, 0); assert.equal(oldObserver.disconnected, true);
  assert.deepEqual(d.report().events, []);
  d.start(); const before = d.report();
  oldFrame(); oldObserver.callback([{ removedNodes: [{ classList: { contains: () => true } }] }]);
  assert.deepEqual(d.report(), before);
  d.afterLayout('after-open'); f.flush(); f.flush();
  assert.equal(d.report().events.at(-1).reason, 'after-open');
  f.observers.at(-1).callback([{ removedNodes: [{ classList: { contains: name => name === 'nautilus-desk__focus-layer' } }] }]);
  assert.equal(d.report().events.at(-1).reason, 'focus-layer-detached');
  d.destroy(); assert.equal(d.isEnabled(), false); assert.deepEqual(d.report().events, []);
});

test('layout captures scalar geometry only, never DOM text, values, identifiers, or style strings', () => {
  const f = fixture();
  const node = () => {
    const el = { parentElement: null, nextElementSibling: null, children: [], hidden: false,
      clientWidth: 80, scrollWidth: 90, clientHeight: 40, scrollHeight: 50, offsetWidth: 84, offsetHeight: 44,
      scrollLeft: 0, scrollTop: 0, style: { width: 'PRIVATE_SECRET', marginLeft: 'PRIVATE_SECRET' },
      matches: () => false, closest: () => null, querySelector: () => null,
      classList: { contains: () => false },
      getClientRects: () => [{}], getBoundingClientRect: () => ({ x: 1, y: 2, left: 1, top: 2, width: 80, height: 40, right: 81, bottom: 42 }),
    };
    for (const key of ['textContent', 'innerText', 'innerHTML', 'value', 'id', 'dataset', 'href']) {
      Object.defineProperty(el, key, { get() { throw new Error(`Forbidden DOM read: ${key}`); } });
    }
    return el;
  };
  const container = node(), chart = node(), root = node(), grid = node(), card = node(), owner = node(), next = node();
  container.closest = selector => selector === '.nautilus-log-container' ? chart : selector === '.roam-block-container' ? owner : null;
  container.querySelector = () => root; root.querySelector = () => grid;
  grid.children = [card]; owner.nextElementSibling = next; next.matches = () => true;
  f.document.querySelectorAll = selector => selector === '.nautilus-log-desk-host' ? [container] : [];
  f.host.getComputedStyle = () => ({ display: 'block', position: 'PRIVATE_SECRET', height: '40px', minHeight: 'auto',
    borderLeftWidth: '1px', borderRightWidth: '1px', borderTopWidth: '1px', borderBottomWidth: '1px', paddingLeft: '2px' });
  const d = createDeskDiagnostics({ ...f, revision: 'a'.repeat(40) }); d.start();
  const report = d.report(), surface = report.events[0].layout.surfaces[0];
  assert.equal(report.revision, 'a'.repeat(40));
  assert.equal(surface.host.scrollbarY, 2); assert.equal(surface.host.inlineWidth, true);
  assert.equal(surface.cardCount, 1); assert.equal(surface.followingGap, -40);
  assert.equal(surface.host.position, null);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_SECRET'));
});

test('measurement errors do not escape or leak exception messages', () => {
  const f = fixture(); f.document.querySelectorAll = () => { throw new Error('PRIVATE_SECRET'); };
  const d = createDeskDiagnostics(f);
  assert.doesNotThrow(() => d.start());
  assert.equal(d.report().events[0].measurementUnavailable, true);
  assert.ok(!JSON.stringify(d.report()).includes('PRIVATE_SECRET'));
});

test('diagnostic commands are explicit, removable and inert after command teardown', () => {
  const registered = new Map(), f = fixture(), d = createDeskDiagnostics(f);
  const extensionAPI = { ui: { commandPalette: {
    addCommand: c => registered.set(c.label, c.callback), removeCommand: ({ label }) => registered.delete(label),
  } } };
  const commands = createDeskDiagnosticCommands({ extensionAPI, diagnostics: d });
  assert.equal(commands.initialize(), true); assert.equal(registered.size, 3); assert.equal(d.isEnabled(), false);
  registered.get(COMMANDS.start)(); assert.equal(d.isEnabled(), true);
  registered.get(COMMANDS.stop)(); assert.equal(d.isEnabled(), false); assert.deepEqual(d.report().events, []);
  const late = registered.get(COMMANDS.start);
  commands.destroy(); late();
  assert.equal(registered.size, 0); assert.equal(d.isEnabled(), false);
});

test('partial command registration rolls back without enabling diagnostics', () => {
  const registered = new Map(), f = fixture(), d = createDeskDiagnostics(f);
  const commands = createDeskDiagnosticCommands({ diagnostics: d, extensionAPI: { ui: { commandPalette: {
    addCommand(c) { registered.set(c.label, c.callback); if (registered.size === 2) throw new Error('host failure'); },
    removeCommand: ({ label }) => registered.delete(label),
  } } } });
  assert.equal(commands.initialize(), false); assert.equal(registered.size, 0); assert.equal(d.isEnabled(), false);
});
