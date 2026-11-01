const test = require('node:test');
const assert = require('node:assert/strict');
const taskCore = require('../src/timing-core');
const logCore = require('../src/log-core');

const SOURCE = '{{[[DONE]]}} Completed reference d23:54';
const resolve = (localString = '((source-task))', extra = {}) => taskCore.resolveTaskInstance({
  uid: 'local-wrapper', localString, readString: uid => uid === 'source-task' ? SOURCE : '',
  fallbackMinutes: 15, includeCompletionEvidence: true, ...extra,
});

test('pure-reference chart evidence retains the source completion stamp without changing local identity or text', () => {
  const task = resolve();
  assert.equal(task.status, 'DONE');
  assert.equal(task.statusOwnerUid, 'source-task');
  assert.equal(task.uid, 'local-wrapper');
  assert.equal(task.doneAt, null, 'the execution/local task contract must not borrow a source timestamp');
  assert.doesNotMatch(task.effectiveString, /d23:54/);
  assert.deepEqual(task.completionEvidence, {
    localMinutes: null,
    reference: { sourceUid: 'source-task', sourceString: SOURCE, minutes: 1434 },
  });
});

test('duration-suffixed and project-page references use the visible source clock as this plan\'s estimate endpoint', () => {
  const olderDaily = '{{[[DONE]]}} Older task d10:31';
  const projectTask = '{{[[DONE]]}} Project task 15m d10:32';
  const sourceStrings = new Map([['older-source', olderDaily], ['project-source', projectTask]]);
  const readString = uid => sourceStrings.get(uid) || '';
  const older = taskCore.resolveTaskInstance({
    uid: 'wrapper-one', localString: '((older-source)) 30m', readString,
    fallbackMinutes: 15, includeCompletionEvidence: true,
  });
  const project = taskCore.resolveTaskInstance({
    uid: 'wrapper-two', localString: '((project-source))', readString,
    fallbackMinutes: 15, includeCompletionEvidence: true,
  });
  assert.equal(older.completionEvidence.reference.minutes, 631);
  assert.equal(project.completionEvidence.reference.minutes, 632);
  assert.deepEqual(logCore.historicalDoneSlice({ done: true, doneAt: older.completionEvidence.reference.minutes, duration: older.plannedMinutes }), { start: 601, end: 631, duration: 30 });
  assert.deepEqual(logCore.historicalDoneSlice({ done: true, doneAt: project.completionEvidence.reference.minutes, duration: project.plannedMinutes }), { start: 617, end: 632, duration: 15 });
});

test('reference completion stamps use the plan clock without deriving a completion date from storage', () => {
  const input = { sourceUid: 'source-task', sourceMinutes: 1434, sourcePageUid: '10-31-2026', displayDate: 'October 31st, 2026', logicalEndMinutes: 1200 };
  assert.deepEqual(logCore.resolveReferenceCompletionTime(input), {
    state: 'resolved', sourceUid: 'source-task', sourceMinutes: 1434, minutes: 1434, placement: 'plan-clock',
  });
  for (const sourcePageUid of ['project-page', '', '02-30-2026', '10-30-2026']) {
    const r = logCore.resolveReferenceCompletionTime({ ...input, sourcePageUid, editTime: Date.now(), createdAt: Date.now() });
    assert.equal(r.state, 'resolved');
    assert.equal(r.minutes, 1434);
    assert.equal(r.sourceDate, undefined);
  }
  const overnight = logCore.resolveReferenceCompletionTime({ ...input, sourcePageUid: '11-01-2026', sourceMinutes: 75, logicalEndMinutes: 1560 });
  assert.equal(overnight.state, 'resolved');
  assert.equal(overnight.minutes, 75, 'dateless midnight stays on the ordinary 0–1439 plan clock');
  assert.equal(logCore.resolveReferenceCompletionTime({ ...input, sourcePageUid: '11-01-2026', sourceMinutes: 180, logicalEndMinutes: 1560 }).minutes, 180);
  assert.equal(logCore.resolveReferenceCompletionTime({ ...input, displayDate: 'Project plan' }).minutes, 1434);
  assert.equal(logCore.resolveReferenceCompletionTime({ ...input, sourceMinutes: null }).state, 'unverified');
});

test('unusable completion evidence retains its label without filling an invented morning slot', () => {
  const item = Object.freeze({ uid: 'local-wrapper', description: 'Time needs confirmation', todo: true, done: true,
    duration: 15, 'completion-time-unverified': true, start: 510, end: 525, 'estimated-allocation': true });
  const projected = logCore.projectCompletedEstimates({ items: [item], startMinutes: 360, endMinutes: 1200 });
  assert.equal(projected.items[0].start, undefined);
  assert.equal(projected.items[0].end, undefined);
  assert.deepEqual(projected.estimatedUids, []);
  const r = logCore.chartScene({ items: [item], events: [item], startMinutes: 360, endMinutes: 1200 }).records[0];
  assert.equal(r.kind, 'unverified-completion');
  assert.equal(r.event['time-claim'], 'none');
  assert.equal(r.anchor, undefined);
  assert.equal(r.boundaryAnchor, undefined);
  assert.equal(r.markerPath, undefined);
  assert.equal(r.label.connector, '');
  assert.deepEqual([item.start,item.end], [510,525], 'display qualification never mutates source data');
  const companion = { uid: 'other-done', description: 'Genuinely untimed', todo: true, done: true, duration: 15 };
  const free = logCore.projectCompletedEstimates({ items: [item, companion], startMinutes: 510, endMinutes: 1200 });
  assert.equal(free.items[1].start, 510, 'unverified cached time must not block other estimates');
});

test('chart completion selection never lets source time override local evidence or uncertain CLOCK coverage', () => {
  const reference = { state: 'resolved', sourceUid: 'source-task', sourceMinutes: 1434, minutes: 1434, placement: 'plan-clock' };
  const select = extra => logCore.selectChartCompletionTime({ reference, clockReadKnown: true, ...extra });
  assert.deepEqual(select({}), { origin: 'reference', minutes: 1434, reference });
  assert.deepEqual(select({ localDoneAt: 0 }), { origin: 'local', minutes: 0 });
  assert.deepEqual(select({ localDoneAt: 1300, actualMinutes: 30 }), { origin: 'local', minutes: 1300 });
  assert.deepEqual(select({ actualMinutes: 30 }), { origin: 'clock', minutes: null });
  assert.deepEqual(select({ hasLocalClock: true }), {
    origin: 'unverified', minutes: null,
    reference: { state: 'unverified', reason: 'local-clock-unplaceable', sourceMinutes: null },
  });
  assert.equal(select({ hasLocalClock: true, localTimeInvalid: true }).reference.reason, 'invalid-local-time');
  assert.equal(select({ clockReadKnown: false }).origin, 'unverified');
  assert.equal(select({ reference: { ...reference, state: 'unverified', reason: 'invalid-source-time' } }).origin, 'unverified');
  assert.deepEqual(select({ reference: null, clockReadKnown: false }), { origin: 'none', minutes: null });
});

test('only pure chains inherit the timestamp of the nearest explicit DONE owner', () => {
  const strings = new Map([
    ['middle-source', '((source-task))'],
    ['source-task', SOURCE],
  ]);
  const readString = uid => strings.get(uid) || '';
  const chained = resolve('((middle-source))', { readString });
  assert.equal(chained.completionEvidence.reference.sourceUid, 'source-task');
  assert.equal(chained.completionEvidence.reference.minutes, 1434);
  strings.set('middle-source', 'Review ((source-task))');
  const contextual = resolve('((middle-source))', { readString });
  assert.equal(contextual.status, 'DONE', 'time admission must not rewrite source-owned task state');
  assert.equal(contextual.completionEvidence.reference.reason, 'reference-context-unsupported');
  strings.set('middle-source', '{{[[DONE]]}} Local completion ((source-task)) d22:00');
  const owned = resolve('((middle-source))', { readString });
  assert.equal(owned.completionEvidence.reference.sourceUid, 'middle-source');
  assert.equal(owned.completionEvidence.reference.minutes, 1320);
  strings.set('middle-source', '{{[[TODO]]}} Reopened ((source-task))');
  assert.equal(resolve('((middle-source))', { readString }).completionEvidence, undefined);
});

test('repeated source DONE/TODO toggles use only the current visible source stamp', () => {
  const strings = new Map([['toggle-source', '{{[[DONE]]}} Work 15m d10:32']]);
  const instance = () => taskCore.resolveTaskInstance({ uid: 'toggle-wrapper', localString: '((toggle-source))',
    readString: uid => strings.get(uid) || '', fallbackMinutes: 15, includeCompletionEvidence: true });
  assert.equal(instance().completionEvidence.reference.minutes, 632);
  strings.set('toggle-source', '{{[[TODO]]}} Work 15m d10:32');
  assert.equal(instance().status, 'TODO');
  assert.equal(instance().completionEvidence, undefined);
  strings.set('toggle-source', '{{[[DONE]]}} Work 15m d11:00');
  assert.equal(instance().completionEvidence.reference.minutes, 660);
  strings.set('toggle-source', '{{[[DONE]]}} Work 15m');
  assert.equal(instance().completionEvidence.reference, null, 'no sticky prior source stamp');
});

test('contextual and impure nested references keep execution status but cannot fabricate a completion slot', () => {
  const shapes = ['Review ((source-task))', '((source-task)) 30m extra', '((source-task)) ((second-source))',
    '`((source-task))`', '((source-task)) #tag', '((source-task))30m', '30m((source-task))'];
  for (const shape of shapes) {
    const strings = new Map([['source-task', SOURCE], ['middle-source', shape]]);
    for (const localString of [shape, '((middle-source))']) {
      const options = { readString: uid => strings.get(uid) || '' };
      const task = resolve(localString, options);
      const { completionEvidence, ...execution } = task;
      assert.deepEqual(execution, resolve(localString, { ...options, includeCompletionEvidence: false }));
      assert.equal(task.status, 'DONE', `${localString}: preserve the original inherited state`);
      assert.equal(task.statusOwnerUid, 'source-task');
      assert.equal(completionEvidence.reference.reason, 'reference-context-unsupported');
      const placement = logCore.selectChartCompletionTime({ reference: completionEvidence.reference, clockReadKnown: true });
      assert.equal(placement.origin, 'unverified');
      assert.equal(placement.minutes, null);
    }
  }
});

test('recognized duration metadata preserves the source endpoint without accepting glued tokens', () => {
  for (const [localString, minutes] of [['30m ((source-task))', 30], ['((source-task)) 1h30m', 90], ['((source-task)) 30m 15m', 15]]) {
    const task = resolve(localString);
    assert.equal(task.plannedMinutes, minutes);
    assert.equal(task.completionEvidence.reference.minutes, 1434);
  }
  const nested = resolve('((middle-source)) 45m', { readString: uid => uid === 'middle-source' ? '((source-task)) 30m' : SOURCE });
  assert.equal(nested.plannedMinutes, 45);
  assert.equal(nested.completionEvidence.reference.minutes, 1434);
});

test('local overrides, missing stamps, malformed stamps, midnight and opt-in remain distinct', () => {
  assert.equal(resolve('{{[[TODO]]}} ((source-task))').completionEvidence, undefined);
  assert.equal(resolve('((source-task)) 10:00-11:00').kind, 'event');
  assert.equal(resolve('((source-task)) 10:00-11:00').completionEvidence, undefined);
  assert.equal(resolve('((source-task)) 30m').completionEvidence.reference.minutes, 1434);
  const local = resolve('((source-task)) d00:00');
  assert.deepEqual(local.completionEvidence, { localMinutes: 0, reference: null });
  assert.equal(local.doneAt, null);
  assert.equal(resolve('((source-task))', { includeCompletionEvidence: false }).completionEvidence, undefined);
  assert.equal(resolve('((source-task))', { readString: () => '{{[[DONE]]}} No timestamp' }).completionEvidence.reference, null);
  for (const token of ['d50%', 'd10%']) {
    assert.deepEqual(resolve(`{{[[DONE]]}} Legacy progress ${token}`).completionEvidence, { localMinutes: null, reference: null });
    assert.deepEqual(resolve('((source-task))', { readString: () => `{{[[DONE]]}} Legacy progress ${token}` }).completionEvidence,
      { localMinutes: null, reference: null });
  }
  assert.equal(resolve('((source-task))', { readString: () => '{{[[DONE]]}} Invalid stamp d25:00' }).completionEvidence.reference.minutes, null);
  for (const token of ['d25:00', 'd10:31pm']) for (const marker of ['', '{{[[DONE]]}} ']) {
    const invalid = resolve(`${marker}((source-task)) ${token}`);
    assert.equal(invalid.status, 'DONE', 'malformed chart evidence cannot reopen an already completed task');
    assert.equal(invalid.statusOrigin, marker ? 'local' : 'source');
    assert.equal(invalid.statusOwnerUid, marker ? 'local-wrapper' : 'source-task');
    assert.equal(invalid.completionEvidence.localTimeInvalid, true);
    assert.equal(invalid.completionEvidence.reference, null);
  }
  assert.equal(logCore.selectChartCompletionTime({ localTimeInvalid: true }).origin, 'unverified');
  assert.equal(resolve('((source-task))', { readString: () => '{{[[DONE]]}} Invalid suffix d10:31pm' }).completionEvidence.reference.minutes, null);
  assert.equal(resolve('((source-task))', { readString: () => '{{[[DONE]]}} Midnight d00:00' }).completionEvidence.reference.minutes, 0);
  const held = logCore.selectChartCompletionTime({ clockReadKnown: true, reference: { sourceUid: 'source-task', sourceString: SOURCE, minutes: 1434 } });
  assert.equal(held.origin, 'unverified');
  assert.equal(held.reference.sourceMinutes, 1434);
  assert.equal(held.reference.sourceString, undefined);
});
