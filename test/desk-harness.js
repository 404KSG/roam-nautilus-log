// Production Desk, action guard, watch bridge and read/write adapters.
// Only the underlying graph and native editor are stand-ins; never a live graph.
import { createDeskView } from '../src/desk-view';
import { createDeskActions } from '../src/desk-actions';
import { createPlanWatchBridge } from '../src/plan-watch';
import { readBlockString, readChildren } from '../src/timing-roam';

let cleanup = () => {};
function mount({ count = 8, dark = false, editor = true, empty = false, preservePreferences = false, collapsed = false } = {}) {
  cleanup();
  if (!preservePreferences) for (const key of Object.keys(localStorage)) if (key.startsWith('nautilus-log:desk-view:v1:desk-fixture:')) localStorage.removeItem(key);
  document.body.classList.toggle('bp3-dark', dark);
  document.querySelector('#launchers').replaceChildren();
  const nodes = new Map(), watches = new Set(), nativeEditors = new Set(), hosts = new Map();
  const stats = { renders: [], unmounts: 0, forbiddenWrites: 0, nativeWrites: [], writes: [], reads: [], watches: 0, opened: [] };
  let failPlan = false, failRender = false, holdRender = false, holdMove = false, holdCreate = false, failMove = false;
  let releaseRender = null, releaseMove = null, releaseCreate = null;
  let sequence = 0;
  const planUid = 'plan-desk';
  const rendererString = '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}';
  const add = (uid, string, parentUid = '', order = 0, open = true) => nodes.set(uid, { uid, string, parentUid, order, open });
  const children = (uid) => [...nodes.values()].filter((n) => n.parentUid === uid).sort((a, b) => a.order - b.order);
  add(planUid, rendererString); add('other-plan', rendererString);
  add('other-task', '{{[[TODO]]}} Other plan 25m', 'other-plan');
  add('event', '09:00-10:00 Meeting', planUid, 0);
  add('done', '{{[[DONE]]}} Finished work', planUid, 1);
  const labels = ['优化 Nautilus Desk', '整理提示词日志', '验证原生块编辑', '检查任务顺序', '整理项目材料'];
  if (!empty) for (let i = 0; i < count; i++) {
    const uid = `task-${i}`;
    add(uid, `{{[[TODO]]}} ${labels[i % labels.length]} ${i} ${i === 2 ? '9999m' : '45m'}`, planUid, i + 2);
    const n = i === 0 ? 20 : i % 3;
    for (let j = 0; j < n; j++) add(`${uid}-note-${j}`, `${j === 0 ? '{{[[DONE]]}} ' : ''}第 ${j + 1} 轮提示词：保留原始任务结构，记录要求、补充说明与执行反馈。`, uid, j);
  }
  if (!empty) { add('source-task', '{{[[TODO]]}} Referenced prompt 30m'); add('reference-wrapper', '((source-task))', planUid, count + 2); add('source-note', 'Source content.', 'source-task'); }
  add('already-done', '{{[[DONE]]}} Reusable source'); add('done-reference', '((already-done))', planUid, count + 3);
  add('divider', '---', planUid, count + 4);
  const rawRender = () => {
    for (const { raw, uid } of hosts.values()) {
      raw.replaceChildren(...children(uid).map((row) => { const line = document.createElement('div'); line.dataset.rawUid = row.uid; line.textContent = row.string; return line; }));
    }
  };
  const notify = (...uids) => { rawRender(); for (const watch of [...watches]) if (uids.includes(watch.uid)) watch.callback(); };
  const setString = (uid, string) => { nodes.get(uid).string = string; notify(uid, nodes.get(uid).parentUid); };
  const entity = (node) => ({
    'block/uid': node.uid, 'block/string': node.string, 'block/order': node.order, 'block/open': node.open,
    'block/refs': [...node.string.matchAll(/\(\(([\w-]+)\)\)/g)].map((m) => ({ 'block/uid': m[1], 'block/string': nodes.get(m[1])?.string || '' })),
  });
  const forbidden = () => { stats.forbiddenWrites++; throw new Error('Unexpected native Desk/deletion operation'); };
  const roam = {
    graph: { name: 'desk-fixture' }, util: { generateUID: () => `new-note-${++sequence}` },
    deleteBlock: forbidden,
    async moveBlock({ location, block }) {
      stats.writes.push({ type: 'move', uid: block.uid, parent: location['parent-uid'], order: location.order });
      if (holdMove) { holdMove = false; await new Promise(resolve => { releaseMove = resolve; }); }
      if (failMove) { failMove = false; throw new Error('Move failed'); }
      const siblings = children(location['parent-uid']);
      const node = nodes.get(block.uid); const oldParent = node.parentUid;
      const ordered = siblings.filter(row => row.uid !== node.uid);
      ordered.splice(location.order, 0, node);
      node.parentUid = location['parent-uid']; ordered.forEach((row, i) => row.order = i);
      notify(node.uid, oldParent, node.parentUid);
    },
    async createBlock({ location, block }) {
      stats.writes.push({ type: 'create', uid: block.uid, parent: location['parent-uid'], order: location.order, string: block.string });
      if (holdCreate) { holdCreate = false; await new Promise(resolve => { releaseCreate = resolve; }); }
      if (nodes.has(block.uid)) throw new Error('Duplicate UID');
      const ordered = children(location['parent-uid']);
      add(block.uid, block.string, location['parent-uid'], location.order, block.open);
      ordered.splice(location.order, 0, nodes.get(block.uid)); ordered.forEach((row, i) => row.order = i);
      notify(block.uid, location['parent-uid']);
    },
    async updateBlock({ block }) { stats.writes.push({ type: 'update', uid: block.uid, string: block.string }); setString(block.uid, block.string); },
    q: (_query, uid) => { if (failPlan) throw new Error('Graph unavailable'); return nodes.has(uid) ? [[nodes.get(uid).string]] : []; },
    data: {
      pull: (pattern, lookup) => {
        const uid = lookup[1]; stats.reads.push(uid);
        if (failPlan && uid === planUid) throw new Error('Plan read failed');
        const node = nodes.get(uid); if (!node) return null;
        const result = entity(node);
        if (pattern.includes(':block/children')) result['block/children'] = children(uid).map(entity);
        return result;
      },
      addPullWatch: (pattern, lookup, callback) => { watches.add({ pattern, lookup, uid: /"([^"]+)"/.exec(lookup)?.[1], callback }); stats.watches = watches.size; },
      removePullWatch: (pattern, lookup, callback) => { for (const watch of watches) if (watch.pattern === pattern && watch.lookup === lookup && watch.callback === callback) watches.delete(watch); stats.watches = watches.size; },
    },
    ui: { desk: new Proxy({}, { get: () => forbidden }), components: {} },
  };
  if (editor) roam.ui.components = {
    async renderBlock(options) {
      const { uid, el } = options;
      stats.renders.push({ uid, open: options['open?'], zoom: options['zoom-path?'] });
      if (holdRender) { holdRender = false; await new Promise(resolve => { releaseRender = resolve; }); }
      if (failRender) { failRender = false; throw new Error('Native mount failed'); }
      nativeEditors.add(el);
      const owner = document.createElement('div'); owner.className = 'roam-block-container';
      const main = document.createElement('div'); main.className = 'rm-block-main';
      const childArea = document.createElement('div'); childArea.className = 'rm-block-children';
      owner.append(main, childArea); el.append(owner);
      if (nodes.get(uid).string.includes('TODO')) {
        const done = document.createElement('input'); done.type = 'checkbox'; done.setAttribute('aria-label', 'Complete task');
        done.addEventListener('change', () => { stats.nativeWrites.push(uid); setString(uid, nodes.get(uid).string.replace('TODO', 'DONE')); });
        main.append(done);
      }
      const renderNode = (node, parent) => {
        const input = document.createElement('textarea'); input.dataset.blockUid = node.uid; input.value = node.string; input.rows = 3;
        input.setAttribute('aria-label', node.uid);
        let dirty = false;
        input.addEventListener('input', () => { dirty = true; });
        input.addEventListener('blur', () => { if (dirty && node.string !== input.value) { dirty = false; stats.nativeWrites.push(node.uid); setString(node.uid, input.value); } });
        parent.append(input);
      };
      renderNode(nodes.get(uid), main); for (const child of children(uid)) renderNode(child, childArea);
    },
    async unmountNode({ el }) { stats.unmounts++; nativeEditors.delete(el); el.replaceChildren(); },
  };
  window.roamAlphaAPI = roam;
  const bridge = createPlanWatchBridge({ readString: readBlockString });
  let actions = createDeskActions();
  const newView = () => createDeskView({
    actions, readPlan: bridge.read, watchPlan: bridge.subscribe, readString: readBlockString, readChildren,
    openTask: (uid, sidebar) => stats.opened.push({ uid, sidebar }), getSettings: () => ({ language: 'en', 'todo-duration': 15 }),
  });
  let desk = newView();
  const addHost = (uid, label, key = uid, sidebar = false) => {
    const owner = document.createElement('section'); owner.className = 'roam-block-container fixture-owner'; owner.dataset.fixtureHost = key;
    if (sidebar) owner.classList.add('rm-sidebar-window');
    const main = document.createElement('div'); main.className = 'rm-block-main';
    const chart = document.createElement('div'); chart.className = 'nautilus-log-container'; chart.dataset.nautilusLogBlock = uid;
    const shell = document.createElement('div'); shell.className = 'nautilus-log-shell fixture-shell'; shell.textContent = 'Nautilus Log · sea chart placeholder';
    const launch = document.createElement('button'); launch.className = 'fixture-launch nautilus-log-desk-btn'; launch.textContent = 'Desk'; launch.setAttribute('aria-label', label);
    const controls = document.createElement('div'); controls.className = 'nautilus-log-controls-top';
    const collapse = document.createElement('button');
    collapse.className = 'nautilus-log-toggle-btn nautilus-log-collapse-btn';
    collapse.type = 'button'; collapse.textContent = '⌄';
    collapse.setAttribute('aria-label', 'Collapse Nautilus Log');
    controls.append(launch, collapse); shell.append(controls);
    const slot = document.createElement('div'); slot.className = 'nautilus-log-desk-host'; slot.dataset.nautilusDeskPlan = uid; slot.dataset.nautilusDeskPage = 'October 26th, 2026';
    chart.append(shell, slot);
    const prefix = document.createElement('span'); prefix.textContent = '[[Nautilus Log]]';
    prefix.className = 'fixture-plan-title';
    // Roam's .rm-block-main is a flex row. Prefix and renderer share one text
    // column in the real outline, rather than becoming two competing flex items.
    const content = document.createElement('div');
    content.className = 'rm-block__input rm-block__input--view roam-block rm-block-text';
    content.append(prefix, chart); main.append(content);
    // Mirror component.cljs: collapse changes the renderer class and replaces
    // the chart shell with controls, while keeping the same Desk host mounted.
    const setCollapsed = value => {
      chart.classList.toggle('nautilus-log-collapsed', value);
      if (value) { chart.insertBefore(controls, slot); shell.remove(); }
      else { shell.append(controls); chart.insertBefore(shell, slot); }
      collapse.setAttribute('aria-label', value ? 'Expand Nautilus Log' : 'Collapse Nautilus Log');
    };
    collapse.addEventListener('click', () => setCollapsed(!chart.classList.contains('nautilus-log-collapsed')));
    if (collapsed) setCollapsed(true);
    const raw = document.createElement('div'); raw.className = 'rm-block-children fixture-raw'; raw.dataset.rawPlan = uid;
    owner.append(main, raw); document.querySelector('#launchers').append(owner);
    const options = { planUid: uid, container: slot, pageTitle: 'October 26th, 2026', origin: launch };
    launch.addEventListener('click', () => desk.open(options));
    hosts.set(key, { uid, slot, owner, raw, launch, setCollapsed }); rawRender(); desk.registerHost(options);
    return hosts.get(key);
  };
  addHost(planUid, 'Open Desk'); addHost('other-plan', 'Open other Desk');
  cleanup = () => { desk.destroy(); actions.destroy(); bridge.destroy(); };
  window.deskHarness.api = {
    stats, setString, children, text: uid => nodes.get(uid)?.string, activeEditors: () => nativeEditors.size,
    failRead: value => { failPlan = value; notify(planUid); }, failNextRender: () => { failRender = true; }, failNextMove: () => { failMove = true; },
    holdNextRender: () => { holdRender = true; }, holdNextMove: () => { holdMove = true; }, holdNextCreate: () => { holdCreate = true; },
    release: () => { releaseRender?.(); releaseMove?.(); releaseCreate?.(); releaseRender = releaseMove = releaseCreate = null; },
    pending: () => Boolean(releaseRender || releaseMove || releaseCreate),
    setCollapsed: (key, value) => hosts.get(key).setCollapsed(value),
    openCopy: () => { const h = addHost(planUid, 'Open copy Desk', 'copy', true); h.owner.style.width = '280px'; },
    removeHost: key => { const h = hosts.get(key); desk.closeForHost(h.slot); h.owner.remove(); hosts.delete(key); },
    restoreHost: () => addHost(planUid, 'Open Desk'),
    reloadView: () => { desk.destroy(); actions.destroy(); actions = createDeskActions(); desk = newView(); desk.restoreMountedHosts(); },
    remove: uid => { const parent = nodes.get(uid)?.parentUid; nodes.delete(uid); notify(uid, parent); },
    move: (uid, order) => roam.moveBlock({ block: { uid }, location: { 'parent-uid': nodes.get(uid).parentUid, order } }),
    destroy: cleanup,
  };
}
window.deskHarness = { mount, destroy: () => cleanup() };
