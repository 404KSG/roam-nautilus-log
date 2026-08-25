const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadExtension(label) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${label}-${Date.now()}`);
}

test('shared Plan Pull Watch publishes moved daily wrappers immediately and cleans up once', async () => {
  const extension = await loadExtension('plan-watch');
  const calls = { add: [], remove: [], pull: 0 };
  let watchedCallback = null;
  let current = {
    ':block/string': '[[Nautilus Log]] renderer',
    ':block/children': [
      {
        ':block/uid': 'bare-reference',
        ':block/string': '((source-task))',
        ':block/order': 0,
        ':block/refs': [{ ':block/uid': 'source-task', ':block/string': '{{[[DONE]]}} Reusable 15m d09:11' }],
      },
    ],
  };
  const roam = {
    data: {
      pull: () => {
        calls.pull += 1;
        return current;
      },
      addPullWatch: async (...args) => {
        calls.add.push(args);
        watchedCallback = args[2];
      },
      removePullWatch: async (...args) => calls.remove.push(args),
    },
  };
  const bridge = extension.createPlanWatchBridge({ roam });
  const first = [];
  const second = [];
  const stopFirst = bridge.subscribe('plan', (snapshot) => first.push(snapshot));
  const stopSecond = bridge.subscribe('plan', (snapshot) => second.push(snapshot));

  assert.equal(calls.add.length, 1);
  assert.equal(bridge.getWatchCount(), 1);
  assert.equal(first[0]['block/children'][0]['block/string'], '((source-task))');
  assert.equal(second[0]['block/children'][0]['block/refs'][0]['block/string'], '{{[[DONE]]}} Reusable 15m d09:11');

  current = {
    ...current,
    ':block/children': [
      {
        ':block/uid': 'daily-wrapper',
        ':block/string': '{{[[TODO]]}} ((source-task))',
        ':block/order': 0,
        ':block/refs': [{ ':block/uid': 'source-task', ':block/string': '{{[[DONE]]}} Reusable 15m d09:11' }],
      },
    ],
  };
  watchedCallback(null, current);

  assert.equal(first.at(-1)['block/children'][0]['block/string'], '{{[[TODO]]}} ((source-task))');
  assert.equal(second.at(-1)['block/children'][0]['block/uid'], 'daily-wrapper');

  stopFirst();
  assert.equal(calls.remove.length, 0);
  stopSecond();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.remove.length, 1);
  assert.equal(bridge.getWatchCount(), 0);
  bridge.destroy();
});

