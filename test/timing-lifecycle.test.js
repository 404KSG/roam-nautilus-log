const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function fixture(t) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#lifecycle-${Math.random()}`);
  const intervals = new Set();
  const listeners = new Set();
  const queries = [];
  global.window = {
    roamAlphaAPI: {graph: {name: 'lifecycle-test'}, q: (query) => { queries.push(query); return []; }},
    setInterval: () => {const id = Symbol(); intervals.add(id); return id;},
    clearInterval: (id) => intervals.delete(id),
    setTimeout,
    clearTimeout,
  };
  global.document = {
    visibilityState: 'visible', querySelector: () => null,
    addEventListener: (_name, fn) => listeners.add(fn),
    removeEventListener: (_name, fn) => listeners.delete(fn),
  };
  const runtime = extension.createTimingRuntime({
    extensionAPI: {settings: {get: (key) => key === 'timing-line-sidebar' ? false : undefined, set: async () => {}}},
    now: () => new Date(2026, 8, 9, 10),
  });
  t.after(() => {runtime.destroy(); delete global.window; delete global.document;});
  return {runtime, intervals, listeners, queries};
}

test('destroying an initializing runtime leaves no timer or visibility listener', async (t) => {
  const {runtime, intervals, listeners} = await fixture(t);
  const pending = runtime.initialize();
  runtime.destroy();
  await assert.rejects(pending, /no longer active/);
  assert.equal(intervals.size, 0);
  assert.equal(listeners.size, 0);
});

test('initialize after destroy cannot read or restart the runtime', async (t) => {
  const {runtime, intervals, listeners, queries} = await fixture(t);
  runtime.destroy();
  await assert.rejects(runtime.initialize(), /no longer active/);
  assert.equal(queries.length, 0);
  assert.equal(intervals.size, 0);
  assert.equal(listeners.size, 0);
});

test('concurrent and repeated initialization shares one active runtime', async (t) => {
  const {runtime, intervals, listeners, queries} = await fixture(t);
  await Promise.all([runtime.initialize(), runtime.initialize()]);
  const queryCount = queries.length;
  await runtime.initialize();
  assert.equal(queries.length, queryCount);
  assert.equal(intervals.size, 1);
  assert.equal(listeners.size, 1);
  runtime.destroy();
  runtime.destroy();
  assert.equal(intervals.size, 0);
  assert.equal(listeners.size, 0);
});

test('a subscriber can destroy the runtime during initial publication', async (t) => {
  const {runtime, intervals, listeners} = await fixture(t);
  runtime.subscribe((state) => {if (state.status === 'ready') runtime.destroy();});
  await assert.rejects(runtime.initialize(), /no longer active/);
  assert.equal(intervals.size, 0);
  assert.equal(listeners.size, 0);
});
