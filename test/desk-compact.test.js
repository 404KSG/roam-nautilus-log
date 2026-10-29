const test = require('node:test');
const assert = require('node:assert/strict');
const { createModernDeskPreviewAdapter, buildDeskFullPreview } = require('../src/desk-preview');
const { projectPull } = require('./pull-projection.cjs');
test('full-route preview stages only eleven child strings; all direct order dependencies remain watched', () => {
  const nodes=new Map(),calls=[];
  const children=Array.from({length:20},(_,order)=>({'block/uid':`log-${order}`,'block/order':order}));
  nodes.set('root',{'block/uid':'root','block/string':'Root','block/order':0,'block/children':children});
  for(const row of children)nodes.set(row['block/uid'],{...row,'block/string':`Log ${row['block/order']}`,'block/children':[]});
  const api={data:{pull(pattern,lookup){calls.push(lookup[1]);return projectPull(pattern,nodes.get(lookup[1])||null,v=>({...nodes.get(v['block/uid']),...v}));}}};
  const adapter=createModernDeskPreviewAdapter(api);
  const model=buildDeskFullPreview({uid:'root',adapter});
  assert.equal(model.rows.length,11);assert.equal(model.more,true);assert.equal(calls.length,12);
  assert.equal(calls.includes('log-19'),false);
  assert.ok(model.watchTargets.find(t=>t.uid==='log-19').fields.includes('block/order'));
  adapter.clear();const searched=buildDeskFullPreview({uid:'root',adapter,search:true});
  assert.match(searched.searchText,/Log 19/);assert.equal(searched.searchIncomplete,false);
});
