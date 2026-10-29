const test=require('node:test'),assert=require('node:assert/strict');
const {projectPull}=require('./pull-projection.cjs');
const {LIMITS,parseDeskPreviewText,pureDeskReferenceUid,safeDeskImageUrl,createModernDeskPreviewAdapter,buildDeskFullPreview,readDeskPlan}=require('../src/desk-preview');
function fixture(overrides={}) {
 const nodes=new Map([
 ['root',{'block/uid':'root','block/string':'Root','block/order':0,'block/children':[{'block/uid':'child-a','block/order':0},{'block/uid':'child-b','block/order':1}]}],
 ['child-a',{'block/uid':'child-a','block/string':'First','block/order':0,'block/_children':[{'block/uid':'root'}],'block/children':[{'block/uid':'deep-a','block/order':0}]}],
 ['child-b',{'block/uid':'child-b','block/string':'Second','block/order':1,'block/_children':[{'block/uid':'root'}],'block/open':false,'block/children':[{'block/uid':'hidden-a','block/order':0}]}],
 ['deep-a',{'block/uid':'deep-a','block/string':'Nested','block/order':0,'block/_children':[{'block/uid':'child-a'}],'block/children':[{'block/uid':'depth-three','block/order':0}]}],
 ]);Object.entries(overrides).forEach(([uid,values])=>nodes.set(uid,{...nodes.get(uid),...values}));
 const calls=[];const api={data:{pull(pattern,lookup){calls.push({uid:lookup[1],pattern});return projectPull(pattern,nodes.get(lookup[1])??null,value=>({...nodes.get(value['block/uid']),...value}));}}};
 return {nodes,calls,api,adapter:createModernDeskPreviewAdapter(api),build(){return buildDeskFullPreview({uid:'root',adapter:this.adapter});}};
}
test('ordinary source text, aliases, status order and literal code retain exact meaning',()=>{
 assert.equal(parseDeskPreviewText('[[Alpha]] `literal` tail').text,'Alpha `literal` tail');
 const text='```\n{{TODO}} ((source-1))\n![x](https://x.test/a.png)\n```';
 assert.equal(parseDeskPreviewText(text,{readString:()=>{throw Error('must not read code')}}).text,text);
 assert.equal(parseDeskPreviewText(text).status,null);
 assert.equal(parseDeskPreviewText('[Jump](((source-1)))').text,'Jump');
 assert.equal(parseDeskPreviewText('[Page]([[Source page]])').text,'Page');
 assert.equal(parseDeskPreviewText('#[[multi tag]] [[Page]]').text,'#multi tag Page');
 assert.equal(parseDeskPreviewText('{{TODO}} ((source-1))',{readString:()=> '{{DONE}} Original'}).status,'TODO');
 assert.equal(parseDeskPreviewText('((source-1)) {{TODO}}',{readString:()=> '{{DONE}} Original'}).status,'DONE');
 assert.throws(()=>parseDeskPreviewText('((source-1))',{readString:()=>{throw Error('malformed')}}),/Preview unavailable/);
 assert.throws(()=>parseDeskPreviewText('((source-1))',{readString:()=>({})}),/Preview unavailable/);
 assert.equal(pureDeskReferenceUid('{{TODO}} {{TODO}} ((source-1))'),null);
});
test('reference depth, distinct count, repeated expansion, UTF-8 and image-token budgets are enforced',()=>{
 let reads=0;assert.throws(()=>parseDeskPreviewText('((ref000000))',{readString:uid=>{reads++;return `((${`ref${String(Number(uid.slice(3))+1).padStart(6,'0')}`}))`;}}),/depth/);assert.ok(reads<=LIMITS.referenceDepth);
 assert.throws(()=>parseDeskPreviewText(Array.from({length:LIMITS.references+1},(_,i)=>`((source-${i}))`).join(' '),{readString:()=> 'text'}),/reference count/);
 assert.throws(()=>parseDeskPreviewText('🙂'.repeat(LIMITS.bytes/4+1)),/sourceBytes/);
 assert.throws(()=>parseDeskPreviewText('![x](https://example.test/x) '.repeat(LIMITS.images+1)),/images/);
 assert.throws(()=>parseDeskPreviewText('((branch-0))',{readString:uid=>Number(uid.slice(7))<20?`((branch-${Number(uid.slice(7))+1})) ((branch-${Number(uid.slice(7))+1}))`:'leaf'}),/limit/);
});
test('blob images require a valid matching origin and unsafe data remains rejected',()=>{
 assert.equal(safeDeskImageUrl('blob:https://example.test/id','https://example.test'),'blob:https://example.test/id');
 assert.equal(safeDeskImageUrl('blob:https://other.test/id','https://example.test'),null);
 assert.equal(safeDeskImageUrl('blob:invalid','https://example.test'),null);
 assert.equal(safeDeskImageUrl('data:image/svg+xml;base64,AAAA'),null);
});
test('staged public pulls preserve folding and depth without fetching hidden strings',()=>{
 const f=fixture(),m=f.build();
 assert.deepEqual(m.rows.map(r=>[r.text,r.depth]),[['First',1],['Nested',2],['Second',1]]);
 assert.equal(m.more,true);assert.ok(!f.calls.some(c=>['hidden-a','depth-three'].includes(c.uid)));
 assert.ok(f.calls.every(c=>c.pattern.includes('{:block/children [:block/uid :block/order]}')));
});
test('null/open/order/membership/topology corruption is never normalized to plausible content',async t=>{
 const cases={
  'null children':{'root':{'block/children':null}},
  'explicit undefined children':{'root':{'block/children':undefined}},
  'bad member':{'root':{'block/children':[{}]}},
  'duplicate member':{'root':{'block/children':[{'block/uid':'child-a','block/order':0},{'block/uid':'child-a','block/order':1}]}},
  'gap':{'root':{'block/children':[{'block/uid':'child-a','block/order':7}]}},
  'negative':{'root':{'block/children':[{'block/uid':'child-a','block/order':-1}]}},
  'fraction':{'child-a':{'block/order':0.5}},
  'cycle':{'child-a':{'block/children':[{'block/uid':'root','block/order':0}]}},
  'bad parent':{'child-a':{'block/_children':[{'block/uid':'wrong'}]}},
 };
 for(const open of [null,0,1,'false',[],{}])cases[`open ${JSON.stringify(open)}`]={'child-a':{'block/open':open}};
 for(const [name,data] of Object.entries(cases))await t.test(name,()=>assert.throws(()=>fixture(data).build(),/Preview unavailable/));
});
test('missing references are cached and referenced page titles are watched as node/title',()=>{
 const f=fixture({'root':{'block/string':'((missing-1)) ((missing-1)) ((page-source))'}});
 f.nodes.set('page-source',{'block/uid':'page-source','node/title':'Source page','block/children':[]});
 const m=f.build();assert.equal(f.calls.filter(c=>c.uid==='missing-1').length,1);
 assert.ok(m.watchTargets.find(t=>t.uid==='page-source').fields.includes('node/title'));
});
test('task projection bounds repeated reference expansion before assembling an exponential label',()=>{
 const {projectDeskTasks}=require('../src/desk-core');let reads=0;
 const snapshot={'block/uid':'plan','block/string':'[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}',
 'block/children':[{'block/uid':'task','block/string':'{{TODO}} ((branch-0))','block/order':0}]};
 assert.throws(()=>projectDeskTasks(snapshot,'plan',{readString:uid=>{reads++;return `((branch-${Number(uid.slice(7))+1})) `.repeat(256);}}),/projection.*limit/);
 assert.ok(reads<=8);
});

test('strict Desk plan projection rejects raw coerced ordering independently of the shared Plan bridge',()=>{
 const f=fixture({'child-a':{'block/order':'0'}});assert.throws(()=>readDeskPlan(f.api,'root'));
});
