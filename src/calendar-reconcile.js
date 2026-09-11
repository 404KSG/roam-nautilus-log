import { decideCalendarManagedChange, GOOGLE_CALENDAR_SOURCE_SUFFIX } from './calendar-core';
import { createGraphBlock, deleteGraphBlock, moveGraphBlock, readBlockString, readChildren, updateGraphBlock } from './timing-roam';
import { createGraphWriteGuard } from './graph-write-guard';

const DETAIL_KEYS = ['location', 'description'];
const STATE_VERSION = 2;
const DEFAULT_ORPHAN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const emptyState = () => ({ version:STATE_VERSION, events:{} });
const summaryFor = () => ({ created:0, updated:0, removed:0, localKept:0, skipped:0 });
const managedBlock = (uid,string) => ({uid,lastSynced:String(string ?? '')});
const detailsFor = event => Object.fromEntries(DETAIL_KEYS.map(key => [key,String(event?.details?.[key] ?? '')]));

function normalizeState(value, observedAt) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![1,2].includes(value.version) || !value.events || typeof value.events !== 'object' || Array.isArray(value.events)) {
    throw new Error('Calendar mapping is unreadable. No graph changes are allowed.');
  }
  const events = Object.fromEntries(Object.entries(value.events).map(([key,mapping]) => {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('Calendar mapping contains an unreadable entry.');
    if (mapping.key !== undefined && mapping.key !== key) throw new Error('Calendar mapping identity does not match its key.');
    return [key,{...clone(mapping),key,dateKey:String(mapping.dateKey || ''),
      lastSeenAt:Number.isFinite(Number(mapping.lastSeenAt)) ? Number(mapping.lastSeenAt) : observedAt}];
  }));
  return {version:STATE_VERSION,events,...(value.journalId ? {journalId:value.journalId} : {})};
}

function preserve(summary, deleted = false) {
  summary.localKept++;
  const key = deleted ? 'localDeleted' : 'localChanged';
  summary[key] = (summary[key] || 0) + 1;
}

async function reservedUid(key, role) {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) throw new Error('Calendar sync requires SHA-256 for stable destination identities.');
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([key,role]))));
  return `nl-gcal-${Array.from(bytes.slice(0,16), b=>b.toString(16).padStart(2,'0')).join('')}`;
}

/**
 * A mapping-level lock serializes reads and writes. A separate, small write-ahead
 * journal survives an ambiguous host write or a failed final mapping save. Each
 * entry records exact UIDs and before/after mappings, never a text-based claim.
 */
export function createCalendarReconciler({
  read = readBlockString,
  children = readChildren,
  create = createGraphBlock,
  update = updateGraphBlock,
  remove = deleteGraphBlock,
  move = moveGraphBlock,
  loadState = emptyState,
  saveState = async () => {},
  loadJournal = () => null,
  saveJournal = async () => { throw new Error('Durable Calendar journal storage is unavailable.'); },
  runExclusive,
  now = Date.now,
  orphanRetentionMs = DEFAULT_ORPHAN_RETENTION_MS,
} = {}) {
  const guard = runExclusive ? null : createGraphWriteGuard('calendar-mapping');
  let destroyed = false;

  const syncLocked = async ({ planUid, events, force, signal, assertActive: checkCaller, contextKey }) => {
    const assertActive = () => {
      if (destroyed || signal?.aborted) throw new Error('Calendar sync was cancelled.');
      guard?.assertActive();
      checkCaller?.();
    };
    assertActive();
    if (!planUid) throw new Error('A Nautilus Log Plan UID is required for Calendar sync.');
    const clockValue = Number(now());
    const observedAt = Number.isFinite(clockValue) ? clockValue : Date.now();
    let state, journal = null, key = '', mapping = null, applied = 0, stage = 'load';
    const summary = summaryFor();
    const scope = `${guard?.scope || ''}:${contextKey || ''}`;
    const readText = uid => {
      assertActive();
      const value = read(uid);
      if (value !== null && value !== undefined && typeof value !== 'string') throw new Error('Unreadable Calendar block.');
      return value ?? null;
    };
    const childRows = uid => {
      assertActive();
      const rows = children(uid);
      if (!Array.isArray(rows) || rows.some(row => !row?.uid || typeof row.string !== 'string')) throw new Error('Unreadable Calendar children.');
      return rows;
    };
    const belongs = (uid,parentUid) => readText(parentUid) !== null && childRows(parentUid).some(row=>row.uid===uid);
    const treeKey = uid => {
      const seen = new Set();
      const walk = (id,depth=0) => {
        if (seen.has(id) || seen.size >= 2000 || depth > 64) throw new Error('Calendar subtree exceeds verification limits.');
        seen.add(id);
        const string = readText(id);
        if (string === null) return null;
        return [id,string,childRows(id).map(row=>walk(row.uid,depth+1))];
      };
      return JSON.stringify(walk(uid));
    };
    const persist = async () => {
      assertActive();
      await saveState(clone(state));
      assertActive();
      const saved = normalizeState(await loadState(), observedAt);
      assertActive();
      if (!same(saved,state)) throw new Error('Calendar mapping could not be read back exactly.');
    };
    const persistJournal = async value => {
      assertActive();
      await saveJournal(clone(value));
      assertActive();
      const saved = await loadJournal();
      assertActive();
      if (!same(saved ?? null,value)) throw new Error('Calendar operation record could not be read back exactly.');
      journal = value;
    };
    const putMapping = (eventKey,value) => {
      if (value === null) delete state.events[eventKey];
      else Object.defineProperty(state.events,eventKey,{value:clone(value),writable:true,enumerable:true,configurable:true});
    };
    const afterMatches = op => {
      if (op.kind === 'remove') return readText(op.uid) === null;
      if (op.kind === 'move') return belongs(op.uid,op.parentUid);
      return readText(op.uid) === op.string && (op.kind !== 'create' || belongs(op.uid,op.parentUid));
    };
    const beforeMatches = op => {
      if (op.kind === 'create') return readText(op.uid) === null && readText(op.parentUid) !== null;
      if (op.kind === 'remove') return treeKey(op.uid) === op.beforeTree;
      if (op.kind === 'move') return belongs(op.uid,op.beforeParentUid);
      return readText(op.uid) === op.beforeString;
    };
    const step = async (op,nextMapping) => {
      assertActive();
      stage = op.kind;
      // A deterministic occupied UID without our own pending record is a
      // collision, not evidence that this client may claim or overwrite it.
      if (!beforeMatches(op)) throw new Error(`Calendar ${op.kind} precondition changed for ${op.uid}.`);
      const crypto = globalThis.crypto;
      if (!crypto?.randomUUID) throw new Error('Calendar operation identities are unavailable.');
      const record = {version:1,scope,id:crypto.randomUUID(),key,op:clone(op),beforeEvent:clone(mapping),afterEvent:clone(nextMapping)};
      await persistJournal(record);
      assertActive();
      if (!beforeMatches(op)) throw new Error(`Calendar block ${op.uid} changed while recording the operation.`);
      if (op.kind === 'create') await create({uid:op.uid,parentUid:op.parentUid,order:op.order ?? 'last',string:op.string,open:false});
      else if (op.kind === 'update') await update(op.uid,op.string);
      else if (op.kind === 'move') await move({uid:op.uid,parentUid:op.parentUid,order:op.order});
      else if (op.kind === 'remove') await remove(op.uid);
      assertActive();
      if (!afterMatches(op)) throw new Error(`Calendar ${op.kind} could not be confirmed for ${op.uid}.`);
      applied++;
      mapping = clone(nextMapping);
      putMapping(key,mapping);
    };
    const withField = (path,value) => {
      const next = clone(mapping);
      if (path.startsWith('details.')) {
        const name = path.slice(8);
        next.details ||= {};
        if (value) next.details[name] = value;
        else delete next.details[name];
      } else next[path] = value;
      return next;
    };
    const field = path => path.startsWith('details.') ? mapping.details?.[path.slice(8)] : mapping[path];
    const managed = async (path,parentUid,incoming,{required=false,ensureSource=false}={}) => {
      const owner = field(path);
      const current = owner?.uid ? readText(owner.uid) : null;
      if (!owner?.uid || current === null) {
        if (owner?.uid && !force && !mapping.creating) return {changed:false,localKept:true};
        if (!incoming) return {changed:false,localKept:false};
        const uid = owner?.uid || await reservedUid(key,path);
        assertActive();
        if (readText(uid) !== null) throw new Error(`Reserved Calendar UID ${uid} is occupied; it cannot be claimed without its operation record.`);
        await step({kind:'create',uid,parentUid,string:incoming,order:path==='source'?0:'last'},withField(path,managedBlock(uid,incoming)));
        return {changed:true,localKept:false};
      }
      // A user-moved nested managed field is local structure, even on force.
      if (path !== 'parent' && !belongs(owner.uid,parentUid)) return {changed:false,localKept:true};
      const decision = decideCalendarManagedChange({lastSynced:owner.lastSynced,current,incoming,force});
      if (decision.action === 'update') {
        await step({kind:'update',uid:owner.uid,beforeString:current,string:decision.value},withField(path,managedBlock(owner.uid,decision.value)));
        return {changed:true,localKept:false};
      }
      if (decision.action === 'delete') {
        if (required || childRows(owner.uid).length) return {changed:false,localKept:true};
        await step({kind:'remove',uid:owner.uid,beforeTree:treeKey(owner.uid)},withField(path,null));
        return {changed:true,localKept:false};
      }
      if (decision.action === 'keep-local' && ensureSource && incoming) {
        const suffix = `· ${GOOGLE_CALENDAR_SOURCE_SUFFIX}`;
        const text = current.trimEnd();
        if (!text.endsWith(suffix)) {
          // Preserve the established suffix contract without claiming ownership
          // of the user's edited body by advancing lastSynced.
          await step({kind:'update',uid:owner.uid,beforeString:current,string:`${text} ${suffix}`},mapping);
          return {changed:true,localKept:true};
        }
      }
      return {changed:false,localKept:decision.action==='keep-local'};
    };
    const untouchedTree = () => {
      if (!mapping?.parent?.uid) return false;
      const owned = [mapping.parent,mapping.source,...Object.values(mapping.details || {})].filter(Boolean);
      if (owned.some(node=>readText(node.uid)!==node.lastSynced)) return false;
      const expected = new Set(owned.map(node=>node.uid)), visited = new Set();
      const walk = uid => {
        if (!expected.has(uid) || visited.has(uid)) return false;
        visited.add(uid);
        return childRows(uid).every(row=>walk(row.uid));
      };
      return walk(mapping.parent.uid) && visited.size === expected.size;
    };
    try {
      state = normalizeState(await loadState(),observedAt);
      assertActive();
      journal = await loadJournal();
      assertActive();
      if (journal) {
        stage = 'recovery';
        const op = journal.op;
        const validMapping = value => value && typeof value === 'object' && !Array.isArray(value)
          && value.key === journal.key && typeof value.planUid === 'string'
          && [value.parent,value.source,...Object.values(value.details || {})].filter(Boolean)
            .every(owner=>typeof owner.uid==='string' && typeof owner.lastSynced==='string');
        if (journal.version !== 1 || journal.scope !== scope || typeof journal.id !== 'string'
          || typeof journal.key !== 'string' || typeof op?.uid !== 'string' || !op.uid
          || !['create','update','move','remove'].includes(op.kind)
          || (['create','update'].includes(op.kind) && typeof op.string !== 'string')
          || (['create','move'].includes(op.kind) && typeof op.parentUid !== 'string')
          || (op.kind === 'update' && typeof op.beforeString !== 'string')
          || (op.kind === 'remove' && typeof op.beforeTree !== 'string')
          || !validMapping(journal.beforeEvent)
          || (journal.afterEvent !== null && !validMapping(journal.afterEvent))
          || (journal.afterEvent === null && (op.kind !== 'remove' || journal.beforeEvent.parent?.uid !== op.uid))) {
          throw new Error('Calendar operation record is unreadable or belongs to another connection/graph.');
        }
        key = journal.key;
        if (state.journalId !== journal.id) {
          // Recovery is read-only in the graph. Recognize only the recorded
          // UID's before/after state, commit that progress, then re-plan from
          // this click's current input and force setting.
          if (afterMatches(op)) putMapping(key,journal.afterEvent);
          else if (beforeMatches(op)) putMapping(key,journal.beforeEvent);
          else if (op.kind !== 'create' && readText(op.uid) !== null) {
            // An existing owned block changed during an update/move/delete.
            // Keep its prior ownership metadata and let normal local-edit rules
            // preserve that change; recovery itself never overwrites it.
            putMapping(key,journal.beforeEvent);
          } else throw new Error(`Incomplete Calendar block ${op.uid} was edited or moved. Inspect it before retrying.`);
          state.journalId = journal.id;
          await persist();
        }
        await persistJournal(null);
      }
      for (const event of Array.isArray(events) ? events : []) {
        assertActive();
        if (!event?.key || typeof event.key !== 'string') { summary.skipped++;continue; }
        key = event.key;
        mapping = Object.hasOwn(state.events,key) ? clone(state.events[key]) : null;
        const excluded = event.status === 'cancelled' || event.status === 'excluded';
        const existingParent = mapping?.parent?.uid ? readText(mapping.parent.uid) : null;
        const locallyDeleted = Boolean(mapping?.parent?.uid) && existingParent === null;
        if (excluded) {
          if (!mapping) { summary.skipped++;continue; }
          if (untouchedTree()) {
            await step({kind:'remove',uid:mapping.parent.uid,beforeTree:treeKey(mapping.parent.uid)},null);
            summary.removed++;
          } else if (mapping.creating && !mapping.parent) {
            putMapping(key,null);
            summary.skipped++;
          } else {
            mapping.lastSeenAt = observedAt;
            putMapping(key,mapping);
            preserve(summary,locallyDeleted);
          }
        } else {
          if (typeof event.parentString !== 'string' || !event.parentString || typeof event.sourceString !== 'string' || !event.sourceString) {
            throw new Error('Calendar event content is unreadable.');
          }
          const isNew = !mapping || mapping.creating === true;
          mapping ||= {key,planUid,parent:null,source:null,details:{},creating:true};
          mapping = {...mapping,key,calendarId:event.calendarId,eventId:event.eventId,taskListId:event.taskListId,taskId:event.taskId,
            resourceType:event.resourceType,dateKey:String(event.dateKey || event.dueDate || mapping.dateKey || ''),lastSeenAt:observedAt};
          let changed = false, localKept = false;
          if (mapping.planUid !== planUid) {
            if (!mapping.parent) mapping.planUid = planUid;
            else if (existingParent !== null && (force || existingParent === mapping.parent.lastSynced)
              && belongs(mapping.parent.uid,mapping.planUid)) {
              await step({kind:'move',uid:mapping.parent.uid,beforeParentUid:mapping.planUid,parentUid:planUid,order:childRows(planUid).length}, {...mapping,planUid});
              changed = true;
            } else localKept = true;
          }
          const parent = await managed('parent',mapping.planUid,event.parentString,{required:true,ensureSource:true});
          changed ||= parent.changed; localKept ||= parent.localKept;
          if (mapping.parent?.uid && readText(mapping.parent.uid) !== null) {
            const source = await managed('source',mapping.parent.uid,event.sourceString,{required:true});
            changed ||= source.changed;localKept ||= source.localKept;
            if (mapping.source?.uid && readText(mapping.source.uid) !== null) {
              for (const name of DETAIL_KEYS) {
                const outcome = await managed(`details.${name}`,mapping.source.uid,detailsFor(event)[name]);
                changed ||= outcome.changed;localKept ||= outcome.localKept;
              }
            }
          }
          if (isNew) {
            const complete = mapping.parent?.uid && mapping.source?.uid
              && belongs(mapping.parent.uid,mapping.planUid) && belongs(mapping.source.uid,mapping.parent.uid)
              && Object.values(mapping.details || {}).every(node=>belongs(node.uid,mapping.source.uid));
            if (!complete) throw new Error('The newly imported Calendar tree is incomplete or was moved.');
          }
          if (mapping.parent && mapping.source) delete mapping.creating;
          putMapping(key,mapping);
          if (isNew) summary.created++;
          else if (changed) summary.updated++;
          if (localKept) preserve(summary,locallyDeleted);
          if (!isNew && !changed && !localKept) summary.skipped++;
        }
        if (journal) {
          state.journalId = journal.id;
          await persist();
          await persistJournal(null);
        }
      }
      const retention = Math.max(0,Number(orphanRetentionMs) || DEFAULT_ORPHAN_RETENTION_MS);
      for (const [eventKey,value] of Object.entries(state.events)) {
        // Incomplete creations are integrity obligations, not orphan cache.
        if (value.creating || observedAt - value.lastSeenAt <= retention) continue;
        if (!value.parent?.uid || readText(value.parent.uid) === null) delete state.events[eventKey];
      }
      stage = 'save';
      await persist();
      return summary;
    } catch (error) {
      const failure = new Error(`Calendar sync incomplete; any written blocks were retained. ${error?.message || error}`);
      Object.assign(failure,{incomplete:true,failedKey:key,stage,applied,summary});
      throw failure;
    }
  };
  const sync = (options = {}) => {
    const args = {events:[],force:false,contextKey:'',...options};
    const operation = () => syncLocked(args);
    return runExclusive ? Promise.resolve().then(()=>runExclusive(operation,{signal:args.signal})) : guard.run(operation,{signal:args.signal});
  };
  const destroy = () => { destroyed = true;guard?.destroy(); };
  return {sync,destroy};
}
