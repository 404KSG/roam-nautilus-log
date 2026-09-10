import * as timingCore from './timing-core';
import { graphName } from './graph-context';
import { readBlockTree } from './entry-helpers';
import { blockUidExists, createDailyPage, createGraphBlock, openPrimaryPlan, pageTitleFor,
  readDailyPageUid, readPrimaryPlan, showToast } from './timing-roam';

const PREFIX = 'nautilus-log:today-plan-operation:';
const hostGlobal = () => (typeof window !== 'undefined' ? window : globalThis);
const fault = (code, reason = '') => Object.assign(new Error(reason || code), {code, reason});
const rootUidFor = date => `nautilus-log-plan-${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const props = node => ({open:true, heading:0, 'text-align':'left', 'children-view-type':'bullet', ...node.properties});
const content = node => JSON.stringify({string:node.string, properties:props(node)});
const sourceIdentity = frozen => JSON.stringify({kind:frozen.kind, templateUid:frozen.templateUid, root:frozen.root});

/** Single user-intent owner. Receipts are diagnostics, not locks or recovery queues.
 * Only WebLocks serialize participating tabs; devices/manual writers are outside it.
 */
export function createTodayPlanSession({ extensionAPI, now = () => new Date(), buildComponentString,
  inspectTemplate = () => ({kind:'missing'}), freezeTemplate = () => ({kind:'missing'}),
  readTemplateTree = readBlockTree, trackingEnabled = () => false, readTrackingSnapshot = () => null,
  requestTrackingRefresh, subscribeTracking, notify = showToast } = {}) {
  const host = hostGlobal();
  const settings = extensionAPI?.settings;
  const get = key => settings?.get?.call(settings, key);
  let destroyed = false, initialized = false, operation = null, midnightTimer = null, unsubscribe = null;
  let lastForeground = 0, recovery = null;
  let inspectedTarget = '', inspected = null;
  const listeners = new Set(), intents = new Map(), checks = new Map();
  let state = {status:'checking', targetKey:'', pageTitle:'', pageUid:null, planUid:null, error:null};
  const language = () => {
    try {
      const value = get('language');
      // Diagnostics must still render when the settings store itself fails.
      if (value?.then) Promise.resolve(value).catch(() => {});
      return value === 'zh' ? 'zh' : 'en';
    } catch (_) { return 'en'; }
  };
  const labels = () => timingCore.executionCopy(language()).createToday;
  function getState() {
    const text = labels();
    return {...state, labels:text, language:language(), trackingOn:Boolean(trackingEnabled()),
      message:[state.error ? text[state.error] || text.failed : '', state.reason].filter(Boolean).join(' ')};
  }
  function setState(patch) {
    if (destroyed) return getState();
    const next = {...state,...patch};
    if (Object.keys(next).every(k => next[k] === state[k])) return getState();
    state = next;
    for (const listener of listeners) { try { listener(getState()); } catch (e) { console.error('[Nautilus Log] plan listener',e); } }
    return getState();
  }
  const targetNow = () => {
    const date = new Date(now().getTime()), name = graphName(host), pageTitle = pageTitleFor(date);
    return {date,name,pageTitle,roam:host.roamAlphaAPI,key:`${name}:${pageTitle}`};
  };
  function assertTarget(t, allowDateChange = false) {
    if (destroyed) throw fault('destroyed');
    if (hostGlobal() !== host || host.roamAlphaAPI !== t.roam || graphName(host) !== t.name) throw fault('graphChanged');
    if (!allowDateChange && pageTitleFor(now()) !== t.pageTitle) throw fault('dateChanged');
  }
  const base = t => ({targetKey:t.key,pageTitle:t.pageTitle,pageUid:null,planUid:null,error:null,reason:null,
    outcome:null,templateKind:null,templateUid:null,canResume:false,verifiedCount:null,totalCount:null});
  const key = t => `${PREFIX}${encodeURIComponent(t.name)}:${t.pageTitle}`;
  const readTarget = (t, afterWrite = false) => { assertTarget(t,afterWrite); return readPrimaryPlan(t.date,Number(get('todo-duration')) || 15); };
  const fail = (error, t, announce = false) => {
    if (destroyed || error?.code === 'destroyed' || error?.name === 'AbortError') return getState();
    // Never retain another graph/date's partial projection, or notify a new graph.
    if (error?.code === 'graphChanged') return setState({...base(targetNow()),status:'read-failed',error:'graphChanged'});
    const target = ['dateChanged','dateChangedAfterCreate'].includes(error?.code) ? targetNow() : t || targetNow();
    const result = setState({...base(target),status:'read-failed',error:error.code || 'failed',reason:error.reason || (error.code ? null : error.message)});
    if (announce) { try { assertTarget(target); notify?.(result.message,'warning'); } catch (_) { /* inactive host */ } }
    return result;
  };
  const absent = (t, info) => {
    const check = checks.get(t.key);
    if (check) check.observedPlanUid = null;
    return setState({...base(t),status:['custom','unsupported'].includes(info.kind) ? 'ready-blocked':'ready-absent',
      templateKind:info.kind,templateUid:info.templateUid || null,reason:info.reason || null,
      error:['custom','unsupported'].includes(info.kind) ? 'blocked':null,outcome:['custom','unsupported'].includes(info.kind)?'blocked':null});
  };
  const present = (t,snapshot,outcome = null) => {
    if (state.targetKey === t.key && state.status === 'nav-failed' && state.planUid === snapshot.plan?.uid && !outcome) return getState();
    return setState({...base(t),status:'ready-present',pageUid:snapshot.pageUid,planUid:snapshot.plan.uid,outcome});
  };
  const partial = (t,record,result = {}) => {
    const intent = intents.get(t.key);
    return setState({...base(t),status:'partial',pageUid:record.pageUid,planUid:record.rootUid || record.uid,
      error:'partial',reason:result.reason || null,verifiedCount:result.count ?? 0,totalCount:record.nodes?.length ?? null,
      canResume:Boolean(result.valid && intent?.attempted && intent.id === record.id && !operation && !result.complete)});
  };
  const digest = async value => {
    const crypto = host.crypto || globalThis.crypto;
    if (!crypto?.subtle) throw fault('recordUnavailable','SHA-256 verification is unavailable in this environment.');
    const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('');
  };
  function parseRecord(raw,t) {
    if (raw === undefined || raw === null || raw === '') return null;
    try {
      if (typeof raw !== 'string' || raw.length > 600000) throw Error();
      const r = JSON.parse(raw);
      if (r.version !== 2 || r.graph !== t.name || r.pageTitle !== t.pageTitle || r.rootUid !== rootUidFor(t.date)
        || typeof r.id !== 'string' || !r.id || typeof r.pageUid !== 'string' || !r.pageUid
        || !Array.isArray(r.nodes) || !r.nodes.length || r.nodes.length > 2000) throw Error();
      const seen = new Set(), orders = new Map();
      for (const [index,n] of r.nodes.entries()) {
        if (typeof n.uid !== 'string' || !n.uid || seen.has(n.uid) || !Number.isInteger(n.order) || n.order < 0
          || !/^[a-f0-9]{64}$/.test(n.hash) || (index === 0 ? n.uid !== r.rootUid || n.parentUid !== r.pageUid : !seen.has(n.parentUid))) throw Error();
        if (index && n.order !== (orders.get(n.parentUid) || 0)) throw Error();
        if (index) orders.set(n.parentUid,n.order+1);
        seen.add(n.uid);
      }
      return r;
    } catch (_) { throw fault('recordUnavailable','The creation receipt is corrupt or from an older format. Inspect the reserved daily root; no new copy is allowed.'); }
  }
  async function verify(t,record,intent) {
    assertTarget(t,true);
    const snapshot = readTarget(t,true), root = readTemplateTree(record.rootUid);
    const actual = [];
    const walk = (node,parentUid,order) => { actual.push({...node,parentUid,order}); (node.children || []).forEach((child,i)=>walk(child,node.uid,child.order ?? i)); };
    const rootRow = snapshot.rows.find(row=>row.uid === record.rootUid);
    if (root) walk(root,rootRow?.parentUid,rootRow?.order);
    let count = 0, reason = null;
    const expectedIds = new Set(record.nodes.map(n=>n.uid));
    if (root && (snapshot.pageUid !== record.pageUid || rootRow?.parentUid !== record.pageUid)) reason = 'The created root is not a direct child of the frozen Daily Note.';
    if (actual.length > record.nodes.length) reason = 'The created tree has unexpected blocks.';
    for (const [index,node] of actual.entries()) {
      const expected = record.nodes[index];
      if (!expected || node.uid !== expected.uid || node.parentUid !== expected.parentUid || node.order !== expected.order
        || (intent ? content(node) !== content(intent.nodes[index]) : await digest(content(node)) !== expected.hash)) {
        reason ||= `Created block ${node.uid} has changed text, properties, parent, or order.`;
        break;
      }
      count++;
    }
    assertTarget(t,true);
    const visible = new Set(actual.map(n=>n.uid));
    if (intent?.written && [...intent.written].some(uid=>!visible.has(uid))) reason ||= 'A previously written block is missing or moved.';
    for (const uid of expectedIds) if (!visible.has(uid) && blockUidExists(uid)) reason ||= `Reserved destination UID ${uid} exists outside the verified tree.`;
    if (!reason && intent) actual.forEach(n=>intent.written.add(n.uid));
    return {valid:!reason,complete:!reason && count === record.nodes.length,count,reason,
      snapshot: rootRow ? {...snapshot,plan:rootRow} : snapshot};
  }
  async function save(t,intent) {
    assertTarget(t);
    if (typeof settings?.set !== 'function') throw fault('recordUnavailable');
    const existing = await get(key(t));
    assertTarget(t);
    if (existing && existing !== intent.raw) throw fault('recordUnavailable','Another operation receipt is already present.');
    await settings.set.call(settings,key(t),intent.raw);
    assertTarget(t);
    if (await get(key(t)) !== intent.raw) throw fault('recordUnavailable','The creation receipt could not be read back exactly.');
    assertTarget(t);
  }
  async function clearOwn(t,intent) {
    assertTarget(t,true);
    const current = await get(key(t));
    assertTarget(t,true);
    if (current !== intent.raw) return !current;
    try { await settings.set.call(settings,key(t),''); }
    catch (error) {
      assertTarget(t,true);
      const remaining = await get(key(t));
      assertTarget(t,true);
      if (remaining) throw error;
    }
    assertTarget(t,true);
    if (await get(key(t))) throw fault('recordUnavailable','The completed receipt could not be cleared.');
    assertTarget(t,true);
    return true;
  }
  function project(t,snapshot,receiptChecked = false) {
    assertTarget(t);
    const check = checks.get(t.key);
    if (!receiptChecked && (check?.blocked || check?.pending)) return getState();
    if (snapshot?.status === 'error') return fail(fault('failed'),t);
    const plan = snapshot?.planSnapshot;
    if (!plan || plan.pageTitle !== t.pageTitle || snapshot.status === 'loading') return setState({...base(t),status:'checking'});
    if (plan.plan) return observedPlan(t,plan,false,receiptChecked);
    if (snapshot.status === 'working') return setState({...base(t),status:'checking'});
    if (!inspected || inspectedTarget !== t.key) {inspected = inspectTemplate();inspectedTarget=t.key;}
    return absent(t,inspected);
  }
  const observedPlan = (t,snapshot,authoritative = false,receiptChecked = false) => {
    const uid = snapshot.plan.uid;
    if (receiptChecked) checks.get(t.key).observedPlanUid = uid;
    // A newly discovered reserved root may be another tab's incomplete write.
    // Check its receipt once on this identity transition, never on every tick.
    if (uid === rootUidFor(t.date) && checks.get(t.key)?.observedPlanUid !== uid) return checkReceipt(t,authoritative,uid);
    return present(t,snapshot);
  };
  const projectRead = (t,authoritative,receiptChecked = false) => {
    if (trackingEnabled() && !authoritative) return project(t,readTrackingSnapshot(),receiptChecked);
    const snapshot = readTarget(t);
    return snapshot.plan ? observedPlan(t,snapshot,authoritative,receiptChecked) : absent(t,inspectTemplate());
  };
  function checkReceipt(t,authoritative,observedPlanUid = null) {
    if (state.targetKey !== t.key) setState({...base(t),status:'checking'});
    const prior = checks.get(t.key);
    if (prior?.pending) return prior.pending;
    const check = {observedPlanUid,record:prior?.blocked ? prior.record : null};checks.set(t.key,check);
    // Foreground/explicit checks may revisit an edited template. Ticks do not.
    inspected = null;
    const apply = raw => {
      assertTarget(t);
      if (checks.get(t.key) !== check || state.targetKey !== t.key) return getState();
      // Losing a settings value cannot erase an incomplete receipt already
      // verified in this session. It remains a read-only integrity obligation.
      const record = parseRecord(raw,t) || check.record, intent = intents.get(t.key);
      if (!record && !intent?.attempted) {check.blocked=false;return projectRead(t,authoritative,true);}
      const r = record || intent.record;
      check.record = r;
      check.observedPlanUid = r.rootUid;
      partial(t,r,{reason:'Verifying the recorded operation…'});
      check.blocked=true;
      return verify(t,r,intent?.id === r.id ? intent : null).then(result=>{
        assertTarget(t);
        if (checks.get(t.key) !== check || state.targetKey !== t.key) return getState();
        check.result=result;check.record=r;check.blocked=!result.complete;
        return result.complete ? present(t,result.snapshot) : partial(t,r,result);
      });
    };
    try {
      const raw = get(key(t));
      if (raw?.then) {
        if (check.record) partial(t,check.record,{reason:'Verifying the recorded operation…'});
        else setState({...base(t),status:'checking'});
      }
      const result = raw?.then ? Promise.resolve(raw).then(apply) : apply(raw);
      if (!result?.then) return result;
      check.pending = result.catch(e=>{
        if (checks.get(t.key) !== check || state.targetKey !== t.key) return getState();
        check.blocked=true;
        if (check.record && !['destroyed','graphChanged','dateChanged'].includes(e.code)) return partial(t,check.record,{reason:e.reason || e.message});
        return fail(e,t);
      }).finally(()=>{check.pending=null;});
      return check.pending;
    } catch (e) {
      check.blocked=true;
      if (check.record && !['destroyed','graphChanged','dateChanged'].includes(e.code)) return partial(t,check.record,{reason:e.reason || e.message});
      return fail(e,t);
    }
  }
  function discover({authoritative=false,checkRecord=false} = {}) {
    if (destroyed || operation) return getState();
    let t;
    try {
      t=targetNow();
      const targetChanged = state.targetKey !== t.key;
      if (targetChanged) setState({...base(t),status:'checking'});
      if (targetChanged || authoritative || checkRecord || !checks.has(t.key)) return checkReceipt(t,authoritative);
      if (checks.get(t.key)?.blocked || checks.get(t.key)?.pending) return getState();
      return projectRead(t,authoritative);
    } catch(e) {return fail(e,t);}
  }
  async function openKnown(t,uid,locateMode,keepPartial=false) {
    if (locateMode === 'none') return getState();
    try {
      assertTarget(t);
      await openPrimaryPlan(uid,{sidebar:locateMode==='sidebar',assertActive:()=>assertTarget(t)});
      assertTarget(t);
      if (!keepPartial) setState({status:'ready-present',error:null,reason:null});
    } catch(e) {
      if (e.code === 'dateChanged' && state.outcome === 'created') throw fault('dateChangedAfterCreate');
      if (['destroyed','graphChanged','dateChanged'].includes(e.code)) throw e;
      assertTarget(t);
      if (keepPartial) setState({reason:labels().navFailed});
      else setState({status:'nav-failed',error:'navFailed'});
    }
    return getState();
  }
  async function locateToday({locateMode='main'} = {}) {
    if (destroyed || operation) return getState();
    const t=targetNow();
    try {
      await checkReceipt(t,true);assertTarget(t);
      if (state.status==='partial') {
        if (blockUidExists(state.planUid)) return await openKnown(t,state.planUid,locateMode,true);
        return getState();
      }
      if (state.status==='read-failed') return getState();
      if (state.planUid) return await openKnown(t,state.planUid,locateMode);
      return getState();
    } catch(e) {
      if (state.targetKey === t.key && state.status === 'partial' && !['destroyed','graphChanged','dateChanged'].includes(e.code)) return setState({reason:e.reason || e.message,canResume:false});
      return fail(e,t,true);
    }
  }
  async function openTemplate({locateMode='main'} = {}) {
    const t=targetNow();
    try {
      assertTarget(t);
      const uid = state.targetKey===t.key && state.templateUid || freezeTemplate().templateUid;
      if (!uid) throw fault('failed','No managed template was found on roam/render.');
      await openPrimaryPlan(uid,{sidebar:locateMode==='sidebar',assertActive:()=>assertTarget(t)});
      assertTarget(t);return getState();
    } catch(e) {return fail(e,t,true);}
  }
  async function finish(t,intent,snapshot,mode,outcome) {
    assertTarget(t,true);
    if (intent) {
      if (!await clearOwn(t,intent)) throw fault('recordUnavailable','The operation receipt changed; the verified tree was retained.');
      intents.delete(t.key);
    }
    checks.set(t.key,{blocked:false,observedPlanUid:snapshot.plan.uid});
    if (pageTitleFor(now())!==t.pageTitle) throw fault('dateChangedAfterCreate');
    if (trackingEnabled() && requestTrackingRefresh) {
      try {await requestTrackingRefresh({immediate:true});} catch (_) { /* never clone again for a refresh failure */ }
      assertTarget(t,true);
      if (pageTitleFor(now())!==t.pageTitle) throw fault('dateChangedAfterCreate');
    }
    present(t,snapshot,outcome);
    return openKnown(t,snapshot.plan.uid,mode);
  }
  function allocate(t,root,pageUid,order) {
    const mapping = new Map([[root.uid,rootUidFor(t.date)]]), unique = new Set(mapping.values());
    const reserve = node => {
      if (node!==root) {
        const uid=t.roam?.util?.generateUID?.();
        if (typeof uid!=='string' || !/^[\w-]+$/.test(uid) || unique.has(uid)) throw fault('uidCollision','Destination UID allocation was not unique.');
        unique.add(uid);mapping.set(node.uid,uid);
      }
      node.children.forEach(reserve);
    };
    reserve(root);
    const nodes=[];
    const walk=(node,parentUid,order)=>{
      const uid=mapping.get(node.uid);
      nodes.push({uid,parentUid,order,string:node.string.replace(/\(\(([^()\s]+)\)\)/g,(ref,id)=>mapping.has(id)?`((${mapping.get(id)}))`:ref),properties:props(node)});
      node.children.forEach((child,index)=>walk(child,uid,index));
    };
    walk(root,pageUid,order);
    for(const node of nodes) if(blockUidExists(node.uid)) throw fault('uidCollision');
    return {id:`${rootUidFor(t.date)}:${Date.now()}:${Math.random()}`,uid:rootUidFor(t.date),nodes,written:new Set(),attempted:false};
  }
  async function runLocked(t,frozen,mode,resume,clickError) {
    assertTarget(t);
    const raw = await get(key(t));assertTarget(t);
    const known = checks.get(t.key);
    const record = parseRecord(raw,t) || (known?.blocked ? known.record : null);
    let intent = intents.get(t.key);
    let result;
    if (record || intent?.attempted) {
      const r=record || intent.record;
      try { result=await verify(t,r,intent?.id===r.id ? intent:null); }
      catch (error) {
        assertTarget(t);
        checks.set(t.key,{blocked:true,record:r});
        return partial(t,r,{reason:error.reason || error.message});
      }
      assertTarget(t);
      if(result.complete) return finish(t,intent?.id===r.id ? intent:{raw:JSON.stringify(r)},result.snapshot,mode,'located');
      checks.set(t.key,{blocked:true,result,record:r});
      if(!resume || !intent?.attempted || intent.id!==r.id || !result.valid) return partial(t,r,result);
    } else {
      if (clickError) throw clickError;
      let snapshot=readTarget(t);
      if(snapshot.plan) return finish(t,null,snapshot,mode,'located');
      if (resume) throw fault('resumeUnavailable');
      if (frozen?.error) throw frozen.error;
      if (!frozen) throw fault('templateChanged','The previously located plan disappeared. Check again before creating.');
      if(['unsupported','custom'].includes(frozen.kind)) return absent(t,frozen);
      let root=frozen.root;
      if(frozen.kind==='missing') {
        const info=inspectTemplate();
        if(['custom','unsupported'].includes(info.kind)) return absent(t,info);
        const string=await buildComponentString?.();assertTarget(t);
        if(!timingCore.isNautilusComponent(string)) throw fault('failed','No valid fallback renderer is available.');
        root={uid:'fallback-root',string,properties:{open:true},children:[]};
      }
      if(!root) throw fault('failed','The template tree could not be frozen.');
      if(typeof t.roam?.data?.block?.create!=='function' && typeof t.roam?.createBlock!=='function') throw fault('apiUnavailable');
      let pageUid=readDailyPageUid(t.pageTitle) || t.roam?.util?.dateToPageUid?.(t.date);
      if(!pageUid) throw fault('apiUnavailable');
      const siblings=snapshot.rows.filter(n=>n.parentUid===pageUid).sort((a,b)=>a.order-b.order);
      if (siblings.some((node,index)=>node.order!==index)) throw fault('failed','The Daily Note has unreadable child order.');
      const nextOrder=siblings.length;
      intent=allocate(t,root,pageUid,nextOrder);intents.set(t.key,intent);
      if(sourceIdentity(freezeTemplate())!==sourceIdentity(frozen)) throw fault('templateChanged');
      if(!readDailyPageUid(t.pageTitle)) {
        pageUid=await createDailyPage(t.pageTitle,t.date,()=>assertTarget(t));assertTarget(t);
        if(pageUid!==intent.nodes[0].parentUid) throw fault('failed','Daily Note identity changed.');
      }
      intent.record={version:2,id:intent.id,graph:t.name,pageTitle:t.pageTitle,pageUid,rootUid:intent.uid,
        nodes:await Promise.all(intent.nodes.map(async node=>({uid:node.uid,parentUid:node.parentUid,order:node.order,hash:await digest(content(node))})))};
      assertTarget(t);intent.raw=JSON.stringify(intent.record);
      parseRecord(intent.raw,t); // Validate the generated manifest before trusting it on reload.
      await save(t,intent);
      // Source, date, duplicates and allocations are rechecked AFTER every
      // awaited page/receipt operation, immediately before the first request.
      assertTarget(t);
      snapshot=readTarget(t);
      if(snapshot.plan) {await clearOwn(t,intent);intents.delete(t.key);return finish(t,null,snapshot,mode,'located');}
      for(const node of intent.nodes) if(blockUidExists(node.uid)) throw fault('uidCollision');
      if(sourceIdentity(freezeTemplate())!==sourceIdentity(frozen)) throw fault('templateChanged');
      result={count:0};
    }
    assertTarget(t);
    setState({...base(t),status:'creating',planUid:intent.uid});
    let mutationError = null;
    for(const node of intent.nodes.slice(result.count)) {
      assertTarget(t,intent.attempted);
      if(blockUidExists(node.uid)) break; // a nonparticipating writer: verify, never overwrite
      intent.attempted=true;
      try {
        await createGraphBlock({parentUid:node.parentUid,order:node.uid===intent.uid?'last':node.order,string:node.string,uid:node.uid,properties:node.properties});
        assertTarget(t,true);intent.written.add(node.uid);
      } catch(e) {assertTarget(t,true);mutationError=e;break;}
    }
    assertTarget(t,true);
    result=await verify(t,intent.record,intent);assertTarget(t,true);
    if(!result.complete) {
      result.reason ||= mutationError?.message || 'Some destination blocks are not yet confirmed.';
      checks.set(t.key,{blocked:true,result,record:intent.record});
      if(pageTitleFor(now())!==t.pageTitle) throw fault('dateChangedAfterCreate');
      return partial(t,intent.record,result);
    }
    return finish(t,intent,result.snapshot,mode,'created');
  }
  function captureCreateIntent(t) {
    let frozen, clickError, snapshot;
    try {
      snapshot = readTarget(t);
      if (!snapshot.plan && !intents.get(t.key)?.attempted) {
        try { frozen = freezeTemplate(); } catch (error) { frozen = { error }; }
      }
    } catch (error) { clickError = error; }
    return { frozen, clickError, snapshot };
  }
  function activateToday({ locateMode = 'main', ifPresent = 'locate' } = {}) {
    if (destroyed) return Promise.resolve(getState());
    if (operation) return operation.promise;
    const status = state.status;
    if (status === 'creating' || status === 'checking') return Promise.resolve(getState());
    if (['read-failed', 'ready-blocked', 'partial'].includes(status)) return Promise.resolve(getState());
    if (status === 'nav-failed') return locateToday({ locateMode });
    let t;
    try { t = targetNow(); }
    catch (error) { return Promise.resolve(fail(error)); }
    if (status === 'ready-absent') return ensureForTarget(t, { locateMode });
    const intentCapture = captureCreateIntent(t);
    if (intentCapture.clickError) {
      fail(intentCapture.clickError, t);
      return Promise.resolve(getState());
    }
    if (!intentCapture.snapshot?.plan) return ensureForTarget(t, { locateMode, intentCapture });
    const liveUid = intentCapture.snapshot.plan.uid;
    return Promise.resolve(checkReceipt(t, true)).then(async () => {
      if (destroyed) return getState();
      try { assertTarget(t); }
      catch (error) { return fail(error, t); }
      const next = getState();
      if (['read-failed', 'ready-blocked', 'partial', 'ready-absent', 'checking'].includes(next.status)) {
        return next;
      }
      const runtimeUid = trackingEnabled() ? readTrackingSnapshot()?.planSnapshot?.plan?.uid : next.planUid;
      if (trackingEnabled() && requestTrackingRefresh && (next.planUid !== liveUid || runtimeUid !== next.planUid)) {
        try { await requestTrackingRefresh({ immediate: true, rescanPlan: true }); }
        catch (_) { /* never clone again for a refresh failure */ }
        try { assertTarget(t); }
        catch (error) { return fail(error, t); }
      }
      if (ifPresent === 'keep') return { ...getState(), activation: 'keep' };
      return locateToday({ locateMode });
    });
  }
  function ensureToday({locateMode='main',resume=false} = {}) {
    if (destroyed) return Promise.resolve(getState());
    if (operation) return operation.promise;
    try { return ensureForTarget(targetNow(), { locateMode, resume }); }
    catch (error) { return Promise.resolve(fail(error)); }
  }
  function ensureForTarget(t, {locateMode='main',resume=false,intentCapture} = {}) {
    if(destroyed) return Promise.resolve(getState());
    if(operation) return operation.promise;
    const controller=new AbortController();
    const captured = intentCapture || captureCreateIntent(t);
    const frozen = captured.frozen, clickError = captured.clickError;
    const current={controller,promise:null};operation=current;
    current.promise=Promise.resolve().then(async()=>{
      setState({...base(t),status:'creating'});
      const locks=host.navigator?.locks;
      if(!t.name) throw fault('scopeUnavailable');
      if(typeof locks?.request!=='function') {
        await checkReceipt(t,true);
        if(state.status==='ready-present' || state.status==='nav-failed') return openKnown(t,state.planUid,locateMode);
        if(state.status==='partial') return getState();
        throw fault('lockUnavailable');
      }
      return locks.request(`nautilus-log:today-plan:${encodeURIComponent(t.name)}:${t.pageTitle}`,
        {mode:'exclusive',signal:controller.signal},async()=>{
          try {return await runLocked(t,frozen,locateMode,resume,clickError);}
          catch(e) {
            const intent=intents.get(t.key);
            if(intent && !intent.attempted) {
              try {if(intent.raw) await clearOwn(t,intent);} catch (_) { /* retained receipt fails closed on reload */ }
              intents.delete(t.key);checks.delete(t.key);
            }
            const known = checks.get(t.key);
            const record = intent?.attempted ? intent.record : known?.blocked ? known.record : null;
            if(record && !['destroyed','graphChanged','dateChangedAfterCreate','dateChanged'].includes(e.code)) {
              checks.set(t.key,{blocked:true,record});
              return partial(t,record,{reason:e.reason || e.message});
            }
            throw e;
          }
        });
    }).catch(e=>fail(e,t,true)).finally(()=>{
      if(operation===current) operation=null;
      if(!destroyed && state.targetKey===t.key && state.status==='partial') {
        const check=checks.get(t.key),intent=intents.get(t.key);
        if(check?.result && intent && check.record?.id === intent.id) partial(t,intent.record,check.result);
      }
    });
    return current.promise;
  }
  const clearMidnight=()=>{if(midnightTimer!==null)host.clearTimeout?.(midnightTimer);midnightTimer=null;};
  const recoverDate=()=>{
    discover({checkRecord:true});
    if(destroyed || operation || recovery || !trackingEnabled() || !requestTrackingRefresh) return;
    const t=targetNow();
    if(readTrackingSnapshot()?.planSnapshot?.pageTitle===t.pageTitle) return;
    recovery=Promise.resolve().then(()=>{assertTarget(t);return requestTrackingRefresh({immediate:true});})
      .then(()=>{assertTarget(t);return discover();}).catch(e=>fail(e,t)).finally(()=>{recovery=null;});
  };
  const scheduleMidnight=()=>{
    clearMidnight();if(destroyed)return;
    const d=now(),next=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1);
    midnightTimer=host.setTimeout?.(()=>{recoverDate();scheduleMidnight();},Math.max(50,next-d));
  };
  const foreground=()=>{
    if(destroyed || host.document?.visibilityState==='hidden' || Date.now()-lastForeground<1500)return;
    lastForeground=Date.now();recoverDate();scheduleMidnight();
  };
  function initialize() {
    if(destroyed)return false;
    unsubscribe?.();unsubscribe=subscribeTracking?.(snapshot=>{
      if(destroyed || operation || !trackingEnabled())return;
      try {const t=targetNow();if(state.targetKey!==t.key || !checks.has(t.key))discover();else project(t,snapshot);}catch(e){fail(e);}
    });
    if(!initialized){initialized=true;host.document?.addEventListener?.('visibilitychange',foreground);host.addEventListener?.('focus',foreground);}
    scheduleMidnight();discover({checkRecord:true});return true;
  }
  function destroy(){destroyed=true;operation?.controller.abort();clearMidnight();unsubscribe?.();listeners.clear();intents.clear();
    host.document?.removeEventListener?.('visibilitychange',foreground);host.removeEventListener?.('focus',foreground);}
  return {getState,discover,ensureToday,activateToday,locateToday,openTemplate,initialize,destroy,
    subscribe:listener=>{if(!destroyed)listeners.add(listener);return()=>listeners.delete(listener);}};
}
