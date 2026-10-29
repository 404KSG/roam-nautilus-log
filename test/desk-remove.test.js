const test = require('node:test');
const assert = require('node:assert/strict');
const { projectPull } = require('./pull-projection.cjs');
const { createDeskRemoveController, createModernDeskRemoveAdapter, readStrictDeskRemoveSnapshot } = require('../src/desk-remove');
const ROOT='[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}';
const copy = value => JSON.parse(JSON.stringify(value));
function fixture({ text='{{TODO}} ((source-1))', children=false, date='2001-03-04', mode='normal', hostTimeoutMs=5000 }={}) {
  const day = `${date.slice(5,7)}-${date.slice(8,10)}-${date.slice(0,4)}`;
  const nodes=new Map(), overrides=new Map(), calls=[];let user='user',focused=null,alive=true,quiet=true,release=null,changed=false;
  const add=(uid,string,parentUid,order,pageUid=day,props={})=>nodes.set(uid,{uid,string,parentUid,order,pageUid,...props});
  nodes.set(day,{uid:day,title:date});nodes.set('source-page',{uid:'source-page',title:'Source page'});
  add('plan',ROOT,day,0);add('day-sibling','Untouched daily sibling',day,1);
  add('target',text,'plan',0);add('sibling','{{TODO}} Keep sibling','plan',1);
  add('source-1','Original reference source','source-page',0,'source-page',{open:false});add('source-child','Original source child','source-1',0,'source-page');
  if(children) { add('local-child','Local note','target',0,day,{open:false,heading:2,'text-align':'center'});add('deep-child','Deep content','local-child',0); }
  const kids=id=>[...nodes.values()].filter(n=>n.parentUid===id).sort((a,b)=>a.order-b.order);
  const raw=id=>{ const n=nodes.get(id);if(!n)return null;
    return {'block/uid':id,...(n.title!==undefined?{'node/title':n.title}:{'block/string':n.string,'block/order':n.order,'block/_children':[{ 'block/uid':n.parentUid }],'block/page':{'block/uid':n.pageUid}}),
      ...Object.fromEntries(['open','heading','text-align','children-view-type'].filter(k=>Object.hasOwn(n,k)).map(k=>[`block/${k}`,n[k]])),
      'block/children':kids(id).map(c=>({'block/uid':c.uid,'block/order':c.order})),...overrides.get(id)}; };
  const apply=async(kind,args)=>{
    calls.push({kind,args:copy(args)});
    if(mode==='held') await new Promise(resolve=>{release=resolve});
    if(mode==='noop')return;
    const n=nodes.get(args.block.uid), old=n.parentUid;
    if(kind==='delete') { assert.equal(kids(n.uid).length,0);nodes.delete(n.uid); }
    else {n.parentUid=args.location['parent-uid'];n.order=args.location.order;}
    kids(old).forEach((node,order)=>{node.order=order});
    if(mode==='lost')throw Error('lost response');
    if(mode==='collateral')nodes.get('source-child').string='Changed elsewhere';
    if(mode==='context-after')user='other-user';
  };
  const api={graph:{name:'test',type:'hosted'},user:{uid:()=>user},ui:{getFocusedBlock:()=>focused?{'block-uid':focused}:null},
    data:{pull:(pattern,lookup)=>{
      const entity=raw(lookup[1]);
      if(mode==='change-precommit' && lookup[1]==='source-1' && !changed) { nodes.get('target').string='Changed before mutation'; changed=true; }
      return projectPull(pattern,entity,value=>({...raw(value?.['block/uid']),...value}));
    },block:{delete:args=>apply('delete',args),move:args=>apply('move',args)}},
    util:{pageTitleToDate:title=>/^\d{4}-\d{2}-\d{2}$/.test(title)?new Date(`${title}T12:00:00Z`):null,
      dateToPageTitle:d=>d.toISOString().slice(0,10),dateToPageUid:d=>{const s=d.toISOString().slice(0,10);return `${s.slice(5,7)}-${s.slice(8,10)}-${s.slice(0,4)}`;}}};
  const context=()=>({provider:api,graphName:api.graph.name,graphType:api.graph.type,userUid:user});
  let lane=Promise.resolve();const exclusive=fn=>{const p=lane.then(fn);lane=p.catch(()=>{});return p;};
  const controller=()=>createDeskRemoveController({getApi:()=>api,getContext:context,runExclusive:exclusive,hostTimeoutMs,delay:async()=>{}});
  const c=controller(),surface=c.registerSurface({planUid:'plan',isAlive:()=>alive,isQuiescent:()=>quiet});
  return {nodes,overrides,calls,api,day,c,surface,controller,raw,kids,
    remove:options=>surface.remove({uid:'target',expectedString:text,...options}),
    release:()=>release?.(),held:()=>!!release,setUser:v=>{user=v},focus:id=>{focused=id},dispose:()=>{alive=false;surface.destroy()},quiet:v=>{quiet=v}};
}

test('only plain childless local wrappers delete; every content-bearing form promotes the same UID',async t=>{
  for(const [text,children,kind] of [
    ['((source-1))',false,'delete'],['{{TODO}} ((source-1))',false,'delete'],['((source-1)) {{[[TODO]]}}',false,'move'],
    ['((source-1))',true,'move'],['Review ((source-1))',false,'move'],['{{DONE}} ((source-1))',false,'move'],
    ['{{TODO}} {{TODO}} ((source-1))',false,'move'],['{{todo}} ((source-1))',false,'move'],['{{[[TODO}} ((source-1))',false,'move'],['{{TODO]]}} ((source-1))',false,'move'],['((target))',false,'move'],['((source-page))',false,'delete'],
    ['`((source-1))`',false,'move'],['[[Page]]',false,'move'],['[Alias](((source-1)))',false,'move'],['',false,'move'],
    ['{{TODO}} Real task',true,'move'],['((missing-source))',false,'delete']]) await t.test(`${kind}: ${text}/${children}`,async()=>{
    const f=fixture({text,children});const source=copy(f.nodes.get('source-1')),child=copy(f.nodes.get('source-child'));
    const tree=[...f.nodes.values()].filter(n=>['local-child','deep-child'].includes(n.uid)).map(copy);
    const result=await f.remove();assert.equal(f.calls.length,1);assert.equal(f.calls[0].kind,kind);
    assert.deepEqual(f.nodes.get('source-1'),source);assert.deepEqual(f.nodes.get('source-child'),child);
    assert.deepEqual(tree,tree.map(n=>f.nodes.get(n.uid)));
    if(kind==='delete'){assert.equal(result.status,'removed-reference');assert.equal(f.nodes.has('target'),false);}
    else {assert.equal(result.status,'moved-to-daily-note');assert.equal(f.nodes.get('target').parentUid,f.day);assert.equal(f.nodes.get('target').order,2);assert.equal(f.nodes.get('target').string,text);}
    await f.remove();assert.equal(f.calls.length,1,'settled retries do not mutate again');
  });
});

test('owning historical/future Daily Note is used, never today',async()=>{
  for(const date of ['1999-12-31','2099-01-01']) {const f=fixture({date,text:'Task'});await f.remove();assert.equal(f.calls[0].args.location['parent-uid'],f.day);}
});

test('nested plans validate the entire ownership chain and append to the page root',async()=>{
 const f=fixture({text:'Task'});
 f.nodes.set('plan-folder',{uid:'plan-folder',string:'Folder',parentUid:f.day,pageUid:f.day,order:0});
 f.nodes.get('plan').parentUid='plan-folder';
 await f.remove();assert.equal(f.nodes.get('target').parentUid,f.day);assert.equal(f.nodes.get('plan').parentUid,'plan-folder');
 const broken=fixture();broken.nodes.get('plan').parentUid='missing-ancestor';await assert.rejects(broken.remove());assert.equal(broken.calls.length,0);
});

test('malformed metadata, identity, daily ownership and admission reject before a host call',async t=>{
  const cases={
    'not renderer':f=>f.nodes.get('plan').string='not a renderer',
    'non Daily':f=>f.nodes.get(f.day).title='Project',
    'wrong date UID':f=>f.api.util.dateToPageUid=()=> 'other-page',
    'missing date helper':f=>delete f.api.util.pageTitleToDate,
    'multiple parents':f=>f.overrides.set('target',{'block/_children':[{'block/uid':'plan'},{'block/uid':'elsewhere'}]}),
    'wrong parent':f=>f.overrides.set('target',{'block/_children':[{'block/uid':'elsewhere'}]}),
    'wrong page':f=>f.nodes.get('target').pageUid='source-page',
    'negative order':f=>f.nodes.get('target').order=-1,
    'duplicate order':f=>f.nodes.get('sibling').order=0,
    'null children':f=>f.overrides.set('target',{'block/children':null}),
    'invalid open':f=>f.nodes.get('target').open='false',
    'page/block ambiguity':f=>f.overrides.set('target',{'node/title':'Also a page'}),
    'malformed occupied':f=>f.overrides.set('target',{'block/string':null}),
    'missing context':f=>f.setUser(''),
    'active target':f=>f.focus('target'),
    'active descendant':f=>f.focus('local-child'),
    'busy surface':f=>f.quiet(false),
    'disposed':f=>f.dispose(),
    'missing focused seam':f=>delete f.api.ui.getFocusedBlock,
    'unsupported mutation':f=>delete f.api.data.block.move,
  };
  for(const [name,change] of Object.entries(cases))await t.test(name,async()=>{
    const f=fixture({text:'Task',children:true});change(f);await assert.rejects(f.remove());assert.equal(f.calls.length,0);
  });
  const f=fixture();const signal=new AbortController();signal.abort();await assert.rejects(f.remove({signal:signal.signal}));assert.equal(f.calls.length,0);
});

test('precommit changes and a focus editor in another same-plan surface cannot mutate',async()=>{
  const f=fixture();const other=f.c.registerSurface({planUid:'plan',isAlive:()=>true,isQuiescent:()=>false});
  await assert.rejects(f.remove());assert.equal(f.calls.length,0);other.destroy();
  await assert.rejects(f.remove({expectedString:'old text'}));assert.equal(f.calls.length,0);
  const g=fixture({mode:'change-precommit'});await assert.rejects(g.remove());assert.equal(g.calls.length,0);
});

test('double requests share a pending promise; disposal after host invocation permits readback',async()=>{
  const f=fixture({mode:'held'});const first=f.remove(),second=f.remove();assert.equal(first,second);
  while(!f.held())await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,1);
  f.dispose();f.c.destroy();f.release();assert.equal((await first).status,'removed-reference');assert.equal(f.calls.length,1);
});

test('lost responses read back; uncertain no-op/collateral/context outcomes never reissue',async t=>{
  const lost=fixture({mode:'lost'});assert.equal((await lost.remove()).status,'removed-reference');assert.equal(lost.calls.length,1);
  const switched=fixture({mode:'context-after'});await assert.rejects(switched.remove());
  await assert.rejects(switched.remove());assert.equal(switched.calls.length,1);
  switched.setUser('user');assert.equal((await switched.remove()).status,'removed-reference');assert.equal(switched.calls.length,1);
  for(const mode of ['noop','collateral'])await t.test(mode,async()=>{
    const f=fixture({mode});await assert.rejects(f.remove());assert.equal(f.calls.length,1);
    if(mode==='context-after')f.setUser('user');
    await assert.rejects(f.remove());assert.equal(f.calls.length,1);
    assert.throws(()=>f.c.assertPlanClear('plan'),/unconfirmed/);
    await assert.rejects(f.surface.remove({uid:'sibling',expectedString:'{{TODO}} Keep sibling'}));assert.equal(f.calls.length,1);
    f.c.destroy();const next=f.controller(),s=next.registerSurface({planUid:'plan',isAlive:()=>true,isQuiescent:()=>true});
    await assert.rejects(s.remove({uid:'target',expectedString:'{{TODO}} ((source-1))'}));assert.equal(f.calls.length,1);
  });
});

test('a response timeout retains the reservation; late completion is verification-only',async()=>{
  const f=fixture({mode:'held',hostTimeoutMs:10});
  await assert.rejects(f.remove());assert.equal(f.calls.length,1);
  await assert.rejects(f.remove());assert.equal(f.calls.length,1);
  f.release();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(await f.c.verifyPending('plan'),{confirmed:1});assert.equal(f.calls.length,1);
  assert.doesNotThrow(()=>f.c.assertPlanClear('plan'));
  assert.deepEqual(await f.c.verifyPending('plan'),{confirmed:0});
});

test('transitive source preservation and source-reference limits are part of removal admission',async()=>{
 const f=fixture();f.nodes.get('source-1').string='((nested-source))';
 f.nodes.set('nested-source',{uid:'nested-source',string:'Original nested source',parentUid:'source-page',pageUid:'source-page',order:1});
 const originalDelete=f.api.data.block.delete;
 f.api.data.block.delete=async args=>{await originalDelete(args);f.nodes.get('nested-source').string='Collateral change';};
 await assert.rejects(f.remove());assert.equal(f.calls.length,1);
 await assert.rejects(f.remove());assert.equal(f.calls.length,1);
 for(const malformed of [{'block/_children':[]},{'block/page':undefined}]){
  const bad=fixture();bad.overrides.set('source-1',malformed);await assert.rejects(bad.remove());assert.equal(bad.calls.length,0);
 }
 const huge=fixture();huge.nodes.get('source-1').string='((chain-0))';
 for(let i=0;i<130;i++)huge.nodes.set(`chain-${i}`,{uid:`chain-${i}`,string:i===129?'End':`((chain-${i+1}))`,parentUid:'source-page',pageUid:'source-page',order:i+1});
 await assert.rejects(huge.remove(),/referenced sources/);assert.equal(huge.calls.length,0);
});

test('read-only snapshot preserves absent versus false open and all presentation/descendant identity',()=>{
  const f=fixture({text:'Task',children:true});const s=readStrictDeskRemoveSnapshot({adapter:createModernDeskRemoveAdapter(f.api),planUid:'plan',targetUid:'target'});
  assert.deepEqual(s.nodes.get('local-child').properties,{open:false,heading:2,'text-align':'center'});
  assert.deepEqual(s.nodes.get('deep-child').properties,{});assert.ok(s.subtree.has('deep-child'));
});
