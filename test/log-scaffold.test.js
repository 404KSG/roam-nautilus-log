const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { installTestHostLocks } = require('./test-host-locks.cjs');

const delay = () => new Promise((resolve) => setTimeout(resolve, 2));

function createRoamMock() {
  const pages = new Map();
  const blocks = new Map();
  let generated = 0;

  const entity = (uid) => blocks.get(uid)
    || [...pages.entries()].find(([, pageUid]) => pageUid === uid)?.[1]
    || null;

  const childrenOf = (parentUid) => [...blocks.values()]
    .filter((block) => block.parentUid === parentUid)
    .sort((a, b) => Number(a.order) - Number(b.order));

  const pageUidOf = (block) => {
    let current = block;
    while (current?.parentUid) {
      if ([...pages.values()].includes(current.parentUid)) return current.parentUid;
      current = blocks.get(current.parentUid);
    }
    return null;
  };

  const roam = {
    graph: { name: 'scaffold-test-graph', type: 'hosted' },
    user: { uid: () => 'scaffold-user' },
    util: { generateUID: () => `logtest${++generated}` },
    data: {
      pull: (_pattern, lookup) => entity(lookup?.[1]),
      page: {
        create: async ({ page }) => {
          await delay();
          pages.set(page.title, page.uid);
        },
      },
    },
    createBlock: async ({ location, block }) => {
      await delay();
      const parentUid = location['parent-uid'];
      const parentExists = blocks.has(parentUid) || [...pages.values()].includes(parentUid);
      if (!parentExists) throw new Error(`parent ${parentUid} did not exist before child ${block.uid}`);
      blocks.set(block.uid, {
        uid: block.uid,
        string: block.string,
        order: location.order === 'last' ? childrenOf(parentUid).length : location.order,
        parentUid,
      });
    },
    updateBlock: async ({ block }) => {
      await delay();
      const current = blocks.get(block.uid);
      if (!current) throw new Error(`cannot update missing block ${block.uid}`);
      blocks.set(block.uid, { ...current, string: block.string });
    },
    q: (query) => {
      const pageTitle = query.match(/:node\/title "([^"]+)"/)?.[1];
      if (pageTitle && query.includes('pull ?e [:block/uid]')) {
        const uid = pages.get(pageTitle);
        return uid ? [[{ uid }]] : [];
      }

      if (pageTitle && query.includes('clojure.string/includes?')) {
        const pageUid = pages.get(pageTitle);
        const search = query.match(/clojure\.string\/includes\? \?node-string "([^"]*)"/)?.[1] || '';
        return [...blocks.values()]
          .filter((block) => pageUidOf(block) === pageUid)
          .filter((block) => block.string.includes(search))
          .map((block) => [[block][0]]);
      }

      const parentUid = query.match(/\[\?parent :block\/uid "([^"]+)"\]/)?.[1];
      if (parentUid && query.includes(':block/children')) {
        return childrenOf(parentUid).map((block) => [[block][0]]);
      }

      const uid = query.match(/\[\?e :block\/uid "([^"]+)"\]/)?.[1];
      if (uid) {
        const block = blocks.get(uid);
        return block ? [[block]] : [];
      }
      return [];
    },
  };

  return { roam, pages, blocks };
}

const FIXED_TITLE='roam-render-Nautilus-Log', FIXED_SOURCE='roam-render-Nautilus-Log-r2-cljs', FIXED_HEADER=FIXED_SOURCE+'-header';
const FIXED_TEMPLATE='nautilus-log-r2-template', FIXED_RENDER='nautilus-log-r2-template-render';
const expectedRendererSource=()=>`\`\`\`clojure\n ${fs.readFileSync(path.join(__dirname,'../src/component.cljs'),'utf8')} \`\`\``;
const blockFingerprint=f=>crypto.createHash('sha256').update(JSON.stringify([...f.blocks])).digest('hex');
function seedOwnedScaffold(f,{source=false}={}) {
  f.pages.set('roam/render','render-page');f.pages.set('Foreign notes','foreign-page');
  f.blocks.set(FIXED_TITLE,{uid:FIXED_TITLE,string:'Nautilus Log',parentUid:'render-page',order:0});
  f.blocks.set(FIXED_HEADER,{uid:FIXED_HEADER,string:'code',parentUid:FIXED_TITLE,order:0});
  if(source)f.blocks.set(FIXED_SOURCE,{uid:FIXED_SOURCE,string:expectedRendererSource(),parentUid:FIXED_HEADER,order:0});
}
async function loadWithGraph(f, settings = new Map([['language','en']])) {
  global.window={roamAlphaAPI:f.roam,crypto:crypto.webcrypto,dispatchEvent(){}};installTestHostLocks(window);
  const module=await import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname,'../extension.js')).toString('base64')}#scaffold-ownership-${Math.random()}`);
  await module.default.onload({extensionAPI:{settings:{get:key=>settings.get(key),set:async(key,value)=>settings.set(key,value),panel:{create(){}}}}});
  return module;
}

test('template presentation identity follows the managed root and never changes its content',async()=>{
  const f=createRoamMock();seedOwnedScaffold(f,{source:true});
  f.blocks.set('view-template',{uid:'view-template',string:'Nautilus Log [[roam/templates]]',parentUid:FIXED_TITLE,order:1});
  f.blocks.set('view-render',{uid:'view-render',string:`{{[[roam/render]]:((${FIXED_SOURCE}))}}`,parentUid:'view-template',order:0});
  f.blocks.set('fixed-row',{uid:'fixed-row',string:'09:00-10:00 Routine',parentUid:'view-render',order:0});
  f.blocks.set('nested-row',{uid:'nested-row',string:'Preserved detail',parentUid:'fixed-row',order:0});
  const module=await loadWithGraph(f);const before=blockFingerprint(f);
  try {
    assert.deepEqual(module.readManagedTemplateView(),{templateUid:'view-template',renderUid:'view-render'});
    assert.equal(blockFingerprint(f),before);
    f.blocks.get('view-template').string='My routine [[roam/templates]]';
    assert.deepEqual(module.readManagedTemplateView(),{templateUid:'view-template',renderUid:'view-render'});
    f.blocks.get('view-template').parentUid='foreign-page';
    assert.equal(module.readManagedTemplateView(),null);
    assert.equal(f.blocks.get('nested-row').parentUid,'fixed-row');
  } finally {module.default.onunload();delete global.window;}
});

test('source upgrade receipts gate bootstrap and readiness without adding another source',async t=>{
  for(const mode of ['exact-after','different-after','missing-source','foreign-graph'])await t.test(mode,async()=>{
    const f=createRoamMock();seedOwnedScaffold(f,{source:mode!=='missing-source'});
    f.blocks.set(FIXED_TEMPLATE,{uid:FIXED_TEMPLATE,string:'Nautilus Log [[roam/templates]]',parentUid:FIXED_TITLE,order:1});
    f.blocks.set(FIXED_RENDER,{uid:FIXED_RENDER,string:`{{[[roam/render]]:((${FIXED_SOURCE}))}}`,parentUid:FIXED_TEMPLATE,order:0});
    const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
    const receipt={version:1,items:[{id:'source-reservation',graph:mode==='foreign-graph'?'another-graph':'scaffold-test-graph',type:'hosted',user:'scaffold-user',uid:FIXED_SOURCE,kind:'source',revision:2,
      beforeHash:hash('previous release'),afterHash:hash(mode==='different-after'?'different source':expectedRendererSource())}]};
    const settings=new Map([['language','en'],['renderer-source-upgrade-pending',receipt]]),before=blockFingerprint(f);
    const module=await loadWithGraph(f,settings);
    try {
      assert.equal(blockFingerprint(f),before);assert.equal(f.blocks.has('roam-render-Nautilus-Log-r3-cljs'),false);
      assert.equal(window.nautilusLogR2.ready,['exact-after','foreign-graph'].includes(mode));
      assert.equal(settings.get('renderer-source-upgrade-pending').items.length,mode==='exact-after'?0:1);
      if(mode==='missing-source')assert.equal(f.blocks.has(FIXED_SOURCE),false);
    } finally {module.default.onunload();delete global.window;}
  });
});

test('fixed scaffold collisions are rejected before any graph write or readiness claim',async t=>{
  const cases={
    'title text':f=>{f.blocks.get(FIXED_TITLE).string='Personal notes';},
    'title parent':f=>{f.blocks.get(FIXED_TITLE).parentUid='foreign-page';},
    'title with absent render page':f=>{f.pages.delete('roam/render');f.blocks.get(FIXED_TITLE).parentUid='foreign-page';},
    'header parent':f=>{f.blocks.get(FIXED_HEADER).parentUid='foreign-page';},
    'header text with current source':f=>{f.blocks.get(FIXED_HEADER).string='Personal code';},
    'source parent':f=>{f.blocks.get(FIXED_SOURCE).parentUid='foreign-page';},
    'source ancestor':f=>{f.blocks.get(FIXED_TITLE).parentUid='foreign-page';},
    'missing title':f=>{f.blocks.delete(FIXED_TITLE);},
    'missing header':f=>{f.blocks.delete(FIXED_HEADER);},
    'prospective template UID':f=>{f.blocks.set(FIXED_TEMPLATE,{uid:FIXED_TEMPLATE,string:'Personal template',parentUid:'foreign-page',order:0});},
    'prospective render UID':f=>{f.blocks.set(FIXED_RENDER,{uid:FIXED_RENDER,string:'Personal content',parentUid:'foreign-page',order:0});},
  };
  for(const [name,mutate] of Object.entries(cases))await t.test(name,async()=>{
    const f=createRoamMock();seedOwnedScaffold(f,{source:!['title text','title parent','title with absent render page','header parent','prospective template UID','prospective render UID'].includes(name)});mutate(f);
    const before=JSON.stringify({pages:[...f.pages],blocks:[...f.blocks]}),writes=[];
    for(const [owner,key] of [[f.roam,'createBlock'],[f.roam,'updateBlock'],[f.roam.data.page,'create']]){
      const fn=owner[key];owner[key]=async value=>{writes.push([key,value.block?.uid||value.page?.uid]);return fn(value);};
    }
    const module=await loadWithGraph(f);
    try {
      assert.deepEqual(writes,[],name);
      assert.equal(JSON.stringify({pages:[...f.pages],blocks:[...f.blocks]}),before,name);
      assert.notEqual(window.nautilusLogR2?.ready,true,name);
      if(name.includes('source')||name==='missing title'||name==='missing header')assert.throws(()=>module.readRendererSource(),/scaffold|ownership|UID/i);
    } finally {module.default.onunload();delete global.window;}
  });
});

test('scaffold ownership is rechecked after each settled create',async t=>{
  for(const target of [FIXED_TITLE,FIXED_HEADER])await t.test(target,async()=>{
    const f=createRoamMock(),writes=[];f.pages.set('Foreign notes','foreign-page');
    const create=f.roam.createBlock;
    f.roam.createBlock=async payload=>{
      writes.push(payload.block.uid);await create(payload);
      if(payload.block.uid===target)f.blocks.get(target).parentUid='foreign-page';
    };
    const module=await loadWithGraph(f);
    try {
      assert.equal(writes.at(-1),target);
      assert.equal(f.blocks.has(FIXED_SOURCE),false);
      assert.equal(window.nautilusLogR2.ready,false);
      assert.equal(f.blocks.get(target).parentUid,'foreign-page');
    } finally {module.default.onunload();delete global.window;}
  });
});

test('a reserved template collision appearing during installation stops the next write',async()=>{
  const f=createRoamMock(),writes=[];f.pages.set('Foreign notes','foreign-page');
  const create=f.roam.createBlock;
  f.roam.createBlock=async payload=>{
    writes.push(payload.block.uid);await create(payload);
    if(payload.block.uid===FIXED_HEADER)f.blocks.set(FIXED_TEMPLATE,{uid:FIXED_TEMPLATE,string:'Personal block',parentUid:'foreign-page',order:0});
  };
  const module=await loadWithGraph(f);
  try {assert.equal(writes.at(-1),FIXED_HEADER);assert.equal(f.blocks.has(FIXED_SOURCE),false);assert.equal(window.nautilusLogR2.ready,false);}
  finally {module.default.onunload();delete global.window;}
});

test('unreadable renderer page identity is not treated as an absent page',async()=>{
  const f=createRoamMock(),writes=[],query=f.roam.q;
  f.roam.q=q=>q.includes('pull ?e [:block/uid]')?[[{uid:7}]]:query(q);
  const create=f.roam.data.page.create;f.roam.data.page.create=async value=>{writes.push(value);return create(value);};
  const module=await loadWithGraph(f);
  try {assert.deepEqual(writes,[]);assert.equal(f.blocks.size,0);assert.equal(window.nautilusLogR2.ready,false);}
  finally {module.default.onunload();delete global.window;}
});

test('owned current source tolerates legacy siblings and ignores unused deterministic template UIDs',async()=>{
  const f=createRoamMock();seedOwnedScaffold(f,{source:true});
  f.blocks.get(FIXED_SOURCE).order=1;
  f.blocks.set('roam-render-Nautilus-Log-cljs',{uid:'roam-render-Nautilus-Log-cljs',string:'legacy source unchanged',parentUid:FIXED_HEADER,order:0});
  f.blocks.set('custom-template',{uid:'custom-template',string:'Nautilus Log [[roam/templates]]',parentUid:'render-page',order:1});
  f.blocks.set('custom-render',{uid:'custom-render',string:`[[Custom]] {{[[roam/render]]:((${FIXED_SOURCE})) 22 15 5 "" 21}}`,parentUid:'custom-template',order:0});
  for(const uid of [FIXED_TEMPLATE,FIXED_RENDER])f.blocks.set(uid,{uid,string:'Unrelated reserved-looking name',parentUid:'foreign-page',order:0});
  const before=JSON.stringify([...f.blocks]),module=await loadWithGraph(f);
  try {assert.equal(window.nautilusLogR2.ready,true);assert.equal(JSON.stringify([...f.blocks]),before);assert.equal(module.readRendererSource().state,'current');}
  finally {module.default.onunload();delete global.window;}
});

test('renamed owned templates retain their UID and complete content across reloads', async () => {
  const f=createRoamMock();seedOwnedScaffold(f,{source:true});
  f.blocks.set('owned-template',{uid:'owned-template',string:'Nautilus Log [[roam/templates]]',parentUid:FIXED_TITLE,order:1});
  f.blocks.set('owned-render',{uid:'owned-render',string:`[[Routine]] {{[[roam/render]]:((${FIXED_SOURCE})) 24 20 6 "" 20}}`,parentUid:'owned-template',order:0,heading:2,open:false});
  f.blocks.set('owned-child',{uid:'owned-child',string:'{{[[TODO]]}} Example 20m',parentUid:'owned-render',order:0});
  f.blocks.set('owned-note',{uid:'owned-note',string:'Keep this context.',parentUid:'owned-child',order:0,open:false});
  let module=await loadWithGraph(f);
  try {
    module.default.onunload();
    f.blocks.get('owned-template').string='Morning routine [[roam/templates]]';
    const count=f.blocks.size,before=blockFingerprint(f);
    for(let pass=0;pass<2;pass++) {
      module=await loadWithGraph(f);
      assert.equal(f.blocks.size,count,'a renamed owned template must not cause another default template');
      assert.equal(blockFingerprint(f),before);
      assert.equal(window.nautilusLogR2.ready,true);assert.equal(window.nautilusLogR2.error,'');
      const frozen=module.freezeCanonicalTemplate(`{{[[roam/render]]:((${FIXED_SOURCE}))`);
      assert.equal(frozen.kind,'standard');assert.equal(frozen.templateUid,'owned-template');assert.equal(frozen.root.uid,'owned-render');
      assert.equal(frozen.root.children[0].children[0].string,'Keep this context.');
      module.default.onunload();
    }
  } finally {module.default.onunload();delete global.window;}
});

test('owned renamed template conflicts never seed a second template or become missing fallback', async t => {
  for(const mode of ['empty','foreign-root','dynamic-args','extra-sibling','two-roots','two-markers','legacy-coexist'])await t.test(mode,async()=>{
    const f=createRoamMock();seedOwnedScaffold(f,{source:true});
    f.blocks.set('owned-template',{uid:'owned-template',string:'Routine [[roam/templates]]',parentUid:FIXED_TITLE,order:1});
    if(mode!=='empty')f.blocks.set('owned-render',{uid:'owned-render',string:mode==='foreign-root'?'Personal content':mode==='dynamic-args'
      ?`{{[[roam/render]]:((${FIXED_SOURCE})) (inc 1)}}`:`{{[[roam/render]]:((${FIXED_SOURCE}))}}`,parentUid:'owned-template',order:0});
    if(mode==='extra-sibling')f.blocks.set('extra',{uid:'extra',string:'User context',parentUid:'owned-template',order:1});
    if(mode==='two-roots')f.blocks.set('second-root',{uid:'second-root',string:`{{[[roam/render]]:((${FIXED_SOURCE}))}}`,parentUid:'owned-template',order:1});
    if(mode==='two-markers'||mode==='legacy-coexist') {
      f.blocks.set('second-template',{uid:'second-template',string:mode==='two-markers'?'Another [[roam/templates]]':'Nautilus Flow [[roam/templates]]',parentUid:mode==='two-markers'?FIXED_TITLE:'render-page',order:2});
      f.blocks.set('second-render',{uid:'second-render',string:'{{[[roam/render]]:((roam-render-Nautilus-Flow-cljs))}}',parentUid:'second-template',order:0});
    }
    const count=f.blocks.size,before=blockFingerprint(f);let module;
    try {
      module=await loadWithGraph(f);
      assert.equal(f.blocks.size,count,mode);assert.equal(blockFingerprint(f),before,mode);
      assert.equal(module.freezeCanonicalTemplate(`{{[[roam/render]]:((${FIXED_SOURCE}))`).kind,'unsupported',mode);
      assert.ok(window.nautilusLogR2.error,mode);
    } finally {module?.default.onunload();delete global.window;}
  });
});

test('renamed marker ownership rejects a foreign title and inconsistent discovery reads', async () => {
  const f=createRoamMock();seedOwnedScaffold(f,{source:true});
  f.blocks.set('owned-template',{uid:'owned-template',string:'Routine [[roam/templates]]',parentUid:FIXED_TITLE,order:1});
  f.blocks.set('owned-render',{uid:'owned-render',string:`{{[[roam/render]]:((${FIXED_SOURCE}))}}`,parentUid:'owned-template',order:0});
  f.blocks.get(FIXED_TITLE).string='Personal notes';
  const before=blockFingerprint(f);const module=await loadWithGraph(f);
  try {
    assert.equal(window.nautilusLogR2.ready,false);assert.equal(blockFingerprint(f),before);
    assert.throws(()=>module.freezeCanonicalTemplate(`{{[[roam/render]]:((${FIXED_SOURCE}))`),/ownership|parent|content/i);
    f.blocks.get(FIXED_TITLE).string='Nautilus Log';
    const query=f.roam.q;let armed=false;
    f.roam.q=text=>{
      if(armed && text.includes(`[?parent :block/uid "${FIXED_TITLE}"]`) && text.includes(':block/children')) {
        armed=false;f.blocks.get('owned-template').string='Changed label [[roam/templates]]';
      }
      const result=query(text);
      if(text.includes('clojure.string/includes?'))armed=true;
      return result;
    };
    assert.throws(()=>module.freezeCanonicalTemplate(`{{[[roam/render]]:((${FIXED_SOURCE}))`),/changed during discovery/);
    f.roam.q=text=>{
      const rows=query(text);
      return text.includes(`[?parent :block/uid "${FIXED_TITLE}"]`) && text.includes(':block/children')
        ? [...rows,...rows.filter(row=>row[0].uid==='owned-template')] : rows;
    };
    assert.throws(()=>module.freezeCanonicalTemplate(`{{[[roam/render]]:((${FIXED_SOURCE}))`),/changed during discovery/);
    assert.equal(f.blocks.has(FIXED_TEMPLATE),false);assert.equal(f.blocks.has(FIXED_RENDER),false);
  } finally {module.default.onunload();delete global.window;}
});

test('unrelated markers stay foreign while a named empty template can complete its first setup', async () => {
  const f=createRoamMock();seedOwnedScaffold(f,{source:true});
  f.blocks.set('owned-template',{uid:'owned-template',string:'Nautilus Log [[roam/templates]]',parentUid:FIXED_TITLE,order:1});
  f.blocks.set('foreign-title',{uid:'foreign-title',string:'Personal templates',parentUid:'render-page',order:2});
  f.blocks.set('foreign-template',{uid:'foreign-template',string:'Another [[roam/templates]]',parentUid:'foreign-title',order:0});
  f.blocks.set('foreign-child',{uid:'foreign-child',string:'Personal content',parentUid:'foreign-template',order:0});
  f.blocks.set('code-example',{uid:'code-example',string:'Document `[[roam/templates]]` literally',parentUid:FIXED_TITLE,order:2});
  f.blocks.set('example-render',{uid:'example-render',string:`{{[[roam/render]]:((${FIXED_SOURCE}))}}`,parentUid:'code-example',order:0});
  const unrelated=()=>JSON.stringify(['foreign-template','foreign-child','code-example','example-render'].map(uid=>f.blocks.get(uid)));
  const foreign=unrelated();
  const module=await loadWithGraph(f);
  try {
    assert.equal(window.nautilusLogR2.ready,true);assert.equal(window.nautilusLogR2.error,'');
    assert.equal(f.blocks.get(FIXED_RENDER).parentUid,'owned-template');assert.equal(f.blocks.has(FIXED_TEMPLATE),false);
    assert.equal(unrelated(),foreign);
    assert.equal(module.freezeCanonicalTemplate(`{{[[roam/render]]:((${FIXED_SOURCE}))`).templateUid,'owned-template');
  } finally {module.default.onunload();delete global.window;}
});

test('duplicate renderer roots produce a specific diagnostic and an archived empty legacy root stays retired', async () => {
  const f = createRoamMock(); seedOwnedScaffold(f, { source: true });
  const current = `[[Nautilus Log]] {{[[roam/render]]:((${FIXED_SOURCE})) 22 15 6 "" 20}}`;
  f.blocks.set('managed-template', { uid:'managed-template', string:'Nautilus Log [[roam/templates]]', parentUid:FIXED_TITLE, order:1 });
  f.blocks.set('legacy-holder', { uid:'legacy-holder', string:'code · v1', parentUid:FIXED_TITLE, order:2, open:false });
  f.blocks.set('legacy-empty', { uid:'legacy-empty', string:current.replace(FIXED_SOURCE,'roam-render-Nautilus-Log-cljs'), parentUid:'managed-template', order:0 });
  f.blocks.set('current-root', { uid:'current-root', string:current, parentUid:'managed-template', order:1, open:false, heading:2 });
  f.blocks.set('template-task', { uid:'template-task', string:'{{[[TODO]]}} Example work 30m', parentUid:'current-root', order:0 });
  f.blocks.set('template-note', { uid:'template-note', string:'Keep this nested context.', parentUid:'template-task', order:0, open:false });
  const before = JSON.stringify([...f.blocks]);
  let module = await loadWithGraph(f);
  try {
    assert.equal(window.nautilusLogR2.ready, true, 'the current installed renderer remains usable');
    assert.match(window.nautilusLogR2.error, /2 renderer blocks/);
    assert.doesNotMatch(window.nautilusLogR2.error, /newer, custom, or ambiguous/);
    assert.throws(() => module.inspectRendererScaffold(`{{[[roam/render]]:((${FIXED_SOURCE}))`),
      error => error.code === 'templateMultipleRenderers' && error.templateUid === 'managed-template');
    assert.equal(JSON.stringify([...f.blocks]), before, 'diagnosis must not choose, rewrite, or delete a root');
    module.default.onunload();
    // Model an explicit, non-destructive user repair. Startup must not recreate
    // an empty legacy reference that is retained outside the active template.
    f.blocks.get('legacy-empty').parentUid = 'legacy-holder';
    f.blocks.get('current-root').order = 0;
    const repaired = JSON.stringify([...f.blocks]);
    for (let pass = 0; pass < 2; pass++) {
      module = await loadWithGraph(f);
      assert.equal(window.nautilusLogR2.ready, true);
      assert.equal(window.nautilusLogR2.error, '');
      assert.equal(module.freezeCanonicalTemplate(`{{[[roam/render]]:((${FIXED_SOURCE}))`).kind, 'standard');
      assert.equal(JSON.stringify([...f.blocks]), repaired);
      module.default.onunload();
    }
  } finally { module.default.onunload(); delete global.window; }
});

test('built extension creates Log scaffolding sequentially and unload is graph-safe', async (t) => {
  const { roam, pages, blocks } = createRoamMock();
  const dispatchedEvents = [];
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent: (event) => dispatchedEvents.push(event),
  };
  installTestHostLocks(global.window);
  t.after(() => { delete global.window; });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${Date.now()}`;
  const extensionModule = await import(moduleUrl);
  const extension = extensionModule.default;
  const settings = new Map();
  settings.set('language', 'en');
  settings.set('workday-end', 21);
  let latestPanel;
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: (config) => { latestPanel = config; } },
    },
  };

  await extension.onload({ extensionAPI });

  assert.ok(pages.has('roam/render'));
  assert.equal(blocks.get('roam-render-Nautilus-Log').string, 'Nautilus Log');
  assert.match(blocks.get('roam-render-Nautilus-Log-r2-cljs').string, /nautilus-log-r2/);
  assert.equal(window.nautilusLogExtensionData.settings['workday-end'], 21);
  assert.equal(window.nautilusLogExtensionData.settings.language, 'en');

  const shouldSuppressRenderContext = window.nautilusLogExtensionData.shouldSuppressRenderContext;
  const isRightSidebarRenderContext = window.nautilusLogExtensionData.isRightSidebarRenderContext;
  const contextNode = (matchedSelector) => ({
    closest: (selector) => (selector.includes(matchedSelector) ? {} : null),
  });
  assert.equal(typeof shouldSuppressRenderContext, 'function');
  assert.equal(shouldSuppressRenderContext({ closest: () => null }), false);
  assert.equal(shouldSuppressRenderContext(contextNode('.parent-path-wrapper')), true);
  assert.equal(shouldSuppressRenderContext(contextNode('.rm-zoom.zoom-path-view')), true);
  assert.equal(shouldSuppressRenderContext(contextNode('.rm-zoom-item-content.rm-zoom-collapsed-item')), true);
  assert.equal(typeof isRightSidebarRenderContext, 'function');
  assert.equal(isRightSidebarRenderContext({ closest: () => null }), false);
  assert.equal(isRightSidebarRenderContext(contextNode('#roam-right-sidebar-content')), true);

  const languageSetting = latestPanel.settings.find(({ id }) => id === 'language');
  await languageSetting.action.onChange('zh');
  assert.equal(window.nautilusLogExtensionData.settings.language, 'zh');

  const endSetting = latestPanel.settings.find(({ id }) => id === 'workday-end');
  assert.equal(endSetting.action.default, '21:00');
  await endSetting.action.onChange('20:00');
  assert.equal(window.nautilusLogExtensionData.settings['workday-end'], 20);
  assert.ok(dispatchedEvents.some(({ type }) => type === 'nautilus-log:settings-changed'));
  const blockCount = blocks.size;

  await extension.onunload();
  assert.equal(blocks.size, blockCount);
  assert.equal(window.nautilusLogExtensionData.running, false);
  assert.equal(window.nautilusLogR2, undefined);
  assert.equal(typeof window.nautilusLogCore, 'object', 'legacy history keeps a read-only render facade');
});

test('a fresh install defaults the settings panel and rendered UI to English', async (t) => {
  const { roam } = createRoamMock();
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent: () => {},
  };
  installTestHostLocks(global.window);
  t.after(() => { delete global.window; });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#fresh-${Date.now()}`;
  const extensionModule = await import(moduleUrl);
  const extension = extensionModule.default;
  const settings = new Map();
  let latestPanel;
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: (config) => { latestPanel = config; } },
    },
  };

  await extension.onload({ extensionAPI });

  assert.equal(settings.get('language'), 'en');
  assert.equal(settings.get('workday-start'), 5);
  assert.equal(settings.get('workday-end'), 21);
  assert.equal(settings.get('prefix-str'), '[[Nautilus Log]]');
  assert.equal(settings.get('actual-time-tracking'), false);
  assert.equal(settings.get('energy-bar-enabled'), false);
  assert.equal(settings.get('timing-line-sidebar'), true);
  assert.equal(settings.get('recent-retention-minutes'), 45);
  assert.equal(settings.get('forgotten-timer-minutes'), 120);
  assert.equal(window.nautilusLogExtensionData.settings.language, 'en');
  assert.equal(latestPanel.settings.find(({ id }) => id === 'language').action.default, 'en');
  assert.equal(latestPanel.settings.find(({ id }) => id === 'workday-start').name, 'Chart Start Time');
  const startSetting = latestPanel.settings.find(({ id }) => id === 'workday-start');
  const endSetting = latestPanel.settings.find(({ id }) => id === 'workday-end');
  assert.equal(startSetting.action.default, '05:00');
  assert.ok(startSetting.action.items.includes('00:00'));
  assert.ok(startSetting.action.items.includes('09:00'));
  assert.equal(endSetting.action.default, '21:00');
  await startSetting.action.onChange('21:00');
  const overnightEndSetting = latestPanel.settings.find(({ id }) => id === 'workday-end');
  assert.ok(overnightEndSetting.action.items.includes('02:00 · next day'));
  await overnightEndSetting.action.onChange('02:00 · next day');
  assert.equal(settings.get('workday-start'), 21);
  assert.equal(settings.get('workday-end'), 2);
  assert.equal(window.nautilusLogExtensionData.settings['workday-end'], 2);
  const executionEntry = latestPanel.settings.find(({ id }) => id === 'actual-time-tracking');
  assert.equal(executionEntry.name, 'Execution Layer · Advanced');
  assert.match(executionEntry.description, /Enable to reveal execution settings/);
  assert.equal(executionEntry.action.defaultValue, false);
  for (const id of ['energy-bar-enabled', 'timing-line-sidebar', 'pomodoro-minutes', 'recent-retention-minutes', 'forgotten-timer-minutes']) {
    assert.equal(latestPanel.settings.some((setting) => setting.id === id), false);
  }

  settings.set('actual-time-tracking', true);
  const expandedPanel = extensionModule.panelConfig(extensionAPI, 'en');
  const energySetting = expandedPanel.settings.find(({ id }) => id === 'energy-bar-enabled');
  assert.equal(energySetting.name, 'Show capacity as an energy bar');
  assert.match(energySetting.description, /solid reserve/);
  assert.equal(energySetting.action.defaultValue, false);
  await energySetting.action.onChange(true);
  assert.equal(settings.get('energy-bar-enabled'), true);
  assert.equal(window.nautilusLogExtensionData.settings['energy-bar-enabled'], true);
  assert.equal(expandedPanel.settings.find(({ id }) => id === 'timing-line-sidebar').action.defaultValue, true);
  assert.equal(expandedPanel.settings.find(({ id }) => id === 'recent-retention-minutes').action.default, 45);
  assert.equal(expandedPanel.settings.find(({ id }) => id === 'forgotten-timer-minutes').action.default, 120);
  await expandedPanel.settings.find(({ id }) => id === 'recent-retention-minutes').action.onChange({ target: { value: '30' } });
  await expandedPanel.settings.find(({ id }) => id === 'forgotten-timer-minutes').action.onChange({ target: { value: '0' } });
  assert.equal(settings.get('recent-retention-minutes'), 30);
  assert.equal(settings.get('forgotten-timer-minutes'), 0);
  const zhPanel = extensionModule.panelConfig(extensionAPI, 'zh');
  assert.equal(zhPanel.settings.find(({ id }) => id === 'actual-time-tracking').name, '执行层 · 进阶');
  assert.equal(zhPanel.settings.find(({ id }) => id === 'energy-bar-enabled').name, '用精力槽显示剩余容量');
  assert.equal(global.document, undefined);

  await extension.onunload();
});

test('legacy preview installs migrate the old automatic Chinese default once', async (t) => {
  const { roam } = createRoamMock();
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent: () => {},
  };
  installTestHostLocks(global.window);
  t.after(() => { delete global.window; });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#migration-${Date.now()}`;
  const extension = (await import(moduleUrl)).default;
  const settings = new Map([['language', 'zh']]);
  let latestPanel;
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: (config) => { latestPanel = config; } },
    },
  };

  await extension.onload({ extensionAPI });

  assert.equal(settings.get('language'), 'en');
  assert.equal(settings.get('language-default-version'), 'en-v1');
  assert.equal(window.nautilusLogExtensionData.settings.language, 'en');

  await latestPanel.settings.find(({ id }) => id === 'language').action.onChange('zh');
  await extension.onunload();
  await extension.onload({ extensionAPI });

  assert.equal(settings.get('language'), 'zh');
  assert.equal(window.nautilusLogExtensionData.settings.language, 'zh');

  await extension.onunload();
});

test('preview defaults migrate once from an empty prefix and midnight end', async (t) => {
  const { roam } = createRoamMock();
  global.window = { roamAlphaAPI: roam, dispatchEvent: () => {} };
  t.after(() => { delete global.window; });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = (await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#defaults-${Date.now()}`)).default;
  const settings = new Map([
    ['language', 'en'],
    ['language-default-version', 'en-v1'],
    ['prefix-str', ''],
    ['workday-end', 24],
  ]);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: () => {} },
    },
  };
  installTestHostLocks(global.window);

  await extension.onload({ extensionAPI });
  assert.equal(settings.get('prefix-str'), '[[Nautilus Log]]');
  assert.equal(settings.get('workday-end'), 21);
  assert.equal(settings.get('product-defaults-version'), 'timing-v1');
  await extension.onunload();
});

test('a single customized legacy template migrates only its UID and remains stable on reload', async t => {
  const { roam, pages, blocks } = createRoamMock();
  pages.set('roam/render', 'render-page'); pages.set('January 1st, 2000', 'history-page');
  blocks.set('legacy-title', {uid:'legacy-title',string:'Nautilus Flow',parentUid:'render-page',order:0});
  blocks.set('legacy-template', {uid:'legacy-template',string:'Nautilus Flow [[roam/templates]]',parentUid:'legacy-title',order:0});
  const original = '[[log]] {{[[roam/render]]:((roam-render-Nautilus-Flow-cljs)) 28 30 9 "" 2}}';
  blocks.set('template-root', {uid:'template-root',string:original,parentUid:'legacy-template',order:0,open:false,heading:2});
  blocks.set('template-child', {uid:'template-child',string:'Keep my nested context',parentUid:'template-root',order:0});
  blocks.set('history001', {uid:'history001',string:original,parentUid:'history-page',order:0});
  blocks.set('roam-render-Nautilus-Flow-cljs', {uid:'roam-render-Nautilus-Flow-cljs',string:'legacy code stays',parentUid:'legacy-title',order:1});
  const queries=[], query=roam.q;
  roam.q=(...args)=>{queries.push(args[0]);return query(...args)};
  global.window={roamAlphaAPI:roam,dispatchEvent(){}};installTestHostLocks(window);
  t.after(()=>{delete global.window;});
  const source=fs.readFileSync(path.join(__dirname,'../extension.js'));
  const extension=(await import(`data:text/javascript;base64,${source.toString('base64')}#single-legacy-${Math.random()}`)).default;
  const settings=new Map([['language','en'],['language-default-version','en-v1']]);
  const extensionAPI={settings:{get:key=>settings.get(key),set:async(key,value)=>settings.set(key,value),panel:{create(){}}}};
  await extension.onload({extensionAPI});
  assert.equal(blocks.get('template-root').string, original.replace('roam-render-Nautilus-Flow-cljs','roam-render-Nautilus-Log-r2-cljs'));
  assert.equal(blocks.get('template-root').open,false);assert.equal(blocks.get('template-root').heading,2);
  assert.equal(blocks.get('template-child').parentUid,'template-root');
  assert.equal(blocks.get('history001').string,original);
  assert.equal(blocks.get('roam-render-Nautilus-Flow-cljs').string,'legacy code stays');
  assert.equal(settings.get('prefix-str'),'[[log]]');assert.equal(settings.get('workday-start'),9);
  assert.equal(settings.get('renderer-migration-pending').items.length,0);
  assert.ok(!queries.some(value=>value.includes('history001')||value.includes('January 1st, 2000')));
  const count=blocks.size;
  await extension.onunload();await extension.onload({extensionAPI});
  assert.equal(blocks.size,count);assert.equal(window.nautilusLogExtensionData.running,true);
  await extension.onunload();
});

test('ambiguous managed templates remain intact instead of guessing a migration target', async (t) => {
  const { roam, pages, blocks } = createRoamMock();
  pages.set('roam/render', 'render-page');
  pages.set('September 1st, 2026', 'daily-page');

  blocks.set('legacy-title', {
    uid: 'legacy-title',
    string: 'Nautilus Flow',
    order: 0,
    parentUid: 'render-page',
  });
  blocks.set('legacy-template', {
    uid: 'legacy-template',
    string: 'Nautilus Flow [[roam/templates]]',
    order: 0,
    parentUid: 'legacy-title',
  });
  blocks.set('legacy-template-render', {
    uid: 'legacy-template-render',
    string: '[[log]] {{[[roam/render]]:((roam-render-Nautilus-Flow-cljs)) 28 30 9 "" 2}}',
    order: 0,
    parentUid: 'legacy-template',
  });
  blocks.set('legacy-code-header', {
    uid: 'legacy-code-header',
    string: 'code',
    order: 1,
    parentUid: 'legacy-title',
  });
  blocks.set('roam-render-Nautilus-Flow-cljs', {
    uid: 'roam-render-Nautilus-Flow-cljs',
    string: 'old legacy code',
    order: 0,
    parentUid: 'legacy-code-header',
  });
  blocks.set('enhanced-title', {
    uid: 'enhanced-title',
    string: 'Nautilus',
    order: 1,
    parentUid: 'render-page',
  });
  blocks.set('enhanced-template', {
    uid: 'enhanced-template',
    string: 'Nautilus Enhanced [[roam/templates]]',
    order: 0,
    parentUid: 'enhanced-title',
  });
  blocks.set('enhanced-template-render', {
    uid: 'enhanced-template-render',
    string: '[[older-log]] {{[[roam/render]]:((roam-render-Nautilus-cljs)) 20 20 8 "" 24}}',
    order: 0,
    parentUid: 'enhanced-template',
  });

  blocks.set('roam-render-Nautilus-Log', {
    uid: 'roam-render-Nautilus-Log',
    string: 'Nautilus Log',
    order: 1,
    parentUid: 'render-page',
  });
  blocks.set('duplicate-template', {
    uid: 'duplicate-template',
    string: 'Nautilus Log [[roam/templates]]',
    order: 0,
    parentUid: 'roam-render-Nautilus-Log',
  });
  blocks.set('duplicate-template-render', {
    uid: 'duplicate-template-render',
    string: '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs)) 22 15 5 "" 21}}',
    order: 0,
    parentUid: 'duplicate-template',
  });
  blocks.set('current-code-header', {
    uid: 'current-code-header',
    string: 'code',
    order: 1,
    parentUid: 'roam-render-Nautilus-Log',
  });
  blocks.set('roam-render-Nautilus-Log-cljs', {
    uid: 'roam-render-Nautilus-Log-cljs',
    string: 'old code',
    order: 0,
    parentUid: 'current-code-header',
  });
  blocks.set('weekly-title', {
    uid: 'weekly-title',
    string: 'User templates',
    order: 2,
    parentUid: 'render-page',
  });
  blocks.set('weekly-template', {
    uid: 'weekly-template',
    string: 'Weekly Planning [[roam/templates]]',
    order: 0,
    parentUid: 'weekly-title',
  });
  blocks.set('weekly-template-render', {
    uid: 'weekly-template-render',
    string: 'Agenda + {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}',
    order: 0,
    parentUid: 'weekly-template',
  });

  const historicalString = '[[log]] {{[[roam/render]]:((roam-render-Nautilus-Flow-cljs)) 28 30 9 "" 2}}';
  blocks.set('historical-log', {
    uid: 'historical-log',
    string: historicalString,
    order: 0,
    parentUid: 'daily-page',
  });

  global.window = { roamAlphaAPI: roam, dispatchEvent: () => {} };
  t.after(() => { delete global.window; });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#template-reuse-${Date.now()}`;
  const extension = (await import(moduleUrl)).default;
  let latestPanel;
  const settings = new Map([
    ['language', 'en'],
    ['language-default-version', 'en-v1'],
    ['product-defaults-version', 'timing-v1'],
    ['prefix-str', '[[Nautilus Log]]'],
    ['desc-length', 22],
    ['todo-duration', 15],
    ['workday-start', 5],
    ['color-1-trigger', ''],
    ['workday-end', 21],
  ]);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: (config) => { latestPanel = config; } },
    },
  };
  installTestHostLocks(global.window);

  const originalBlocks = structuredClone([...blocks]);
  await extension.onload({ extensionAPI });

  assert.equal(settings.get('prefix-str'), '[[Nautilus Log]]');
  assert.deepEqual([...blocks], originalBlocks, 'ambiguous templates, source code and historical logs must stay intact');
  assert.equal(blocks.has('roam-render-Nautilus-Log-r2-cljs'), false);
  assert.equal(window.nautilusLogR2.ready, false);
  assert.match(window.nautilusLogR2.error, /Multiple managed templates/);
  assert.equal(window.nautilusLogExtensionData.running, true, 'legacy read facade remains available');
  await extension.onunload();
});

test('shorthand migration preserves an existing intentionally empty prefix', async (t) => {
  const { roam, pages, blocks } = createRoamMock();
  pages.set('roam/render', 'render-page');
  blocks.set('legacy-title', {
    uid: 'legacy-title', string: 'Nautilus Flow', order: 0, parentUid: 'render-page',
  });
  blocks.set('legacy-template', {
    uid: 'legacy-template',
    string: 'Nautilus Flow [[roam/templates]]',
    order: 0,
    parentUid: 'legacy-title',
  });
  blocks.set('legacy-template-render', {
    uid: 'legacy-template-render',
    string: '{{[[roam/render]]:((roam-render-Nautilus-Flow-cljs)) 22 15 5 "" 24}}',
    order: 0,
    parentUid: 'legacy-template',
  });
  blocks.set('roam-render-Nautilus-Flow-cljs', {
    uid: 'roam-render-Nautilus-Flow-cljs',
    string: 'old legacy code',
    order: 1,
    parentUid: 'legacy-title',
  });

  global.window = { roamAlphaAPI: roam, dispatchEvent: () => {} };
  t.after(() => { delete global.window; });
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#empty-prefix-${Date.now()}`;
  const extension = (await import(moduleUrl)).default;
  const settings = new Map([
    ['language', 'en'],
    ['language-default-version', 'en-v1'],
  ]);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: () => {} },
    },
  };
  installTestHostLocks(global.window);

  await extension.onload({ extensionAPI });

  assert.equal(settings.get('prefix-str'), '');
  assert.equal(settings.get('workday-end'), 24);
  assert.equal(settings.get('product-defaults-version'), 'timing-v1');
  assert.equal(blocks.get('legacy-template-render').string.startsWith('{{[[roam/render]]'), true);

  await extension.onunload();
});

function createMiniDom() {
  const byId = new Map();
  const node = (tag, className = '') => {
    const element = {
      tagName: String(tag).toUpperCase(),
      className,
      _id: '',
      children: [],
      parentNode: null,
      parentElement: null,
      hidden: false,
      disabled: false,
      style: {},
      dataset: {},
      textContent: '',
      type: '',
      title: '',
      isConnected: true,
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains: () => false,
      },
      setAttribute(name, value) {
        if (name === 'id') element.id = value;
      },
      getAttribute() { return null; },
      removeAttribute() {},
      append(...kids) {
        for (const kid of kids) {
          if (!kid || typeof kid === 'string') continue;
          kid.parentNode = element;
          kid.parentElement = element;
          element.children.push(kid);
        }
      },
      replaceChildren(...kids) {
        element.children = [];
        element.append(...kids);
      },
      addEventListener() {},
      removeEventListener() {},
      contains(candidate) {
        return element === candidate || element.children.some((child) => child === candidate || child.contains?.(candidate));
      },
      remove() {
        if (!element.parentNode) return;
        element.parentNode.children = element.parentNode.children.filter((child) => child !== element);
        element.parentNode = null;
        element.parentElement = null;
        element.isConnected = false;
        if (element.id) byId.delete(element.id);
      },
      insertBefore(child) {
        element.append(child);
        return child;
      },
      querySelector(selector) {
        if (selector?.startsWith('#')) {
          if (element.id === selector.slice(1)) return element;
          for (const child of element.children) {
            const hit = child.querySelector(selector);
            if (hit) return hit;
          }
          return null;
        }
        if (selector?.startsWith('.')) {
          const cls = selector.split(',')[0].trim().slice(1);
          if (String(element.className).includes(cls)) return element;
          for (const child of element.children) {
            const hit = child.querySelector(selector);
            if (hit) return hit;
          }
        }
        return null;
      },
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ left: 10, right: 40, top: 0, bottom: 30, width: 30, height: 30 }),
      closest: () => null,
    };
    Object.defineProperty(element, 'id', {
      get() { return element._id || ''; },
      set(value) {
        if (element._id) byId.delete(element._id);
        element._id = String(value || '');
        if (element._id) byId.set(element._id, element);
      },
    });
    Object.defineProperty(element, 'firstChild', { get() { return element.children[0] || null; } });
    Object.defineProperty(element, 'nextSibling', {
      get() {
        if (!element.parentNode) return null;
        const index = element.parentNode.children.indexOf(element);
        return element.parentNode.children[index + 1] || null;
      },
    });
    return element;
  };
  const topbar = node('div', 'rm-topbar');
  const search = node('div', 'rm-find-or-create-wrapper');
  topbar.append(search);
  const body = node('body', '');
  body.append(topbar);
  const document = {
    body,
    visibilityState: 'visible',
    querySelector(selector) {
      if (selector === '.rm-topbar') return topbar;
      if (selector?.startsWith('#')) return byId.get(selector.slice(1)) || null;
      return topbar.querySelector(selector);
    },
    querySelectorAll: () => [],
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => node(tag, ''),
    addEventListener() {},
    removeEventListener() {},
  };
  return { document, topbar, byId };
}

test('tracking off mounts the lite launcher host and never starts CLOCK queries', async (t) => {
  const { roam } = createRoamMock();
  const queries = [];
  const originalQ = roam.q;
  roam.q = (query, ...args) => {
    queries.push(query);
    return originalQ(query, ...args);
  };
  const { document } = createMiniDom();
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent: () => {},
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  };
  installTestHostLocks(global.window);
  global.document = document;
  global.MutationObserver = class { observe() {} disconnect() {} };
  t.after(() => {
    delete global.window;
    delete global.document;
    delete global.MutationObserver;
  });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = (await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#launcher-${Date.now()}`)).default;
  const settings = new Map();
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: () => {} },
    },
    ui: {
      commandPalette: {
        addCommand() {},
        removeCommand() {},
      },
    },
  };

  await extension.onload({ extensionAPI });
  assert.equal(window.nautilusLogExtensionData.timingEnabled, undefined);
  assert.equal(Boolean(document.getElementById('nautilus-log-timing-topbar')), true);
  assert.equal(queries.some((query) => query.includes('?clock-uid ?clock-string')), false);
  await extension.onunload();
  assert.equal(document.getElementById('nautilus-log-timing-topbar'), null);
});

test('tracking on still starts the timing runtime; unload writes no graph rows', async (t) => {
  const { roam, blocks } = createRoamMock();
  const { document } = createMiniDom();
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent: () => {},
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    requestIdleCallback: (fn) => { fn(); return 1; },
    cancelIdleCallback() {},
  };
  installTestHostLocks(global.window);
  global.document = document;
  global.MutationObserver = class { observe() {} disconnect() {} };
  t.after(() => {
    delete global.window;
    delete global.document;
    delete global.MutationObserver;
  });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = (await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#runtime-${Date.now()}`)).default;
  const settings = new Map([['actual-time-tracking', true]]);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: () => {} },
    },
    ui: {
      commandPalette: {
        addCommand() {},
        removeCommand() {},
      },
    },
  };

  await extension.onload({ extensionAPI });
  assert.equal(window.nautilusLogExtensionData.timingEnabled, true);
  const blockCount = blocks.size;
  await extension.onunload();
  assert.equal(blocks.size, blockCount);
  assert.equal(window.nautilusLogExtensionData.timingEnabled, false);
});

test('switching tracking keeps exactly one topbar and a failed start restores the lite launcher', async (t) => {
  const { roam } = createRoamMock();
  const { document, topbar } = createMiniDom();
  const intervals = new Set();
  let intervalId = 0;
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
    setTimeout: () => 1, clearTimeout() {},
    setInterval: () => { const id = ++intervalId; intervals.add(id); return id; },
    clearInterval: (id) => intervals.delete(id),
    requestIdleCallback: (fn) => { fn(); return 1; }, cancelIdleCallback() {},
  };
  installTestHostLocks(global.window);
  global.document = document;
  global.MutationObserver = class { observe() {} disconnect() {} };
  t.after(() => { delete global.window; delete global.document; delete global.MutationObserver; });
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = (await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#switch-${Date.now()}`)).default;
  const settings = new Map();
  const commands = new Map();
  let panel;
  let failStart = false;
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key), set: async (key, value) => settings.set(key, value),
      panel: { create: (next) => { panel = next; } },
    },
    ui: { commandPalette: {
      addCommand: (command) => {
        if (failStart && command.label.includes('1. Focus')) throw new Error('test start failure');
        commands.set(command.label, command);
      },
      removeCommand: ({ label }) => commands.delete(label),
    } },
  };
  const hostCount = () => topbar.children.filter((node) => node.id === 'nautilus-log-timing-topbar').length;
  const toggle = (enabled) => panel.settings.find((item) => item.id === 'actual-time-tracking').action.onChange(enabled);
  await extension.onload({ extensionAPI });
  assert.equal(hostCount(), 1);
  assert.equal(intervals.size, 0);
  for (const enabled of [true, false, true, false]) {
    await toggle(enabled);
    assert.equal(hostCount(), 1);
    assert.equal(intervals.size, enabled ? 1 : 0);
    assert.equal(commands.has('Nautilus Log: Create or open today’s Daily Note plan'), true);
    assert.equal(commands.has('Nautilus Log: 1. Focus current block'), enabled);
  }
  await toggle(true);
  await Promise.all([toggle(false), toggle(true)]);
  assert.equal(settings.get('actual-time-tracking'), true);
  assert.equal(intervals.size, 1, 'a later enable must not be erased by an earlier pending disable');
  assert.equal(hostCount(), 1);
  await toggle(false);
  failStart = true;
  await assert.rejects(toggle(true), /test start failure/);
  assert.equal(settings.get('actual-time-tracking'), false);
  assert.equal(hostCount(), 1);
  assert.equal(intervals.size, 0);
  await extension.onunload();
  assert.equal(hostCount(), 0);
  assert.equal(commands.size, 0);
});

test('unload during runtime initialization cannot resurrect timers, commands, or topbar', async (t) => {
  const {roam} = createRoamMock();
  const {document, topbar} = createMiniDom();
  const intervals = new Set();
  const commands = new Set();
  let nextInterval = 0;
  global.window = {
    roamAlphaAPI: roam, dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
    setTimeout: () => 1, clearTimeout() {},
    setInterval: () => {const id = ++nextInterval; intervals.add(id); return id;},
    clearInterval: (id) => intervals.delete(id),
  };
  installTestHostLocks(global.window);
  global.document = document;
  global.MutationObserver = class {observe() {} disconnect() {}};
  t.after(() => {delete global.window; delete global.document; delete global.MutationObserver;});
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = (await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#unload-initialize-${Math.random()}`)).default;
  const settings = new Map([['actual-time-tracking', true]]);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key), set: async (key, value) => settings.set(key, value),
      panel: {create() {}},
    },
    ui: {commandPalette: {
      addCommand: ({label}) => commands.add(label), removeCommand: ({label}) => commands.delete(label),
    }},
  };
  const originalQ = roam.q;
  let unload = null;
  roam.q = (query, ...args) => {
    if (!unload && query.includes('?clock-uid ?clock-string')) unload = extension.onunload();
    return originalQ(query, ...args);
  };
  await extension.onload({extensionAPI});
  await unload;
  assert.ok(unload, 'the fixture must interrupt the actual timing initialization');
  assert.equal(intervals.size, 0);
  assert.equal(commands.size, 0);
  assert.equal(topbar.children.filter((node) => node.id === 'nautilus-log-timing-topbar').length, 0);
  assert.equal(window.nautilusLogExtensionData.running, false);
  assert.notEqual(window.nautilusLogExtensionData.timingEnabled, true);
  await extension.onunload();
});

function pageUidOfForTest(blocks, pages, block) {
  let current = block;
  while (current?.parentUid) {
    if ([...pages.values()].includes(current.parentUid)) return current.parentUid;
    current = blocks.get(current.parentUid);
  }
  return null;
}
