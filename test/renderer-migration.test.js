const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { CODE_UID, LEGACY_UIDS } = require('../src/renderer-contract');
let api;
const load = () => api ||= import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname,'../extension.js')).toString('base64')}#renderer-migration`);
const deferred = () => { let resolve; const promise = new Promise(r=>{resolve=r}); return {promise,resolve}; };
const hash = async text => crypto.createHash('sha256').update(text).digest('hex');
const before = `[[Private prefix]] {{[[roam/render]]:((${LEGACY_UIDS[0]})) 22 15 6 "#T0" 20}}`;
const after = before.replace(LEGACY_UIDS[0],CODE_UID);

async function fixture(t, options={}) {
  const module=await load(), values=options.values||new Map(), blocks=options.blocks||new Map([['target001',{string:before,children:['child'],open:false,heading:2}]]);
  const provider={}, ctx={provider,graph:'fixture-graph',type:'hosted',user:'fixture-user'};
  const writes=[], notices=[], reads=[];
  const settings={get:key=>values.get(key),set:async(key,value)=>{
    if(options.persist) return options.persist(key,value,values);
    values.set(key,structuredClone(value));
  }};
  const host={crypto:crypto.webcrypto,setTimeout,clearTimeout};
  let tail=Promise.resolve(),closed=false;
  const guard={assertActive(){if(closed)throw Error('closed');},run(fn){const run=tail.then(fn);tail=run.catch(()=>{});return run;},destroy(){closed=true;}};
  const migration=module.createRendererMigration({extensionAPI:{settings},host,getContext:()=>ctx,sourceReady:()=>true,guard,hash:options.hash||hash,timeoutMs:options.timeoutMs||100,
    read:uid=>{reads.push(uid);return blocks.get(uid)?.string??null;},update:async(uid,string)=>{writes.push({uid,string});if(options.update)return options.update(uid,string,blocks);blocks.get(uid).string=string;},notify:message=>notices.push(message)});
  t.after(()=>migration.destroy());
  return {migration,values,blocks,writes,notices,reads,ctx,host,settings,run:extra=>migration.migrate({uid:'target001',kind:'active-plan',...extra})};
}

test('a migration changes only the renderer UID and verifies its persistent reservation before writing',async t=>{
  let f;
  f=await fixture(t,{update:async(uid,string,blocks)=>{
    const receipt=f.values.get('renderer-migration-pending').items[0];
    assert.equal(receipt.uid,uid);assert.equal(receipt.afterHash,await hash(string));
    assert.ok(!JSON.stringify(receipt).includes('Private prefix'));
    blocks.get(uid).string=string;
  }});
  const original=structuredClone(f.blocks.get('target001'));
  assert.equal((await f.run()).changed,true);
  assert.deepEqual(f.blocks.get('target001'),{...original,string:after});
  assert.equal(f.values.get('renderer-migration-pending').items.length,0);
  assert.equal(f.writes.length,1);assert.ok(f.reads.every(uid=>uid==='target001'));
  assert.equal((await f.run()).changed,false);assert.equal(f.writes.length,1);
});

test('an explicitly invalid ownership predicate cannot fall back to migration authority',async t=>{
  for(const isCurrent of [false,null,'true',{}]) {
    const f=await fixture(t);
    assert.equal((await f.run({isCurrent})).ok,false);
    assert.equal(f.writes.length,0);assert.equal(f.blocks.get('target001').string,before);
  }
});

test('an uncertain graph update remains verification-only across reload and late settlement',async t=>{
  const f=await fixture(t,{update:async()=>{throw Error('lost response');}});
  assert.equal((await f.run()).reason,'unconfirmed');
  assert.equal(f.values.get('renderer-migration-pending').items.length,1);
  const next=await fixture(t,{values:f.values,blocks:f.blocks});
  assert.equal((await next.run()).reason,'unconfirmed');assert.equal(next.writes.length,0);
  next.blocks.get('target001').string=after;
  assert.equal((await next.run()).verified,true);assert.equal(next.writes.length,0);
  assert.equal(next.values.get('renderer-migration-pending').items.length,0);
});

test('a current but different reference cannot retire or replay an uncertain migration',async t=>{
  const f=await fixture(t,{update:async()=>{throw Error('lost response');}});
  assert.equal((await f.run()).reason,'unconfirmed');
  const receipt=structuredClone(f.values.get('renderer-migration-pending'));
  const next=await fixture(t,{values:f.values,blocks:f.blocks});
  next.blocks.get('target001').string=after.replace('22 15','28 15');
  assert.equal((await next.run()).reason,'unconfirmed');
  assert.deepEqual(next.values.get('renderer-migration-pending'),receipt);
  next.blocks.get('target001').string=before.replace('22 15','28 15');
  assert.equal((await next.run()).reason,'unconfirmed');
  assert.equal(next.writes.length,0);
  next.blocks.get('target001').string=after;
  assert.equal((await next.run()).verified,true);
  assert.equal(next.values.get('renderer-migration-pending').items.length,0);
});

test('failed, no-op and corrupt metadata cannot authorize a renderer-reference write',async t=>{
  for(const mode of ['reject','no-op','corrupt'])await t.test(mode,async st=>{
    const f=await fixture(st,{persist:async()=>{if(mode==='reject')throw Error('unavailable');}});
    if(mode==='corrupt')f.values.set('renderer-migration-pending',{version:1,items:[{uid:'foreign'}]});
    const original=structuredClone(f.values.get('renderer-migration-pending'));
    assert.equal((await f.run()).ok,false);assert.equal(f.writes.length,0);
    assert.deepEqual(f.values.get('renderer-migration-pending'),original);
    assert.equal(f.blocks.get('target001').string,before);
  });
});

test('hashing, editing and target-ownership changes cannot migrate stale content',async t=>{
  const gate=deferred(),entered=deferred();
  const f=await fixture(t,{hash:async text=>{entered.resolve();await gate.promise;return hash(text);}});
  const result=f.run();await entered.promise;f.ctx.user='another-user';gate.resolve();
  assert.equal((await result).ok,false);assert.equal(f.writes.length,0);
  const editing=await fixture(t);const editor={id:'block-input-main-target001',value:before};
  editing.host.document={activeElement:editor,querySelectorAll:()=>[editor]};
  assert.equal((await editing.run()).reason,'changed-or-editing');assert.equal(editing.writes.length,0);
  let current=true;
  const moved=await fixture(t,{persist:async(key,value,values)=>{values.set(key,structuredClone(value));current=false;}});
  assert.equal((await moved.run({isCurrent:()=>current})).ok,false);assert.equal(moved.writes.length,0);
});

test('newer and ambiguous renderer roots are preserved without migration metadata',async t=>{
  for(const string of [before.replace(LEGACY_UIDS[0],'roam-render-Nautilus-Log-r3-cljs'),before+' '+before])await t.test(string.slice(-35),async st=>{
    const f=await fixture(st);f.blocks.get('target001').string=string;
    assert.equal((await f.run()).ok,false);assert.equal(f.writes.length,0);assert.equal(f.values.size,0);
    assert.equal(f.blocks.get('target001').string,string);
  });
});

test('a hanging host call is bounded without erasing the pending receipt or issuing another write',async t=>{
  const f=await fixture(t,{timeoutMs:5,update:()=>new Promise(()=>{})});
  assert.equal((await f.run()).reason,'unconfirmed');
  assert.equal((await f.run()).reason,'unconfirmed');assert.equal(f.writes.length,1);
  assert.equal(f.values.get('renderer-migration-pending').items.length,1);
});
