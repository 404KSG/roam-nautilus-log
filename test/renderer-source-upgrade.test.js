const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const contract = require('../src/renderer-contract');
const { prepareRendererSourceChange } = require('../src/renderer-source-update');
const KEY = 'renderer-source-upgrade-pending';
const hash = async text => crypto.createHash('sha256').update(text).digest('hex');
const source = (revision, body = 'approved') => `\`\`\`clojure\n ;; nautilus-renderer ${revision}\n(ns nautilus-log-r${revision})\n;; ${body}\n\`\`\``;
const before = source(2), after = source(3);
let api;
const load = () => api ||= import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname,'../extension.js')).toString('base64')}#source-upgrade`);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture(t, options = {}) {
  const module = await load(), values = options.values || new Map();
  const blocks = options.blocks || new Map([[contract.CODE_UID, { string: before, parentUid:'code', order:0, children:[], open:false }]]);
  const ctx = { provider:{}, graph:'source-test', type:'hosted', user:'test-user' }, writes=[], notices=[], reads=[];
  const host = { crypto:crypto.webcrypto }; let alive=true, owned=true, tail=Promise.resolve();
  const guard = { assertActive() { if(!alive)throw Error('closed'); }, run(fn) { const next=tail.then(fn);tail=next.catch(()=>{});return next; }, destroy() { alive=false; } };
  const settings = { get:key=>values.get(key), set:async(key,value)=>{
    if(options.persist)return options.persist(key,value,values);
    values.set(key,structuredClone(value));
  } };
  const updater = module.createRendererSourceUpgrade({ extensionAPI:{settings}, host, guard, getContext:()=>ctx,
    revision:3, expectedSource:()=>after, releasedSources:[{revision:2,sha256:await hash(before)}],
    sourceReady:()=>owned, hash:options.hash || hash, timeoutMs:options.timeoutMs || 100,
    read:uid=>{ reads.push(uid);return blocks.get(uid)?.string ?? null; },
    update:async(uid,string)=>{writes.push({uid,string});if(options.update)return options.update(uid,string,blocks);blocks.get(uid).string=string;},
    notify:message=>notices.push(message) });
  t.after(()=>updater.destroy());
  return { updater, values, blocks, ctx, host, writes, notices, reads, setOwned:value=>{owned=value;},
    run:extra=>updater.upgrade({ isCurrent:()=>owned, ...extra }) };
}

test('the permanent source UID and current identity survive a source revision advance',()=>{
  const text=fs.readFileSync(path.join(__dirname,'../src/renderer-contract.js'),'utf8');
  const next=text.replace(/^const REVISION = \d+;/m,`const REVISION = ${contract.REVISION+1};`);
  assert.notEqual(next,text);const context={module:{exports:{}}};vm.runInNewContext(next,context);
  const future=context.module.exports;assert.equal(future.CODE_UID,contract.CODE_UID);
  assert.equal(future.rendererIdentity(contract.CODE_UID).kind,'current');
  assert.equal(future.rendererIdentity(contract.CODE_UID).revision,contract.REVISION+1);
  assert.equal(future.inspectRendererSource(source(contract.REVISION),source(contract.REVISION+1)).state,'older');
});

test('the source catalogue records the exact currently published fenced body',async()=>{
  const expected='```clojure\n '+fs.readFileSync(path.join(__dirname,'../src/component.cljs'),'utf8')+' ```';
  assert.ok(contract.RELEASED_RENDERER_SOURCES.some(row=>row.revision===contract.REVISION&&row.sha256===crypto.createHash('sha256').update(expected).digest('hex')));
});

test('source approval accepts only an exact published predecessor',async()=>{
  const opts={expected:after,revision:3,releasedSources:[{revision:2,sha256:await hash(before)}],hash};
  assert.deepEqual(await prepareRendererSourceChange({before,...opts}),{changed:true,string:after});
  assert.deepEqual(await prepareRendererSourceChange({before:after,...opts}),{changed:false,string:after});
  for(const text of [before+' ',source(3,'custom'),source(4),source(1),'personal notes',null]) {
    await assert.rejects(prepareRendererSourceChange({before:text,...opts}),/preserved|predecessor|hash/);
  }
  await assert.rejects(prepareRendererSourceChange({before,...opts,expected:source(4)}),/contract/);
});

test('a verified release replaces only the canonical body and a reload is a zero-write reuse',async t=>{
  let f;f=await fixture(t,{update:async(uid,string,blocks)=>{
    const record=f.values.get(KEY).items[0];assert.equal(record.uid,contract.CODE_UID);
    assert.equal(record.kind,'source');assert.equal(record.revision,3);assert.equal(record.afterHash,await hash(after));
    assert.ok(!JSON.stringify(record).includes('approved'));blocks.get(uid).string=string;
  }});
  const original=structuredClone(f.blocks.get(contract.CODE_UID));
  assert.equal((await f.run()).changed,true);
  assert.deepEqual(f.blocks.get(contract.CODE_UID),{...original,string:after});
  assert.equal(f.blocks.size,1);assert.equal(f.values.get(KEY).items.length,0);assert.equal(f.updater.hasPending(),false);
  assert.equal((await f.run()).changed,false);assert.equal(f.writes.length,1);assert.ok(f.reads.every(uid=>uid===contract.CODE_UID));
  assert.equal(f.values.has('renderer-migration-pending'),false);
});

test('unknown, edited, absent and newer source bodies never get overwritten',async t=>{
  for(const text of [before+' ',source(3,'custom'),source(4),source(1),'private data',null])await t.test(String(text).slice(-18),async st=>{
    const f=await fixture(st);
    if(text===null)f.blocks.delete(contract.CODE_UID);else f.blocks.get(contract.CODE_UID).string=text;
    assert.equal((await f.run()).ok,false);assert.equal(f.writes.length,0);assert.equal(f.values.size,0);
  });
});

test('source upgrade requires explicit owner validation and refuses an active editor',async t=>{
  const f=await fixture(t);assert.equal((await f.run({isCurrent:null})).reason,'unverified-context');
  f.setOwned(false);assert.equal((await f.run()).ok,false);assert.equal(f.writes.length,0);
  f.setOwned(true);const editor={id:`block-input-main-${contract.CODE_UID}`,value:before};
  f.host.document={activeElement:editor,querySelectorAll:()=>[editor]};
  assert.equal((await f.run()).reason,'changed-or-editing');assert.equal(f.writes.length,0);
});

for(const change of ['graph','source','owner'])test(`source ${change} drift during hashing is rechecked before reservation`,async t=>{
  const entered=deferred(),gate=deferred();const f=await fixture(t,{hash:async text=>{entered.resolve();await gate.promise;return hash(text);}});
  const operation=f.run();await entered.promise;
  if(change==='graph')f.ctx.graph='other';if(change==='source')f.blocks.get(contract.CODE_UID).string=before+' ';if(change==='owner')f.setOwned(false);
  gate.resolve();assert.equal((await operation).ok,false);assert.equal(f.writes.length,0);assert.equal(f.values.size,0);
});

test('owner loss during receipt persistence stops before the graph write',async t=>{
  let f;f=await fixture(t,{persist:async(key,value,values)=>{values.set(key,structuredClone(value));f.setOwned(false);}});
  assert.equal((await f.run()).ok,false);assert.equal(f.writes.length,0);assert.equal(f.blocks.get(contract.CODE_UID).string,before);
});

test('lost source-update responses remain verification-only through reload',async t=>{
  const f=await fixture(t,{update:async()=>{throw Error('response lost');}});
  assert.equal((await f.run()).reason,'unconfirmed');assert.equal(f.updater.hasPending(),true);
  const receipt=structuredClone(f.values.get(KEY));
  const next=await fixture(t,{values:f.values,blocks:f.blocks});
  assert.equal((await next.run()).reason,'unconfirmed');assert.equal(next.writes.length,0);
  next.blocks.get(contract.CODE_UID).string=after+' ';
  assert.equal((await next.run()).reason,'unconfirmed');assert.deepEqual(next.values.get(KEY),receipt);
  next.blocks.get(contract.CODE_UID).string=after;
  assert.equal((await next.run()).verified,true);assert.equal(next.writes.length,0);assert.equal(next.updater.hasPending(),false);
});

test('source content is rechecked after receipt retirement settles',async t=>{
  let f;f=await fixture(t,{persist:async(key,value,values)=>{
    values.set(key,structuredClone(value));
    if(value.items.length===0)f.blocks.get(contract.CODE_UID).string=source(4);
  }});
  assert.equal((await f.run()).reason,'changed-during-verification');
  assert.equal(f.blocks.get(contract.CODE_UID).string,source(4));assert.equal(f.writes.length,1);
});

test('write-then-throw confirms only the exact intended source body',async t=>{
  const f=await fixture(t,{update:async(uid,string,blocks)=>{blocks.get(uid).string=string;throw Error('lost acknowledgement');}});
  assert.equal((await f.run()).ok,true);assert.equal(f.writes.length,1);assert.equal(f.updater.hasPending(),false);
});

test('source persistence failures and malformed receipts cannot authorize writes',async t=>{
  for(const mode of ['reject','noop','corrupt'])await t.test(mode,async st=>{
    const f=await fixture(st,{persist:async()=>{if(mode==='reject')throw Error('metadata unavailable');}});
    if(mode==='corrupt')f.values.set(KEY,{version:1,items:[{uid:contract.CODE_UID}]});
    assert.equal((await f.run()).ok,false);assert.equal(f.writes.length,0);
    assert.equal(f.blocks.get(contract.CODE_UID).string,before);
  });
});

test('a hanging source write is bounded and is not reissued',async t=>{
  const f=await fixture(t,{timeoutMs:5,update:()=>new Promise(()=>{})});
  assert.equal((await f.run()).reason,'unconfirmed');assert.equal((await f.run()).reason,'unconfirmed');
  assert.equal(f.writes.length,1);assert.equal(f.updater.hasPending(),true);
});
