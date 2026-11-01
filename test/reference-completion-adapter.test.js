const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectPull } = require('./pull-projection.cjs');
let loaded;
const extension = () => loaded ||= import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(__dirname, '../extension.js'))).toString('base64')}#reference-completion`);
const SOURCE = '{{[[DONE]]}} Completed reference d23:54';

async function fixture(run, { uid = 'source-task', string = SOURCE, pageUid = '10-31-2026', fail = false } = {}) {
  const previous = global.window, reads = [];
  const entity = { 'block/uid': uid, 'block/string': string, 'block/page': { 'block/uid': pageUid, 'node/title': 'Must not infer dates from this title' } };
  global.window = { roamAlphaAPI: { data: { pull(pattern, lookup) {
    reads.push({ pattern, lookup });
    if (fail) throw Error('read unavailable');
    return projectPull(pattern, entity);
  }, block: new Proxy({}, { get() { throw Error('No mutation is authorized'); } }) } } };
  try {
    const api = await extension();
    return await run(api, reads);
  } finally { global.window = previous; }
}

const payload = { uid: 'local-wrapper', localString: '((source-task))', displayDate: 'October 31st, 2026', logicalEndMinutes: 1200 };

test('renderer resolves a source stamp through an exact public metadata pull without changing execution identity', async () => {
  await fixture(async ({ resolveRendererTaskInstance }, reads) => {
    const result = resolveRendererTaskInstance(payload, () => SOURCE);
    assert.equal(result.uid, 'local-wrapper');
    assert.equal(result.doneAt, null);
    assert.doesNotMatch(result.effectiveString, /d23:54/);
    assert.deepEqual(result.completionEvidence.reference, {
      state: 'resolved', sourceUid: 'source-task', sourceMinutes: 1434, sourceDate: '2026-10-31', minutes: 1434,
    });
    assert.equal(reads.length, 1);
    assert.deepEqual(reads[0].lookup, [':block/uid', 'source-task']);
    assert.match(reads[0].pattern, /:block\/uid/);
    assert.match(reads[0].pattern, /:block\/string/);
    assert.match(reads[0].pattern, /:block\/page/);
    assert.doesNotMatch(reads[0].pattern, /edit\/time|create\/time/);
    assert.doesNotMatch(JSON.stringify(result.completionEvidence), /sourceString/);
  });
});

test('wrong identities, changed text, missing dates and failed reads remain unverified', async () => {
  for (const options of [{ uid: 'wrong-source' }, { string: '{{[[DONE]]}} Different version d22:00' }, { pageUid: 'project-page' }, { pageUid: '10-30-2026' }, { fail: true }]) {
    await fixture(async ({ resolveRendererTaskInstance }) => {
      const result = resolveRendererTaskInstance(payload, () => SOURCE);
      assert.equal(result.completionEvidence.reference.state, 'unverified');
      assert.equal(result.completionEvidence.reference.minutes, undefined);
      assert.equal(result.completionEvidence.reference.sourceMinutes, 1434);
    }, options);
  }
});

test('legacy callers and local/contextual overrides do not read source date metadata', async () => {
  await fixture(async ({ resolveRendererTaskInstance }, reads) => {
    const old = resolveRendererTaskInstance({ uid: 'local-wrapper', localString: '((source-task))' }, () => SOURCE);
    assert.equal(old.completionEvidence, undefined);
    for (const localString of ['{{[[TODO]]}} ((source-task))', '{{[[DONE]]}} ((source-task)) d22:00', 'Review ((source-task)) 30m', '((source-task)) 30m']) {
      const r = resolveRendererTaskInstance({ ...payload, localString }, () => SOURCE);
      assert.equal(r.completionEvidence?.reference ?? null, null);
    }
    assert.equal(reads.length, 0);
  });
});
