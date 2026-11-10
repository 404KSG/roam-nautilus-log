const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/deferred-cleanup.js');
function clock() {
  let id = 0, time = 0;
  const frames = new Map(), timers = new Map();
  return {
    host: { performance: { now: () => time }, requestAnimationFrame: cb => (frames.set(++id, cb), id), cancelAnimationFrame: key => frames.delete(key),
      setTimeout: (cb, delay) => (timers.set(++id, { cb, delay }), id), clearTimeout: key => timers.delete(key) },
    frame() { const batch = [...frames.values()]; frames.clear(); batch.forEach(cb => cb()); },
    task() { const next = [...timers].sort((a,b) => a[1].delay-b[1].delay)[0]; assert.ok(next); timers.delete(next[0]); next[1].cb(); },
    spend(ms) { time += ms; }, pending() { return frames.size + timers.size; },
  };
}

test('hidden UI cleanup leaves a paint opportunity and yields between bounded batches', async () => {
  const { createDeferredCleanup } = await load(), c = clock(), queue = createDeferredCleanup(c.host), done = [];
  const jobs = Array.from({ length: 7 }, (_, i) => queue.run(() => { done.push(i); c.spend(2); }));
  assert.deepEqual(done, []); c.frame(); assert.deepEqual(done, []);
  c.frame(); assert.deepEqual(done, []);
  c.task(); assert.deepEqual(done, [0,1]);
  while (c.pending()) c.task();
  await Promise.all(jobs); assert.deepEqual(done, [0,1,2,3,4,5,6]);
  queue.destroy(); assert.equal(c.pending(),0);
});

test('destroy flushes owned cleanup and permits delayed native registration to retire', async () => {
  const { createDeferredCleanup } = await load(), c = clock(), queue = createDeferredCleanup(c.host), done = [];
  const first = queue.run(() => done.push('registered'));
  queue.destroy(); assert.deepEqual(done,['registered']); assert.equal(c.pending(),0);
  await first; await queue.run(() => done.push('late-registration'));
  assert.deepEqual(done,['registered','late-registration']); assert.equal(c.pending(),0);
});

test('background fallback releases resources even if animation frames never run', async () => {
  const { createDeferredCleanup } = await load(), c = clock(), queue = createDeferredCleanup(c.host);
  let calls=0; const job=queue.run(() => calls++);
  c.task(); await job; assert.equal(calls,1); assert.equal(c.pending(),0);
});

test('an asynchronous native cleanup retains its result without blocking other retirements', async () => {
  const { createDeferredCleanup } = await load(), c = clock(), queue = createDeferredCleanup(c.host);
  let release, other=false;
  const native=queue.run(() => new Promise(resolve => { release=resolve; }));
  const second=queue.run(() => { other=true; });
  c.frame();c.frame();c.task(); await second; assert.equal(other,true);
  release('unmounted');assert.equal(await native,'unmounted');queue.destroy();
});
