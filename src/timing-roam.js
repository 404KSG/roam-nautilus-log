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

const sidebarOperationQueues = new WeakMap();
const knownSidebarWindows = new WeakMap();
const sidebarWindowCacheRevisions = new WeakMap();
const SIDEBAR_WINDOW_CACHE_TTL_MS = 45 * 60 * 1000;
let latestSidebarIntent = 0;

function sidebarWindowCache(sidebar) {
  let cache = knownSidebarWindows.get(sidebar);
  if (!cache) {
    cache = new Map();
    knownSidebarWindows.set(sidebar, cache);
  }
  return cache;
}

function sidebarWindowCacheRevision(sidebar) {
  return sidebarWindowCacheRevisions.get(sidebar) || 0;
}

function bumpSidebarWindowCacheRevision(sidebar) {
  sidebarWindowCacheRevisions.set(sidebar, sidebarWindowCacheRevision(sidebar) + 1);
}

function rememberSidebarWindows(sidebar, windows) {
  if (!Array.isArray(windows)) return;
  const cache = sidebarWindowCache(sidebar);
  cache.clear();
  const rememberedAt = Date.now();
  for (const entry of windows) {
    const uid = entry?.['block-uid'];
    if (entry?.type === 'block' && typeof uid === 'string' && uid) cache.set(uid, rememberedAt);
  }
  bumpSidebarWindowCacheRevision(sidebar);
}

function rememberSidebarWindow(sidebar, uid) {
  sidebarWindowCache(sidebar).set(uid, Date.now());
  bumpSidebarWindowCacheRevision(sidebar);
}

function forgetSidebarWindow(sidebar, uid) {
  if (sidebarWindowCache(sidebar).delete(uid)) bumpSidebarWindowCacheRevision(sidebar);
}

function hasRecentlyKnownSidebarWindow(sidebar, uid) {
  const knownAt = sidebarWindowCache(sidebar).get(uid);
  if (!Number.isFinite(knownAt) || Date.now() - knownAt > SIDEBAR_WINDOW_CACHE_TTL_MS) {
    forgetSidebarWindow(sidebar, uid);
    return false;
  }
  return true;
}

function blockSidebarWindow(uid, order) {
  const value = { type: 'block', 'block-uid': uid };
  if (Number.isFinite(order)) value.order = order;
  return value;
}

function runSidebarOperation(sidebar, operation) {
  const previous = sidebarOperationQueues.get(sidebar);
  let current;
  if (previous) {
    current = previous.then(operation, operation);
  } else {
    // Start the first native sidebar operation in the user's click stack.
    // Deferring it through Promise.resolve().then() made getWindows visibly
    // trail the Clock In control even before any graph work began.
    try { current = Promise.resolve(operation()); }
    catch (error) { current = Promise.reject(error); }
  }
  sidebarOperationQueues.set(sidebar, current);
  return current.finally(() => {
    if (sidebarOperationQueues.get(sidebar) === current) sidebarOperationQueues.delete(sidebar);
  });
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
  const legacyName = kind === 'create' ? 'createBlock' : kind === 'update' ? 'updateBlock' : 'deleteBlock';
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
  if (rows.length === 0) return {
    pageTitle,
    pageUid: null,
    plan: null,
    rows: [],
    tasks: [],
    reviewTasks: [],
  };
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
    reviewTasks: plan ? timingCore.projectReviewTasks(normalized, plan.uid, fallbackMinutes) : [],
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

export function getFocusedBlockUid() {
  try {
    return api()?.ui?.getFocusedBlock?.()?.['block-uid'] ?? null;
  } catch (_error) {
    return null;
  }
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

export async function deleteGraphBlock(uid) {
  if (!uid) throw new Error('A block UID is required for deletion.');
  const remove = resolveMutation('delete');
  if (!remove) throw new Error('Roam block deletion is unavailable.');
  await remove({ block: { uid } });
  if (readBlockString(uid) !== null) throw new Error('Roam could not confirm the block deletion.');
  return true;
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
  const entries = readAllEntries();
  const confirmed = entries.find((entry) => entry.clockUid === clockUid && entry.running);
  if (!confirmed) throw new Error('Clock In could not be confirmed.');
  return { entry: confirmed, entries };
}

export async function closeClock(entry, now) {
  if (!entry?.running || !entry.clockUid) return false;
  await updateGraphBlock(entry.clockUid, timingCore.formatClockLine(entry.start, now));
  const remaining = readAllEntries().find((candidate) => candidate.clockUid === entry.clockUid && candidate.running);
  if (remaining) throw new Error('Clock Out could not be confirmed.');
  return true;
}

export async function deleteClock(entry) {
  if (!entry?.running || !entry.clockUid) throw new Error('Only the current running CLOCK can be deleted.');
  await deleteGraphBlock(entry.clockUid);
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

export async function openTaskInMainWindow(taskUid) {
  if (!taskUid) throw new Error('This task has no block UID.');
  const openBlock = api()?.ui?.mainWindow?.openBlock;
  if (typeof openBlock !== 'function') throw new Error('Roam main-window navigation is unavailable.');
  await openBlock({ block: { uid: taskUid } });
  return { ok: true };
}

/**
 * Warm the sidebar-window hint after startup without opening or mutating it.
 * A revision guard prevents a slow warmup read from overwriting a newer click.
 */
export function warmRightSidebarWindowCache() {
  const sidebar = api()?.ui?.rightSidebar;
  if (typeof sidebar?.getWindows !== 'function') {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }
  const startingRevision = sidebarWindowCacheRevision(sidebar);
  let windows;
  try { windows = sidebar.getWindows(); }
  catch (error) {
    return Promise.resolve({ ok: false, reason: 'read-failed', error });
  }
  return Promise.resolve(windows).then(
    (resolved) => {
      if (!Array.isArray(resolved)) return { ok: false, reason: 'malformed-read' };
      if (sidebarWindowCacheRevision(sidebar) !== startingRevision) {
        return { ok: false, reason: 'stale-read' };
      }
      rememberSidebarWindows(sidebar, resolved);
      return { ok: true, count: sidebarWindowCache(sidebar).size };
    },
    (error) => ({ ok: false, reason: 'read-failed', error }),
  );
}

/**
 * Open or move the selected Timing Line to order 0 in Roam's native sidebar.
 *
 * Roam remains authoritative: the current window list is read on every queued
 * user intent when available, so closing a window outside the extension never
 * leaves behind a permanent false dedupe marker. A newer rapid switch can
 * supersede an older request before that older request mutates the stack.
 */
export function frontBlockInRightSidebar(taskUid) {
  if (!taskUid) return Promise.resolve({ ok: false, reason: 'missing-uid' });
  const sidebar = api()?.ui?.rightSidebar;
  if (typeof sidebar?.addWindow !== 'function') {
    return Promise.resolve({
      ok: false,
      reason: 'unavailable',
      message: 'Roam right-sidebar block windows are unavailable.',
    });
  }

  const intent = ++latestSidebarIntent;
  const isCurrent = () => intent === latestSidebarIntent;
  const openRequest = (() => {
    try { return Promise.resolve(sidebar.open?.()).catch(() => undefined); }
    catch (_error) { return Promise.resolve(); }
  })();

  const known = hasRecentlyKnownSidebarWindow(sidebar, taskUid);
  let previewPromise = null;
  if (known && typeof sidebar.setWindowOrder === 'function') {
    // Previously confirmed windows can be revealed immediately. The queued
    // getWindows pass below still verifies native state and repairs a window
    // that the user closed outside Nautilus Log.
    try {
      previewPromise = Promise.resolve(sidebar.setWindowOrder({ window: blockSidebarWindow(taskUid, 0) }))
        .then(async () => {
          if (!isCurrent()) return false;
          if (typeof sidebar.expandWindow === 'function') {
            await sidebar.expandWindow({ window: blockSidebarWindow(taskUid) });
          }
          return isCurrent();
        })
        .catch(() => false);
    } catch (_error) {
      previewPromise = Promise.resolve(false);
    }
  }

  return runSidebarOperation(sidebar, async () => {
    if (!isCurrent()) return { ok: false, skipped: true, reason: 'superseded' };
    let windows = null;
    if (typeof sidebar.getWindows === 'function') {
      try { windows = await sidebar.getWindows(); }
      catch (_error) {
        await openRequest;
        try { windows = await sidebar.getWindows(); } catch (_retryError) { windows = null; }
      }
    }
    if (!isCurrent()) return { ok: false, skipped: true, reason: 'superseded' };
    if (Array.isArray(windows)) rememberSidebarWindows(sidebar, windows);

    const existing = Array.isArray(windows) && windows.find((entry) => (
      entry?.type === 'block' && entry?.['block-uid'] === taskUid
    ));
    if (existing) {
      const previewed = previewPromise ? await previewPromise : false;
      if (!isCurrent()) return { ok: false, skipped: true, reason: 'superseded' };
      if (previewed) return { ok: true, deduped: true, reordered: true, previewed: true };
      if (typeof sidebar.setWindowOrder === 'function') {
        await sidebar.setWindowOrder({ window: blockSidebarWindow(taskUid, 0) });
      } else if (Number(existing.order) !== 0) {
        return {
          ok: false,
          reason: 'order-unavailable',
          message: 'Roam could not move the Timing Line sidebar window to the top.',
        };
      }
      if (!isCurrent()) return { ok: false, skipped: true, reason: 'superseded' };
      if (typeof sidebar.expandWindow === 'function') {
        await sidebar.expandWindow({ window: blockSidebarWindow(taskUid) });
      }
      rememberSidebarWindow(sidebar, taskUid);
      return { ok: true, deduped: true, reordered: typeof sidebar.setWindowOrder === 'function' };
    }

    if (previewPromise) {
      const previewed = await previewPromise;
      if (!isCurrent()) return { ok: false, skipped: true, reason: 'superseded' };
      if (previewed) return { ok: true, deduped: true, reordered: true, previewed: true };
      forgetSidebarWindow(sidebar, taskUid);
    }

    if (!Array.isArray(windows) && hasRecentlyKnownSidebarWindow(sidebar, taskUid)) {
      if (typeof sidebar.setWindowOrder === 'function') {
        try {
          await sidebar.setWindowOrder({ window: blockSidebarWindow(taskUid, 0) });
          await sidebar.expandWindow?.({ window: blockSidebarWindow(taskUid) });
          return { ok: true, deduped: true, reordered: true };
        } catch (_error) {
          forgetSidebarWindow(sidebar, taskUid);
        }
      } else {
        return { ok: true, deduped: true };
      }
    }

    await openRequest;
    if (!isCurrent()) return { ok: false, skipped: true, reason: 'superseded' };
    await sidebar.addWindow({ window: blockSidebarWindow(taskUid, 0) });
    rememberSidebarWindow(sidebar, taskUid);
    return { ok: true, added: true };
  }).catch((error) => ({
    ok: false,
    reason: 'sidebar-front-failed',
    message: error?.message || 'Roam could not move the Timing Line to the top of the right sidebar.',
    error,
  }));
}

export async function openTaskInRightSidebar(taskUid) {
  const result = await frontBlockInRightSidebar(taskUid);
  if (!result.ok && !result.skipped) throw new Error(result.message || 'Could not open this task in the right sidebar.');
  return result;
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
