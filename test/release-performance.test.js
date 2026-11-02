const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chartPresentationFrame}=require('../src/chart-scene');
const {chartInput,measure}=require('./release-performance-fixtures.cjs');
const baseline=require('./fixtures/release-performance-baseline.json');
const {NAMESPACE}=require('../src/renderer-contract');
let api;
const load=async()=>api||=await import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname,'../extension.js')).toString('base64')}#release-performance`);

test('the production bundle carries one immutable renderer payload',async()=>{
  const bundle=fs.readFileSync(path.join(__dirname,'../extension.js'),'utf8');
  assert.equal(bundle.split(`(ns ${NAMESPACE}`).length-1,1);
  const expected='```clojure\n '+fs.readFileSync(path.join(__dirname,'../src/component.cljs'),'utf8')+' ```';
  const title={uid:'roam-render-Nautilus-Log',string:'Nautilus Log'};
  const header={uid:'roam-render-Nautilus-Log-r2-cljs-header',string:'code'};
  const source={uid:'roam-render-Nautilus-Log-r2-cljs',string:expected};
  const entities=new Map([title,header,source].map(row=>[row.uid,row]));
  const children=new Map([['render-page',[title]],[title.uid,[header]],[header.uid,[source]]]);
  const previousWindow=global.window;
  global.window={roamAlphaAPI:{data:{pull:(_pattern,lookup)=>entities.get(lookup[1])||null},q:query=>{
    if(query.includes(':node/title'))return [[{uid:'render-page'}]];
    const parent=/\[\?parent :block\/uid "([^"]+)"\]/.exec(query)?.[1];
    return (children.get(parent)||[]).map(row=>[row]);
  }}};
  try{
    const {readRendererSource}=await load();
    assert.equal(readRendererSource().state,'current','exact published body and fence whitespace remain valid');
    assert.equal(readRendererSource().state,'current','cached construction keeps the same source contract');
    source.string+=' ';
    assert.equal(readRendererSource().state,'mismatch','caching source text must not cache graph verification');
  }finally{if(previousWindow===undefined)delete global.window;else global.window=previousWindow;}
});

for(const fixture of baseline.scenarios)test(`layout output remains exact for ${fixture.count} rows at ${fixture.width}px`,()=>{
  const frame=chartPresentationFrame({...chartInput(fixture.count,fixture.width),measure});
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(frame)).digest('hex'),fixture.sha256);
});

test('one layout avoids repeated calls for the same deterministic text width',()=>{
  const calls=new Map();
  chartPresentationFrame({...chartInput(100),measure:text=>{calls.set(text,(calls.get(text)||0)+1);return measure(text);}});
  assert.ok(calls.size>100,'exercise unique labels and wrapped substrings');
  assert.ok([...calls.values()].every(count=>count===1),'repeat width requests should share the same-frame result');
});

test('width results do not survive into a later font or frame',()=>{
  const filename=require.resolve('../src/chart-scene'),cached=require.cache[filename],document=global.document;
  let scale=1;
  const context={font:'',measureText(text){const size=Number(/(\d+(?:\.\d+)?)px/.exec(this.font)[1]);return {width:text.length*size*.5*scale*(this.font.includes('FamilyB')?2:1)};}};
  global.document={createElement:()=>({getContext:()=>context})};delete require.cache[filename];
  try{
    const {chartPresentationFrame:frame}=require(filename),item={uid:'a',description:'Word',todo:true,start:600,end:630};
    const input={containerWidth:720,items:[item],events:[item],font:'500 13px FamilyA'};
    assert.equal(frame(input).labels[0].inkWidth,26);
    scale=2;assert.equal(frame(input).labels[0].inkWidth,52,'same font string after a font-loading change must be measured again');
    scale=1;assert.equal(frame({...input,font:'500 13px FamilyB'}).labels[0].inkWidth,52);
  }finally{global.document=document;delete require.cache[filename];if(cached)require.cache[filename]=cached;}
});

test('a cold CLOCK batch reads each entry owner once and preserves owner/entry order',async()=>{
  const {createRendererClockReader}=await load();let visits=0,reads=0;
  const owners=Array.from({length:100},(_,i)=>`owner-${i}`);
  const entries=Array.from({length:1000},(_,i)=>({clockUid:`clock-${i}`,get taskUid(){visits++;return owners[i%owners.length];}}));
  const reader=createRendererClockReader({getScope:()=>['provider','graph'],read:()=>{reads++;return entries;}});
  const output=reader.readContext(owners);
  assert.equal(reads,1);assert.equal(visits,entries.length);
  assert.equal(output.entries.length,entries.length);assert.deepEqual(output.readableTaskUids,owners);
  assert.deepEqual(output.entries.slice(0,10).map(row=>row.clockUid),Array.from({length:10},(_,i)=>`clock-${i*100}`));
  reader.readContext(owners);assert.equal(reads,1,'warm reads keep the existing cache policy');assert.equal(visits,entries.length);
});

test('a malformed CLOCK batch never partially certifies missing owners as readable',async()=>{
  const {createRendererClockReader}=await load();let bad=true;
  const reader=createRendererClockReader({getScope:()=>['provider','graph'],read:()=>bad?[{taskUid:'a'},null]:[{taskUid:'a',clockUid:'clock-a'},{taskUid:'foreign',clockUid:'other'}]});
  const debug=console.debug;console.debug=()=>{};
  try {assert.deepEqual(reader.readContext(['a','b']),{entries:[],readableTaskUids:[]});assert.equal(reader.size(),0);}
  finally{console.debug=debug;}
  bad=false;
  assert.deepEqual(reader.readContext(['b','a','b']),{entries:[{taskUid:'a',clockUid:'clock-a'}],readableTaskUids:['b','a']});
});
