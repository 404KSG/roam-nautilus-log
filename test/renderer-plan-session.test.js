const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function api() {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#renderer-plan-${Date.now()}`);
}

function child(uid, string = uid) {
  return { 'block/uid': uid, 'block/string': string, 'block/order': 0, 'block/refs': [] };
}

function readySnapshot(uid, string) {
  return { 'block/uid': 'plan', 'block/string': 'plan', 'block/children': [child(uid, string)] };
}

function fakeSubscribe(getSnapshot) {
  const subscribe = (uid, listener) => {
    subscribe.calls.push(uid);
    subscribe.listeners.add(listener);
    listener(getSnapshot());
    return () => {
      subscribe.unsubs += 1;
      subscribe.listeners.delete(listener);
    };
  };
  subscribe.calls = [];
  subscribe.unsubs = 0;
  subscribe.listeners = new Set();
  subscribe.emit = (snapshot) => {
    for (const listener of [...subscribe.listeners]) listener(snapshot);
  };
  return subscribe;
}

test('replacing the watch provider while running stays true drops the old subscription', async () => {
  const { createRendererPlanSession } = await api();
  const first = fakeSubscribe(() => readySnapshot('old', 'old-task'));
  const second = fakeSubscribe(() => readySnapshot('new', 'new-task'));
  let subscribe = first;
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe,
      generation: subscribe === first ? 1 : 2,
      graphApi: 'api',
      graphName: 'graph',
    }),
  });
  session.sync();
  assert.equal(session.getState().children[0]['block/uid'], 'old');
  assert.equal(first.calls.length, 1);
  subscribe = second;
  session.sync();
  assert.equal(first.unsubs, 1);
  assert.equal(second.calls.length, 1);
  assert.equal(session.getState().children[0]['block/uid'], 'new');
  first.emit(readySnapshot('poison', 'from-old-provider'));
  assert.equal(session.getState().children[0]['block/uid'], 'new');
  session.destroy();
});

test('an absent watch provider binds once it returns', async () => {
  const { createRendererPlanSession } = await api();
  const present = fakeSubscribe(() => readySnapshot('restored', 'restored-task'));
  let subscribe = null;
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe,
      generation: 1,
      graphApi: 'api',
      graphName: 'graph',
    }),
  });
  session.sync();
  assert.equal(session.getState().status, 'unbound');
  assert.equal(session.getState().writesAllowed, false);
  subscribe = present;
  session.sync();
  assert.equal(session.getState().status, 'ready');
  assert.equal(session.getState().children[0]['block/uid'], 'restored');
  session.destroy();
});

test('a late callback from the previous bind cannot write the new target', async () => {
  const { createRendererPlanSession } = await api();
  let previousListener = null;
  const first = (uid, listener) => {
    previousListener = listener;
    listener(readySnapshot('old'));
    return () => {};
  };
  const second = fakeSubscribe(() => readySnapshot('new'));
  let subscribe = first;
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe,
      generation: subscribe === first ? 1 : 2,
      graphApi: 'api',
      graphName: 'graph',
    }),
  });
  session.sync();
  subscribe = second;
  session.sync();
  previousListener(readySnapshot('poison'));
  assert.equal(session.getState().children[0]['block/uid'], 'new');
  session.destroy();
});

test('a synchronous subscribe callback cannot reenter and double-bind', async () => {
  const { createRendererPlanSession } = await api();
  const subscribe = fakeSubscribe(() => readySnapshot('row'));
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe,
      generation: 4,
      graphApi: 'api',
      graphName: 'graph',
    }),
  });
  session.subscribe(() => {
    session.sync();
  });
  session.sync();
  session.sync();
  assert.equal(subscribe.calls.length, 1);
  assert.equal(session.getState().status, 'ready');
  session.destroy();
});

test('destroy unsubscribes and ignores later callbacks or sync', async () => {
  const { createRendererPlanSession } = await api();
  const subscribe = fakeSubscribe(() => readySnapshot('live'));
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe,
      generation: 1,
      graphApi: 'api',
      graphName: 'graph',
    }),
  });
  session.sync();
  session.destroy();
  assert.equal(subscribe.unsubs, 1);
  subscribe.emit(readySnapshot('after-destroy'));
  session.sync();
  assert.equal(session.getState().children[0]['block/uid'], 'live');
  assert.equal(session.getState().writesAllowed, false);
  assert.equal(subscribe.calls.length, 1);
});

test('graph and plan uid changes drop the previous tree', async () => {
  const { createRendererPlanSession } = await api();
  const graphA = fakeSubscribe(() => readySnapshot('alpha'));
  const graphB = fakeSubscribe(() => readySnapshot('beta'));
  let graphName = 'graph-a';
  let planUid = 'plan-a';
  let subscribe = graphA;
  const session = createRendererPlanSession({
    getPlanUid: () => planUid,
    getProvider: () => ({
      running: true,
      subscribe,
      generation: 1,
      graphApi: graphName,
      graphName,
    }),
  });
  session.sync();
  assert.equal(session.getState().children[0]['block/uid'], 'alpha');
  graphName = 'graph-b';
  subscribe = graphB;
  session.sync();
  assert.equal(session.getState().children[0]['block/uid'], 'beta');
  assert.notEqual(session.getState().children[0]['block/uid'], 'alpha');
  planUid = 'plan-b';
  const other = fakeSubscribe(() => ({
    missing: true,
    'block/uid': '',
    'block/string': '',
    'block/children': [],
  }));
  subscribe = other;
  session.sync();
  assert.equal(session.getState().status, 'missing');
  assert.deepEqual(session.getState().children, []);
  session.destroy();
});

test('unavailable keeps same-target last-good children stale and disables writes', async () => {
  const { createRendererPlanSession } = await api();
  const subscribe = fakeSubscribe(() => readySnapshot('keep', 'keep-me'));
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe,
      generation: 1,
      graphApi: 'api',
      graphName: 'graph',
    }),
  });
  session.sync();
  assert.equal(session.getState().writesAllowed, true);
  subscribe.emit({
    unavailable: true,
    'block/uid': '',
    'block/string': '',
    'block/children': [],
  });
  assert.equal(session.getState().status, 'stale');
  assert.equal(session.getState().stale, true);
  assert.equal(session.getState().writesAllowed, false);
  assert.equal(session.getState().children[0]['block/uid'], 'keep');
  session.destroy();
});

test('confirmed missing clears children instead of keeping every null', async () => {
  const { createRendererPlanSession } = await api();
  const subscribe = fakeSubscribe(() => readySnapshot('gone'));
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe,
      generation: 1,
      graphApi: 'api',
      graphName: 'graph',
    }),
  });
  session.sync();
  subscribe.emit({
    missing: true,
    'block/uid': '',
    'block/string': '',
    'block/children': [],
  });
  assert.equal(session.getState().status, 'missing');
  assert.deepEqual(session.getState().children, []);
  assert.equal(session.getState().writesAllowed, false);
  session.destroy();
});

test('a later ready snapshot restores writes', async () => {
  const { createRendererPlanSession } = await api();
  const subscribe = fakeSubscribe(() => readySnapshot('keep'));
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe,
      generation: 1,
      graphApi: 'api',
      graphName: 'graph',
    }),
  });
  session.sync();
  subscribe.emit({ unavailable: true, 'block/children': [] });
  assert.equal(session.getState().writesAllowed, false);
  subscribe.emit(readySnapshot('keep', 'still-here'));
  assert.equal(session.getState().status, 'ready');
  assert.equal(session.getState().writesAllowed, true);
  session.destroy();
});

test('same-identity sync does not resubscribe or reread', async () => {
  const { createRendererPlanSession } = await api();
  let reads = 0;
  const subscribe = fakeSubscribe(() => {
    reads += 1;
    return readySnapshot('row');
  });
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe,
      generation: 8,
      graphApi: 'api',
      graphName: 'graph',
    }),
  });
  session.sync();
  session.sync();
  session.sync();
  assert.equal(subscribe.calls.length, 1);
  assert.equal(reads, 1);
  session.destroy();
});

test('a real plan-watch bridge replacement does not keep the previous listener', async () => {
  const { createPlanWatchBridge, createRendererPlanSession } = await api();
  const pulls = {
    a: {
      ':block/string': 'plan-a',
      ':block/children': [{
        ':block/uid': 'old',
        ':block/string': 'old-task',
        ':block/order': 0,
        ':block/refs': [],
      }],
    },
  };
  const roamA = {
    data: {
      pull: () => pulls.a,
      addPullWatch: () => {},
      removePullWatch: () => {},
    },
  };
  const roamB = {
    data: {
      pull: () => ({
        ':block/string': 'plan-b',
        ':block/children': [{
          ':block/uid': 'new',
          ':block/string': 'new-task',
          ':block/order': 0,
          ':block/refs': [],
        }],
      }),
      addPullWatch: () => {},
      removePullWatch: () => {},
    },
  };
  const bridgeA = createPlanWatchBridge({ roam: roamA });
  const bridgeB = createPlanWatchBridge({ roam: roamB });
  let subscribe = bridgeA.subscribe;
  let generation = 1;
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe,
      generation,
      graphApi: subscribe,
      graphName: 'graph',
    }),
  });
  session.sync();
  assert.equal(session.getState().children[0]['block/uid'], 'old');
  subscribe = bridgeB.subscribe;
  generation = 2;
  session.sync();
  assert.equal(session.getState().children[0]['block/uid'], 'new');
  pulls.a = {
    ':block/string': 'plan-a',
    ':block/children': [{
      ':block/uid': 'poison',
      ':block/string': 'from-old-bridge',
      ':block/order': 0,
      ':block/refs': [],
    }],
  };
  bridgeA.subscribe('plan', () => {});
  assert.equal(session.getState().children[0]['block/uid'], 'new');
  bridgeA.destroy();
  bridgeB.destroy();
  session.destroy();
});

test('unavailable pull from the real bridge keeps last-good children', async () => {
  const { createPlanWatchBridge, createRendererPlanSession } = await api();
  let current = {
    ':block/string': 'plan',
    ':block/children': [{
      ':block/uid': 'keep',
      ':block/string': 'keep-me',
      ':block/order': 0,
      ':block/refs': [],
    }],
  };
  let watchCallback = null;
  const roam = {
    data: {
      pull: () => {
        if (current === 'throw') throw new Error('graph unavailable');
        return current;
      },
      addPullWatch: (_pattern, _lookup, fn) => { watchCallback = fn; },
      removePullWatch: () => {},
    },
  };
  const bridge = createPlanWatchBridge({ roam });
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe: bridge.subscribe,
      generation: 1,
      graphApi: roam,
      graphName: 'graph',
    }),
  });
  session.sync();
  assert.equal(session.getState().children[0]['block/uid'], 'keep');
  assert.equal(typeof watchCallback, 'function');
  current = 'throw';
  watchCallback();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(session.getState().status, 'stale');
  assert.equal(session.getState().writesAllowed, false);
  assert.equal(session.getState().children[0]['block/uid'], 'keep');
  bridge.destroy();
  session.destroy();
});

function nestedSnapshot(title, nested) {
  return {
    'block/children': [{
      'block/uid': 'task',
      'block/string': title,
      'block/order': 0,
      'block/children': [{
        'block/uid': 'detail',
        'block/string': nested,
        'block/order': 0,
      }],
    }],
  };
}

test('a late callback after the provider disappears cannot restore writes', async () => {
  const { createRendererPlanSession } = await api();
  let callback;
  const graphApi = {};
  let provider = {
    running: true,
    generation: 1,
    graphApi,
    graphName: 'test',
    subscribe(_uid, cb) {
      callback = cb;
      cb(readySnapshot('task'));
      return () => {};
    },
  };
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => provider,
  });
  session.sync();
  provider = {
    running: false,
    generation: 1,
    graphApi,
    graphName: 'test',
    subscribe: null,
  };
  session.sync();
  const before = session.getState();
  assert.equal(before.status, 'stale');
  assert.equal(before.writesAllowed, false);
  callback(readySnapshot('late-old-data'));
  const after = session.getState();
  assert.equal(after.status, 'stale');
  assert.equal(after.writesAllowed, false);
  assert.notEqual(after.children[0]['block/uid'], 'late-old-data');
  session.destroy();
});

test('unsubscribe invalidates the bind generation before a reentrant callback', async () => {
  const { createRendererPlanSession } = await api();
  const first = (_uid, listener) => {
    listener(readySnapshot('old'));
    return () => {
      listener(readySnapshot('from-unsub'));
    };
  };
  let secondListener = null;
  const second = (_uid, listener) => {
    secondListener = listener;
    return () => {};
  };
  let subscribe = first;
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe,
      generation: subscribe === first ? 1 : 2,
      graphApi: 'api',
      graphName: 'graph',
    }),
  });
  session.sync();
  subscribe = second;
  session.sync();
  assert.notEqual(session.getState().children[0]['block/uid'], 'from-unsub');
  secondListener(readySnapshot('new'));
  assert.equal(session.getState().children[0]['block/uid'], 'new');
  session.destroy();
});

test('a provider swap before the next poll cannot apply the old callback', async () => {
  const { createRendererPlanSession } = await api();
  let callback;
  const first = (_uid, listener) => {
    callback = listener;
    listener(readySnapshot('old'));
    return () => {};
  };
  const second = fakeSubscribe(() => readySnapshot('new'));
  let subscribe = first;
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe,
      generation: subscribe === first ? 1 : 2,
      graphApi: 'api',
      graphName: 'graph',
    }),
  });
  session.sync();
  subscribe = second;
  callback(readySnapshot('poison'));
  assert.notEqual(session.getState().children[0]['block/uid'], 'poison');
  assert.equal(session.getState().writesAllowed, false);
  session.sync();
  assert.equal(session.getState().children[0]['block/uid'], 'new');
  assert.equal(session.getState().writesAllowed, true);
  session.destroy();
});

test('graph and uid changes before the next poll drop the previous tree', async () => {
  const { createRendererPlanSession } = await api();
  let callback;
  const subscribe = (_uid, listener) => {
    callback = listener;
    listener(readySnapshot('alpha'));
    return () => {};
  };
  let graphName = 'graph-a';
  let planUid = 'plan-a';
  const session = createRendererPlanSession({
    getPlanUid: () => planUid,
    getProvider: () => ({
      running: true,
      subscribe,
      generation: 1,
      graphApi: graphName,
      graphName,
    }),
  });
  session.sync();
  graphName = 'graph-b';
  callback(readySnapshot('poison-graph'));
  assert.deepEqual(session.getState().children, []);
  assert.equal(session.getState().writesAllowed, false);
  session.sync();
  planUid = 'plan-b';
  callback(readySnapshot('poison-uid'));
  assert.deepEqual(session.getState().children, []);
  assert.equal(session.getState().writesAllowed, false);
  session.destroy();
});

test('nested descendant changes are delivered to subscribers', async () => {
  const { createRendererPlanSession } = await api();
  let callback;
  const events = [];
  const graphApi = {};
  const provider = {
    running: true,
    generation: 1,
    graphApi,
    graphName: 'test',
    subscribe(_uid, cb) {
      callback = cb;
      cb(nestedSnapshot('same title', 'old'));
      return () => {};
    },
  };
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => provider,
  });
  session.subscribe((value) => events.push(JSON.parse(JSON.stringify(value))));
  session.sync();
  const count = events.length;
  callback(nestedSnapshot('same title', 'changed descendant'));
  assert.ok(events.length > count, 'subscribers must receive nested content updates');
  assert.equal(
    events.at(-1).children[0]['block/children'][0]['block/string'],
    'changed descendant',
  );
  assert.equal(
    session.getState().children[0]['block/children'][0]['block/string'],
    'changed descendant',
  );
  session.destroy();
});

test('a real plan-watch refs-only source change reaches renderer consumers', async () => {
  const { createPlanWatchBridge, createRendererPlanSession, resolveRendererTaskInstance } = await api();
  let refString = '{{[[TODO]]}} Source title 15m';
  const callbacks = new Map();
  const roam = {
    data: {
      pull: () => ({
        ':block/string': 'plan',
        ':block/children': [{
          ':block/uid': 'task',
          ':block/string': '((source-task))',
          ':block/order': 0,
          ':block/refs': [{ ':block/uid': 'source-task', ':block/string': refString }],
        }],
      }),
      addPullWatch: async (pattern, entity, fn) => {
        callbacks.set(`${pattern}|${entity}`, fn);
      },
      removePullWatch: async () => undefined,
    },
  };
  const bridge = createPlanWatchBridge({ roam });
  const events = [];
  const session = createRendererPlanSession({
    planUid: 'plan',
    getProvider: () => ({
      running: true,
      subscribe: bridge.subscribe,
      generation: 1,
      graphApi: roam,
      graphName: 'graph',
    }),
  });
  session.subscribe((value) => events.push(JSON.parse(JSON.stringify(value))));
  session.sync();
  await Promise.resolve();
  const delivered = (state) => state.children[0]['block/refs'][0]['block/string'];
  assert.equal(delivered(session.getState()), '{{[[TODO]]}} Source title 15m');
  const count = events.length;
  const sourceWatch = [...callbacks.entries()]
    .find(([key]) => key.endsWith('|[:block/uid "source-task"]'))?.[1];
  assert.equal(typeof sourceWatch, 'function');
  refString = '{{[[DONE]]}} Source title 15m';
  sourceWatch();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(events.length > count, 'refs-only updates must notify subscribers');
  assert.equal(delivered(events.at(-1)), '{{[[DONE]]}} Source title 15m');
  assert.equal(delivered(session.getState()), '{{[[DONE]]}} Source title 15m');
  const child = session.getState().children[0];
  const task = resolveRendererTaskInstance({
    uid: child['block/uid'],
    localString: child['block/string'],
    references: child['block/refs'].map((reference) => ({
      uid: reference['block/uid'],
      string: reference['block/string'],
    })),
    fallbackMinutes: 15,
  }, () => '');
  assert.equal(task.status, 'DONE');
  assert.equal(task.title, 'Source title');
  bridge.destroy();
  session.destroy();
});
