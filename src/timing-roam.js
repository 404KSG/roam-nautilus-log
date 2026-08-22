import * as timingCore from './timing-core';

const DRAWER_LABEL = 'LOGBOOK::';
const DRAWER_RE = /^\s*:?LOGBOOK:{1,2}\s*$/i;
const DRAWER_SHAPES = [
  { prefix: '', suffix: '::' },
  { prefix: '', suffix: ':' },
  { prefix: ':', suffix: ':' },
  { prefix: ':', suffix: '::' },
];
const DRAWER_PADDING = ['', ' ', '  ', '\t'];
const DRAWER_CASES = ['LOGBOOK', 'logbook', 'Logbook', 'LogBook'];
const DRAWER_QUERY_STRINGS = Object.freeze(
  DRAWER_SHAPES.flatMap(({ prefix, suffix }) => DRAWER_CASES.flatMap((word) => (
    DRAWER_PADDING.flatMap((leading) => DRAWER_PADDING.map((trailing) => `${leading}${prefix}${word}${suffix}${trailing}`))
  ))),
);

const DAILY_PAGE_TREE_QUERY = `[:find ?page-uid ?uid ?string ?order ?parent-uid
  :in $ ?page-title
  :where
  [?page :node/title ?page-title]
  [?page :block/uid ?page-uid]
  [?block :block/page ?page]
  [?block :block/uid ?uid]
  [?block :block/string ?string]
  [?block :block/order ?order]
  [?parent :block/children ?block]
  [?parent :block/uid ?parent-uid]]`;

const ENTRIES_QUERY = `[:find ?clock-uid ?clock-string ?drawer-string ?task-uid ?task-string ?page-title
  :in $ [?drawer-string ...]
  :where
  [?d :block/string ?drawer-string]
  [?d :block/children ?c]
  [?c :block/uid ?clock-uid]
  [?c :block/string ?clock-string]
  [?t :block/children ?d]
  [?t :block/uid ?task-uid]
  [(get-else $ ?t :block/string "") ?task-string]
  [(get-else $ ?t :block/page "") ?p]
  [(get-else $ ?p :node/title "") ?page-title]]`;

function api() {
  return typeof window !== 'undefined' ? window.roamAlphaAPI : null;
}

function normalizeSequence(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || typeof value === 'string') return null;
  try {
    if (typeof value[Symbol.iterator] === 'function') return [...value];
  } catch (_error) {
    // Fall through to array-like values.
  }
  if (Number.isInteger(value?.length) && value.length >= 0) return Array.from(value);
  return null;
}

function query(datalog, ...args) {
  const roam = api();
  const run = roam?.data?.fast?.q || roam?.q || roam?.data?.q;
  if (typeof run !== 'function') throw new Error('Roam graph query is unavailable.');
  const owner = run === roam?.data?.fast?.q ? roam.data.fast : run === roam?.data?.q ? roam.data : roam;
  const rows = normalizeSequence(run.call(owner, datalog, ...args));
  if (!rows) throw new Error('Roam returned an unreadable graph result.');
  return rows.map((row) => normalizeSequence(row) || []);
}

function resolveMutation(kind) {
  const roam = api();
  const modern = roam?.data?.block?.[kind];
  if (typeof modern === 'function') return modern.bind(roam.data.block);
  const legacyName = kind === 'create' ? 'createBlock' : 'updateBlock';
  return typeof roam?.[legacyName] === 'function' ? roam[legacyName].bind(roam) : null;
}

function generateUid() {
  return api()?.util?.generateUID?.() || Math.random().toString(36).slice(2, 11);
}

function pageTitleFor(date = new Date()) {
  const fromRoam = api()?.util?.dateToPageTitle?.(date);
  if (typeof fromRoam === 'string' && fromRoam) return fromRoam;
  const month = date.toLocaleString('en-US', { month: 'long' });
  const day = date.getDate();
  const ordinal = day % 10 === 1 && day % 100 !== 11
    ? 'st'
    : day % 10 === 2 && day % 100 !== 12
      ? 'nd'
      : day % 10 === 3 && day % 100 !== 13 ? 'rd' : 'th';
  return `${month} ${day}${ordinal}, ${date.getFullYear()}`;
}

export function readPrimaryPlan(date = new Date(), fallbackMinutes = 15) {
  const pageTitle = pageTitleFor(date);
  const rows = query(DAILY_PAGE_TREE_QUERY, pageTitle);
  if (rows.length === 0) return { pageTitle, pageUid: null, plan: null, rows: [], tasks: [] };
  const normalized = rows.map(([pageUid, uid, string, order, parentUid]) => ({
    pageUid,
    uid,
    string,
    order,
    parentUid,
  })).filter((row) => row.pageUid && row.uid && typeof row.string === 'string' && row.parentUid);
  const pageUid = normalized[0]?.pageUid || null;
  const plan = timingCore.selectPrimaryPlan(normalized, pageUid);
  return {
    pageTitle,
    pageUid,
    plan,
    rows: normalized,
    tasks: plan ? timingCore.projectPlan(normalized, plan.uid, fallbackMinutes) : [],
  };
}

export function readAllEntries() {
  return query(ENTRIES_QUERY, DRAWER_QUERY_STRINGS)
    .map(([clockUid, clockString, drawerString, taskUid, taskString, pageTitle]) => {
      if (!DRAWER_RE.test(String(drawerString || ''))) return null;
      const parsed = timingCore.parseClockLine(clockString);
      if (!parsed || !clockUid || !taskUid) return null;
      return {
        ...parsed,
        clockUid,
        taskUid,
        taskString: typeof taskString === 'string' ? taskString : '',
        title: timingCore.taskTitle(taskString),
        status: timingCore.taskStatus(taskString),
        pageTitle: typeof pageTitle === 'string' ? pageTitle : '',
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.start.getTime() - left.start.getTime());
}

export function readBlockString(uid) {
  if (!uid) return null;
  const roam = api();
  const pull = roam?.data?.pull || roam?.pull;
  if (typeof pull === 'function') {
    const owner = pull === roam?.data?.pull ? roam.data : roam;
    try {
      const entity = pull.call(owner, '[:block/string]', [':block/uid', uid]);
      const value = entity?.[':block/string'] ?? entity?.string ?? entity?.['block/string'];
      if (typeof value === 'string') return value;
    } catch (_error) {
      // Fall back to an indexed query.
    }
  }
  const rows = query('[:find ?s :in $ ?uid :where [?b :block/uid ?uid] [?b :block/string ?s]]', uid);
  return typeof rows[0]?.[0] === 'string' ? rows[0][0] : null;
}

export function readChildren(uid) {
  if (!uid) return [];
  return query(`[:find ?uid ?string ?order
    :in $ ?parent
    :where
    [?p :block/uid ?parent]
    [?p :block/children ?c]
    [?c :block/uid ?uid]
    [?c :block/string ?string]
    [?c :block/order ?order]]`, uid)
    .map(([childUid, string, order]) => ({ uid: childUid, string, order }))
    .filter((child) => child.uid && typeof child.string === 'string')
    .sort((left, right) => left.order - right.order);
}

export async function createGraphBlock({ parentUid, order = 'last', string, open = false }) {
  const create = resolveMutation('create');
  if (!create) throw new Error('Roam block creation is unavailable.');
  const uid = generateUid();
  await create({ location: { 'parent-uid': parentUid, order }, block: { uid, string, open } });
  return uid;
}

export async function updateGraphBlock(uid, string) {
  const update = resolveMutation('update');
  if (!update) throw new Error('Roam block update is unavailable.');
  await update({ block: { uid, string } });
}

export async function ensureDrawer(taskUid) {
  const existing = readChildren(taskUid).find((child) => DRAWER_RE.test(child.string));
  if (existing) return existing.uid;
  const uid = await createGraphBlock({ parentUid: taskUid, order: 0, string: DRAWER_LABEL, open: false });
  const confirmed = readChildren(taskUid).find((child) => child.uid === uid && DRAWER_RE.test(child.string));
  if (!confirmed) throw new Error('LOGBOOK drawer creation could not be confirmed.');
  return uid;
}

export async function createRunningClock(taskUid, now) {
  const drawerUid = await ensureDrawer(taskUid);
  const clockUid = await createGraphBlock({
    parentUid: drawerUid,
    order: 0,
    string: timingCore.formatClockLine(now),
    open: false,
  });
  const confirmed = readAllEntries().find((entry) => entry.clockUid === clockUid && entry.running);
  if (!confirmed) throw new Error('Clock In could not be confirmed.');
  return confirmed;
}

export async function closeClock(entry, now) {
  if (!entry?.running || !entry.clockUid) return false;
  await updateGraphBlock(entry.clockUid, timingCore.formatClockLine(entry.start, now));
  const remaining = readAllEntries().find((candidate) => candidate.clockUid === entry.clockUid && candidate.running);
  if (remaining) throw new Error('Clock Out could not be confirmed.');
  return true;
}

export async function completeTask(taskUid) {
  const before = readBlockString(taskUid);
  if (timingCore.taskStatus(before) !== 'TODO') throw new Error('Only unfinished TODO tasks can be completed.');
  const after = before.replace(/\{\{\[\[TODO\]\]\}\}|\{\{TODO\}\}/i, '{{[[DONE]]}}');
  await updateGraphBlock(taskUid, after);
  if (timingCore.taskStatus(readBlockString(taskUid)) !== 'DONE') {
    throw new Error('Task completion could not be confirmed.');
  }
  return true;
}

export async function openPrimaryPlan(planUid) {
  if (!planUid) throw new Error('No Primary Nautilus Log was found today.');
  const openBlock = api()?.ui?.mainWindow?.openBlock;
  if (typeof openBlock !== 'function') throw new Error('Roam main-window navigation is unavailable.');
  await openBlock({ block: { uid: planUid } });
  window.setTimeout?.(() => {
    const node = document.querySelector?.(`[data-uid="${planUid}"]`);
    node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    node?.classList?.add('nautilus-log-timing__located');
    window.setTimeout?.(() => node?.classList?.remove('nautilus-log-timing__located'), 1200);
  }, 80);
}

export function legacyLogbookIsRunning() {
  if (typeof document !== 'undefined' && document.querySelector?.('#roam-logbook-topbar, .rlb-topbar')) return true;
  return Boolean(window.roamLogbookExtensionData?.running || window.roamLogbook?.running);
}

export function showToast(message, intent = 'warning') {
  const renderToast = api()?.ui?.components?.renderToast;
  if (typeof renderToast === 'function') {
    renderToast({ id: `nautilus-log-${Date.now()}`, content: message, intent, timeout: 5000 });
  } else {
    console[intent === 'danger' ? 'error' : 'warn'](`[Nautilus Log] ${message}`);
  }
}

export { pageTitleFor };
