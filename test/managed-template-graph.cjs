// Host boundary fixture shared by Node and browser acceptance. No prepared trees.
const CORE = '{{[[roam/render]]:((roam-render-Nautilus-Log-cljs))';
const ROOT = 'nautilus-log-plan-2026-09-09';
const TITLE = 'September 9th, 2026';
const COMPONENT = `[[My day]] ${CORE} 28 25 8 "focus" 22}}`;
function exclusiveLocks() {
  const chains = new Map();
  return { request(name, options, callback) {
    const run = (chains.get(name) || Promise.resolve()).then(() => {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return callback();
    });
    chains.set(name, run.catch(() => {}));
    return run;
  } };
}
function createManagedGraph({ day = true, namespaced = true } = {}) {
  const pages = new Map([['roam/render', 'render-page'], ['Notes', 'notes-page']]);
  const blocks = new Map();
  const trace = [];
  const ids = [];
  let serial = 0;
  const hooks = {};
  const children = (uid) => [...blocks.values()].filter(b => b.parentUid === uid).sort((a,b) => a.order-b.order);
  const pageOf = (b) => {
    const seen = new Set();
    while (b && !seen.has(b.uid)) {
      seen.add(b.uid);
      if ([...pages.values()].includes(b.parentUid)) return b.parentUid;
      b = blocks.get(b.parentUid);
    }
    return null;
  };
  function add(block) {
    if (blocks.has(block.uid) || [...pages.values()].includes(block.uid)) throw Error(`Duplicate UID: ${block.uid}`);
    if (!blocks.has(block.parentUid) && ![...pages.values()].includes(block.parentUid)) throw Error('Missing parent');
    blocks.set(block.uid, { open: true, ...block });
  }
  function pull(b, pattern) {
    if (!b) return null;
    const result = {};
    for (const [key, value] of Object.entries(b)) {
      if (key === 'parentUid') continue;
      const native = key === 'children-view-type' ? 'children/view-type' : `block/${key}`;
      if (pattern.includes('[*]') || pattern.includes(`:${native}`)) result[namespaced ? `:${native}` : key] = value;
    }
    if (pattern.includes(':block/children')) {
      result[namespaced ? ':block/children' : 'children'] = children(b.uid).map(child => pull(child,pattern));
    }
    if (pattern.includes(':block/page')) {
      result[namespaced ? ':block/page' : 'page'] = {':node/title':[...pages].find(([,uid])=>uid===pageOf(b))?.[0]};
    }
    return result;
  }
  const mutate = async ({location, block}) => {
    trace.push(['request', block.uid]);
    await hooks.beforeCreate?.({location, block});
    const parentUid = location['parent-uid'];
    const order = location.order === 'last' ? children(parentUid).length : location.order;
    if (blocks.has(block.uid) || [...pages.values()].includes(block.uid)) throw Error(`Duplicate UID: ${block.uid}`);
    if (!Number.isInteger(order) || order < 0) throw Error('Invalid order');
    children(parentUid).filter(b => b.order >= order).forEach(b => { b.order++; });
    add({...block, parentUid, order});
    trace.push(['create', block.uid]);
    await hooks.afterCreate?.({location, block});
  };
  const roam = {
    graph: {name: 'test-graph'},
    util: { generateUID: () => ids.shift() || `clone-${++serial}`, dateToPageTitle: d => {
      const n = d.getDate();
      const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({1:'st',2:'nd',3:'rd'}[n % 10] || 'th');
      return `${d.toLocaleString('en-US', {month:'long'})} ${n}${suffix}, ${d.getFullYear()}`;
    }, dateToPageUid: d => `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${d.getFullYear()}` },
    q(query, ...args) {
      trace.push(['query', query, ...args]);
      const override = hooks.query?.(query, ...args);
      if (override !== undefined) return override;
      if (query.includes('?clock-uid ?clock-string')) return [...blocks.values()].filter(b=>/^CLOCK:/.test(b.string)).map(b=>{
        const drawer=blocks.get(b.parentUid),task=blocks.get(drawer?.parentUid);
        return [b.uid,b.string,drawer?.string,task?.uid,task?.string,[...pages].find(([,uid])=>uid===pageOf(b))?.[0]];
      });
      if (query.includes('?page-uid ?uid ?string ?order ?parent-uid')) return [...blocks.values()].filter(b => pageOf(b) === pages.get(args[0])).map(b => [pages.get(args[0]), b.uid,b.string,b.order,b.parentUid]);
      if (query.includes(':node/title ?page-title')) return pages.has(args[0]) ? [[pages.get(args[0])]] : [];
      if (query.includes('clojure.string/includes?')) return [...blocks.values()].filter(b => pageOf(b) === 'render-page' && b.string.includes('[[roam/templates]]')).map(b => [pull(b,query)]);
      const title = query.match(/\[\?e :node\/title "([^"]+)"\]/)?.[1];
      if (title) return pages.has(title) ? [[pull({uid:pages.get(title)},query)]] : [];
      const parent = query.match(/\[\?parent :block\/uid "([^"]+)"\]/)?.[1];
      if (parent) return children(parent).map(b => [pull(b,query)]);
      const uid = query.match(/\[\?e :block\/uid "([^"]+)"\]/)?.[1];
      if (uid) return blocks.has(uid) ? [[pull(blocks.get(uid),query)]] : [];
      if (query.includes('[:find ?s')) return blocks.has(args[0]) ? [[blocks.get(args[0]).string]] : [];
      if (query.includes('?parent')) return children(args[0]).map(b => [b.uid,b.string,b.order,b.open]);
      return [];
    },
    data: { pull(pattern, lookup) {
      trace.push(['pull',lookup[1]]);
      return pull(blocks.get(lookup[1]) || ([...pages.values()].includes(lookup[1]) ? {uid: lookup[1]} : null), pattern);
    }, block: {create: mutate}, page: {async create({page}) {
      trace.push(['page-request',page.uid]);
      await hooks.beforePage?.(page);
      if (pages.has(page.title) || blocks.has(page.uid) || [...pages.values()].includes(page.uid)) throw Error('Duplicate page');
      pages.set(page.title,page.uid);
      await hooks.afterPage?.(page);
    }} },
    ui: { mainWindow: {async openBlock({block}) { await hooks.navigate?.(block.uid); trace.push(['open',block.uid]); hooks.afterNavigate?.(block.uid); }}, rightSidebar: {getWindows: () => [], async addWindow({window}) {trace.push(['sidebar',window['block-uid']]);}}, components: {renderToast: toast => trace.push(['toast',toast.content])} },
  };
  add({uid:'template',string:'Nautilus Log [[roam/templates]]',parentUid:'render-page',order:0});
  add({uid:'source-root',string:COMPONENT,parentUid:'template',order:0,heading:2,'text-align':'center','children-view-type':'numbered',open:false});
  add({uid:'source-event',string:'09:00-09:30 Stand-up',parentUid:'source-root',order:0});
  add({uid:'source-task',string:'{{[[TODO]]}} Write 30m ((external-note))',parentUid:'source-root',order:1,heading:1});
  add({uid:'source-step',string:'**First step** ((source-event))',parentUid:'source-task',order:0,open:false,'text-align':'right','children-view-type':'document'});
  add({uid:'source-done',string:'{{[[DONE]]}} Prepared 15m',parentUid:'source-root',order:2});
  add({uid:'source-rule',string:'---',parentUid:'source-root',order:3});
  add({uid:'source-ref',string:'((source-step)) and ((external-note))',parentUid:'source-root',order:4});
  add({uid:'external-note',string:'{{[[TODO]]}} External owner 20m',parentUid:'notes-page',order:0});
  if (day) { pages.set(TITLE,'day'); add({uid:'weekly-tag',string:'#[[2026-W37]]',parentUid:'day',order:0}); }
  const values = new Map([['language','en'],['energy-bar-enabled',true],['todo-duration',15]]);
  const settings = {get(key) { if(this !== settings) throw Error('Unbound get'); return hooks.get ? hooks.get(key,values) : values.get(key); }, async set(key,value) {
    if(this !== settings) throw Error('Unbound set');
    await hooks.beforeSet?.(key,value);
    values.set(key,value);
    await hooks.afterSet?.(key,value);
  }};
  return {roam,pages,blocks,trace,ids,hooks,values,settings,add,children,pageOf};
}
module.exports = {createManagedGraph, exclusiveLocks, CORE, ROOT, TITLE, COMPONENT};
