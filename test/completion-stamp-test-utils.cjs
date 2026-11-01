const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let loaded;
const extension = () => loaded ||= import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, '../extension.js')).toString('base64')}#completion-stamp-tests`);
const hash = async text => crypto.createHash('sha256').update(text).digest('hex');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

async function fixture(t, options = {}) {
  const api = await extension();
  const values = new Map([['completion-stamps-enabled', options.enabled !== false]]);
  const blocks = new Map([['task00001', '{{[[TODO]]}} Task 30m']]);
  const updates = [], saves = [], notices = [], lockCalls = [];
  let state = { provider: {}, graph: 'stamp-graph', graphType: 'hosted', userUid: 'fixture-user' };
  let destroyed = false, tail = Promise.resolve();
  const context = () => ({ ...state });
  const host = { crypto: crypto.webcrypto, setTimeout, clearTimeout, roamAlphaAPI: state.provider };
  const guard = {
    assertActive() { if (destroyed) throw Error('guard disposed'); },
    run(operation, { signal } = {}) {
      lockCalls.push('clock');
      const result = tail.then(async () => {
        if (options.lock) await options.lock.promise;
        if (signal?.aborted || destroyed) throw Error('cancelled lock');
        return operation();
      });
      tail = result.catch(() => {}); return result;
    },
    destroy() { destroyed = true; },
  };
  const settings = {
    get(key) { return values.get(key); },
    async set(key, value) {
      saves.push({ key, value: JSON.parse(JSON.stringify(value)) });
      if (options.persist) await options.persist(key, value);
      else values.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
  const writer = api.createCompletionStampWriter({ extensionAPI: { settings }, host, guard, getContext: context,
    hash: options.hash || hash, writeTimeoutMs: options.writeTimeoutMs || 50,
    readBlock(uid) { if (options.read) return options.read(uid, blocks); return blocks.get(uid) ?? null; },
    async updateBlock(uid, string) {
      updates.push({ uid, string });
      if (options.update) await options.update(uid, string, blocks);
      else blocks.set(uid, string);
    },
    notify: message => notices.push(message),
  });
  t.after(() => writer.destroy());
  const instant = new Date(2026, 10, 1, 10, 31);
  const complete = (extra = {}) => writer.finishDirect({ uid: 'task00001', instant, ...extra });
  const native = (extra = {}) => {
    const uid = extra.uid || 'task00001', before = blocks.get(uid);
    blocks.set(uid, before.replace('{{[[TODO]]}}', '{{[[DONE]]}}'));
    return writer.stampNative({ uid, before, instant, ...extra });
  };
  const reopen = () => {
    const before = blocks.get('task00001');
    blocks.set('task00001', before.replace('{{[[DONE]]}}', '{{[[TODO]]}}'));
    return writer.stampNative({ uid: 'task00001', before, instant });
  };
  return { api, writer, values, blocks, updates, saves, notices, lockCalls, settings, host, context,
    changeContext(change) { state = { ...state, ...change }; host.roamAlphaAPI = state.provider; },
    complete, native, reopen, instant, guard };
}
module.exports = { extension, fixture, hash, deferred, flush };
