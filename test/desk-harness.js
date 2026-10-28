// Production Desk, action guard, watch bridge and read/write adapters.
// Only the underlying graph and native editor are stand-ins; never a live graph.
import { createDeskView } from '../src/desk-view';
import { createDeskActions } from '../src/desk-actions';
import { createPlanWatchBridge } from '../src/plan-watch';
import { readBlockString, readChildren } from '../src/timing-roam';
import { createDeskDiagnosticCommands } from '../src/desk-diagnostics';

let cleanup = () => {};
function mount({ count = 8, dark = false, editor = true, empty = false, preservePreferences = false, collapsed = false, watchResult = 'undefined' } = {}) {
  cleanup();
  if (!preservePreferences) for (const key of Object.keys(localStorage)) if (key.startsWith('nautilus-log:desk-view:v1:desk-fixture:')) localStorage.removeItem(key);
  document.body.classList.toggle('bp3-dark', dark);
  document.querySelector('#launchers').replaceChildren();
  document.querySelector('#fixture-external-outline')?.remove();
  const nodes = new Map(), watches = new Set(), watchRecords = new Map(), nativeEditors = new Set(), hosts = new Map();
  const stats = { renders: [], unmounts: 0, forbiddenWrites: 0, nativeWrites: [], writes: [], reads: [], watches: 0, opened: [], watchEvents: [], notifications: [], nativeEscapes: [], fakeCopies: [], referenceRequests: [], appActivations: 0, pastes: 0, sends: 0, outboundCallbacks: 0 };
  let watchSequence = 0;
  let failPlan = false, failRender = false, holdRender = false, holdMove = false, holdCreate = false, holdWatchRegistration = false, failMove = false;
  let releaseRender = null, releaseMove = null, releaseCreate = null, releaseWatchRegistration = null;
  let sequence = 0;
  let nextNativeEscapePreventsDefault = false;
  let nativeSelection = null;
  const planUid = 'plan-desk';
  const rendererString = '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}';
  // Synthetic fixture assets only: never load a user graph attachment.
  const imageA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==';
  // 40x24 opaque PNG: a meaningful local raster for image-preview geometry.
  const imageB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAYCAYAAACIhL/AAAAAN0lEQVR4nO3OMREAIAAAIeMY0bB20RTeOzCwM+ba52ejDggK1gFBwTogKFgHBAXrgKBgHRB87QK2F03Ic52kygAAAABJRU5ErkJggg==';
  const add = (uid, string, parentUid = 'daily-page', order = 0, open = true, pageUid = 'daily-page') => nodes.set(uid, { uid, string, parentUid, order, open, pageUid });
  const children = (uid) => [...nodes.values()].filter((n) => n.parentUid === uid).sort((a, b) => a.order - b.order);
  add(planUid, rendererString); add('other-plan', rendererString);
  add('other-task', '{{[[TODO]]}} Other plan 25m', 'other-plan');
  add('event', '09:00-10:00 Meeting', planUid, 0);
  add('done', '{{[[DONE]]}} Finished work', planUid, 1);
  const labels = ['优化 Nautilus Desk', '整理提示词日志', '验证原生块编辑', '检查任务顺序', '整理项目材料'];
  if (!empty) for (let i = 0; i < count; i++) {
    const uid = `task-${i}`;
    const image = i === 0 ? ` ![Root fixture](${imageA})` : i === 1 ? ' ![Unsafe fixture](javascript:alert(1))' : '';
    add(uid, `{{[[TODO]]}} ${labels[i % labels.length]} ${i} ${i === 2 ? '9999m' : '45m'}${image}`, planUid, i + 2);
    const n = i === 0 ? 20 : i % 3;
    for (let j = 0; j < n; j++) add(`${uid}-note-${j}`, `${j === 0 ? '{{[[DONE]]}} ' : ''}第 ${j + 1} 轮提示词：保留原始任务结构，记录要求、补充说明与执行反馈。${i === 0 && j === 0 ? ` ![Child fixture](${imageB})` : ''}`, uid, j);
  }
  if (!empty && count > 0) {
    add('source-task', `{{[[TODO]]}} Referenced prompt 30m ![Source fixture](${imageA})`);
    add('reference-wrapper', '((source-task))', planUid, count + 2);
    add('context-wrapper', '{{[[TODO]]}} Review ((source-task)) tomorrow 15m', planUid, count + 3);
    // The plain reference has a local row; the contextual wrapper has none and
    // exercises source-child fallback without losing local root metadata.
    add('reference-wrapper-note', 'Wrapper-local child.', 'reference-wrapper');
    add('code-literal', '{{[[TODO]]}} `![literal](https://desk-fixture.invalid/code.png) ((source-task))`', planUid, count + 4);
    add('source-note', 'Source content.', 'source-task');
  }
  add('already-done', '{{[[DONE]]}} Reusable source'); add('done-reference', '((already-done))', planUid, count + 5);
  add('outside-parent', 'Outside outline parent', 'daily-page', 0);
  add('outside-source', '{{[[TODO]]}} Outside source task 20m', 'outside-parent', 0);
  add('divider', '---', planUid, count + 6);
  // Real sibling orders are contiguous even when no unfinished cards exist.
  children(planUid).forEach((row, order) => { row.order = order; });
  const externalOutline = document.createElement('section'); externalOutline.id = 'fixture-external-outline'; externalOutline.className = 'roam-article';
  const externalOwner = document.createElement('div'); externalOwner.className = 'rm-block-container'; externalOwner.dataset.blockUid = 'outside-source';
  const bullet = document.createElement('span'); bullet.className = 'rm-bullet'; bullet.textContent = '•';
  externalOwner.append(bullet); externalOutline.append(externalOwner); document.body.append(externalOutline);
  const rawRender = () => {
    for (const { raw, uid } of hosts.values()) {
      raw.replaceChildren(...children(uid).map((row) => { const line = document.createElement('div'); line.dataset.rawUid = row.uid; line.textContent = row.string; return line; }));
    }
  };
  // Pull watches receive only fields declared by their pattern. A child text
  // edit is not a parent membership change in production Roam.
  const notify = (...changes) => {
    rawRender();
    stats.notifications.push(...changes);
    for (const watch of [...watches]) for (const change of changes) {
      if (watch.uid !== change.uid) continue;
      if (change.fields.some((field) => watch.pattern.includes(`:block/${field}`))) { watch.invoke(); break; }
    }
  };
  const setString = (uid, string) => { nodes.get(uid).string = string; notify({ uid, fields: ['string'] }); };
  const setOpen = (uid, open) => { nodes.get(uid).open = open; notify({ uid, fields: ['open'] }); };
  // Fixture-only graph edits model independent Datomic field changes. Reordering
  // a sibling set does NOT change the parent's :block/children membership.
  const setOrder = (uid, order) => {
    const ordered = children(nodes.get(uid).parentUid).filter(row => row.uid !== uid);
    ordered.splice(order, 0, nodes.get(uid));
    const changes = [];
    ordered.forEach((row, index) => {
      if (row.order !== index) { row.order = index; changes.push({ uid: row.uid, fields: ['order'] }); }
    });
    notify(...changes);
  };
  const addChild = (uid, parentUid, string, open = true) => {
    if (nodes.has(uid) || !nodes.has(parentUid)) throw new Error('Invalid fixture child');
    add(uid, string, parentUid, children(parentUid).length, open);
    notify({ uid: parentUid, fields: ['children'] });
  };
  const entity = (node) => ({
    'block/uid': node.uid, 'block/string': node.string, 'block/order': node.order, 'block/open': node.open,
    'block/_children': node.parentUid ? [{ 'block/uid': node.parentUid }] : [],
    'block/page': node.pageUid ? { 'block/uid': node.pageUid } : undefined,
    'block/refs': [...node.string.matchAll(/\(\(([\w-]+)\)\)/g)].map((m) => ({ 'block/uid': m[1], 'block/string': nodes.get(m[1])?.string || '' })),
  });
  const referenceEntity = (uid) => {
    const node = nodes.get(uid);
    if (!node) return null;
    return { uid: node.uid, string: node.string, parentUid: node.parentUid, pageUid: node.pageUid,
      children: children(uid).map(child => ({ uid: child.uid, order: child.order })) };
  };
  const forbidden = () => { stats.forbiddenWrites++; throw new Error('Unexpected native Desk/deletion operation'); };
  const roam = {
    graph: { name: 'desk-fixture', type: 'hosted' }, user: { uid: () => 'fixture-user' }, util: { generateUID: () => `new-note-${++sequence}` },
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
      notify({ uid: node.uid, fields: ['order'] }, { uid: oldParent, fields: ['children'] }, { uid: node.parentUid, fields: ['children'] });
    },
    async createBlock({ location, block }) {
      stats.writes.push({ type: 'create', uid: block.uid, parent: location['parent-uid'], order: location.order, string: block.string });
      if (holdCreate) { holdCreate = false; await new Promise(resolve => { releaseCreate = resolve; }); }
      if (nodes.has(block.uid)) throw new Error('Duplicate UID');
      const ordered = children(location['parent-uid']);
      add(block.uid, block.string, location['parent-uid'], location.order, block.open);
      ordered.splice(location.order, 0, nodes.get(block.uid)); ordered.forEach((row, i) => row.order = i);
      notify({ uid: block.uid, fields: ['string'] }, { uid: location['parent-uid'], fields: ['children'] });
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
      addPullWatch: (pattern, lookup, callback) => {
        const uid = /"([^"]+)"/.exec(lookup)?.[1];
        const record = { id: ++watchSequence, pattern, lookup, uid, callback, state: 'requested', calls: 0,
          invoke: () => { record.calls++; callback(); } };
        watchRecords.set(record.id, record);
        const event = action => stats.watchEvents.push({ id: record.id, action, uid, pattern });
        const add = () => { record.state = 'active'; watches.add(record); stats.watches = watches.size; event('registered'); };
        const result = watchResult === 'null' ? null : undefined;
        // Plan watches do not include :block/open. Only a specifically targeted
        // preview registration can be held, so cleanup tests cannot pass by
        // accidentally exercising the already-safe Plan bridge instead.
        const held = holdWatchRegistration && pattern.includes(':block/open')
          && (holdWatchRegistration === true || holdWatchRegistration === uid);
        if (!held) {
          add();
          return watchResult === 'reject' ? Promise.reject(new Error('Ambiguous fixture watch registration')) : result;
        }
        holdWatchRegistration = false;
        record.state = 'held'; event('held');
        return new Promise((resolve, reject) => {
          releaseWatchRegistration = () => {
            add();
            if (watchResult === 'reject') reject(new Error('Ambiguous fixture watch registration'));
            else resolve(result);
          };
        });
      },
      block: { create: args => roam.createBlock(args) },
      removePullWatch: (pattern, lookup, callback) => {
        for (const record of watchRecords.values()) if (record.pattern === pattern && record.lookup === lookup && record.callback === callback) {
          stats.watchEvents.push({ id: record.id, action: 'removed', uid: record.uid, pattern, wasActive: watches.has(record) });
          watches.delete(record); record.state = 'removed';
        }
        stats.watches = watches.size;
      },
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
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape') return;
          nativeSelection = { uid: node.uid, block: node.string, state: 'native-block-selected' };
          const record = { uid: node.uid, defaultPreventedBefore: event.defaultPrevented, prevented: false };
          stats.nativeEscapes.push(record);
          if (nextNativeEscapePreventsDefault) {
            nextNativeEscapePreventsDefault = false;
            event.preventDefault();
            record.prevented = true;
          }
        });
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
  const deskActionOptions = {
    referenceApi: () => roam,
    getContext: () => ({ provider: roam, graphName: roam.graph.name, graphType: roam.graph.type, userUid: roam.user.uid() }),
    stableReferenceUid: async ({ sourceUid }) => `ref-${sourceUid}`,
  };
  const createActions = () => {
    const value = createDeskActions(deskActionOptions);
    const importReferenceDrop = value.importReferenceDrop;
    value.importReferenceDrop = request => {
      // Observe the real action promise/signal; do not replace its result or queue.
      const record = { state: 'pending', aborted: Boolean(request.signal?.aborted) };
      stats.referenceRequests.push(record);
      request.signal?.addEventListener('abort', () => { record.aborted = true; }, { once: true });
      const pending = importReferenceDrop(request);
      pending.then(result => { record.state = 'fulfilled'; record.status = result.status; }, () => { record.state = 'rejected'; });
      return pending;
    };
    return value;
  };
  let actions = createActions(), diagnosticCommands;
  const commandCallbacks = new Map();
  const extensionAPI = { ui: { commandPalette: {
    addCommand: command => commandCallbacks.set(command.label, command.callback),
    removeCommand: ({ label }) => commandCallbacks.delete(label),
  } } };
  const newView = () => {
    const view = createDeskView({
      revision: 'd'.repeat(40),
      actions, readPlan: bridge.read, watchPlan: bridge.subscribe, readString: readBlockString, readChildren,
      openTask: (uid, sidebar) => stats.opened.push({ uid, sidebar }), getSettings: () => ({ language: 'en', 'todo-duration': 15 }),
    });
    diagnosticCommands = createDeskDiagnosticCommands({ extensionAPI, diagnostics: view.diagnostics });
    diagnosticCommands.initialize();
    return view;
  };
  let desk = newView();
  const addHost = (uid, label, key = uid, sidebar = false, initiallyCollapsed = collapsed) => {
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
    // Mirror component.cljs: folding keeps the host claim but Desk observes the
    // collapsed class, hides its UI, and releases a native focus layer.
    const options = { planUid: uid, container: slot, pageTitle: 'October 26th, 2026', origin: launch };
    const setCollapsed = value => {
      if (value === chart.classList.contains('nautilus-log-collapsed')) return;
      chart.classList.toggle('nautilus-log-collapsed', value);
      if (value) { chart.insertBefore(controls, slot); shell.remove(); }
      else { shell.append(controls); chart.insertBefore(shell, slot); }
      collapse.setAttribute('aria-label', value ? 'Expand Nautilus Log' : 'Collapse Nautilus Log');
    };
    collapse.addEventListener('click', () => setCollapsed(!chart.classList.contains('nautilus-log-collapsed')));
    const raw = document.createElement('div'); raw.className = 'rm-block-children fixture-raw'; raw.dataset.rawPlan = uid;
    owner.append(main, raw); document.querySelector('#launchers').append(owner);
    launch.addEventListener('click', () => desk.open(options));
    hosts.set(key, { uid, slot, owner, raw, launch, setCollapsed }); rawRender();
    if (initiallyCollapsed) setCollapsed(true);
    desk.registerHost(options);
    return hosts.get(key);
  };
  addHost(planUid, 'Open Desk'); addHost('other-plan', 'Open other Desk');
  cleanup = () => { diagnosticCommands.destroy(); desk.destroy(); actions.destroy(); bridge.destroy(); };
  window.deskHarness.api = {
    stats, setString, setOpen, setOrder, addChild, children, text: uid => nodes.get(uid)?.string, sourceSnapshot: uid => JSON.stringify(referenceEntity(uid)), activeEditors: () => nativeEditors.size,
    diagnosticCommands: () => [...commandCallbacks.keys()],
    runDiagnosticCommand: label => { const run = commandCallbacks.get(label); if (!run) throw new Error('Unknown fixture command'); return run(); },
    diagnosticReport: () => desk.diagnostics.report(),
    captureDiagnostic: (reason, metadata) => desk.diagnostics.capture(reason, metadata),
    replayEscapeBeforeCopy: (uid, { preventDefault = false } = {}) => {
      const input = document.querySelector(`.nautilus-desk__native textarea[data-block-uid="${uid}"]`);
      if (!input) throw new Error('Native editor is not mounted');
      nativeSelection = { uid, block: nodes.get(uid)?.string || '', state: 'editing' };
      nextNativeEscapePreventsDefault = preventDefault;
      input.focus();
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      const copied = nativeSelection?.state === 'native-block-selected'
        ? { uid: nativeSelection.uid, block: nativeSelection.block } : null;
      stats.fakeCopies.push(copied);
      return { defaultPrevented: event.defaultPrevented, copied };
    },
    watchSnapshot: () => [...watchRecords.values()].map(({ id, uid, pattern, state, calls }) => ({ id, uid, pattern, state, calls })),
    fireWatch: id => { const record = watchRecords.get(id); if (!record) throw new Error('Unknown fixture watch'); record.invoke(); },
    failRead: value => { failPlan = value; notify({ uid: planUid, fields: ['string'] }); }, failNextRender: () => { failRender = true; }, failNextMove: () => { failMove = true; },
    holdNextRender: () => { holdRender = true; }, holdNextMove: () => { holdMove = true; }, holdNextCreate: () => { holdCreate = true; }, holdNextWatchRegistration: (uid = true) => { holdWatchRegistration = uid; },
    release: () => { releaseRender?.(); releaseMove?.(); releaseCreate?.(); releaseWatchRegistration?.(); releaseRender = releaseMove = releaseCreate = releaseWatchRegistration = null; },
    pending: () => Boolean(releaseRender || releaseMove || releaseCreate || releaseWatchRegistration),
    setCollapsed: (key, value) => hosts.get(key).setCollapsed(value),
    openCopy: () => { const h = addHost(planUid, 'Open copy Desk', 'copy', true, false); h.owner.style.width = '280px'; },
    removeHost: key => { const h = hosts.get(key); desk.closeForHost(h.slot); h.owner.remove(); hosts.delete(key); },
    restoreHost: () => addHost(planUid, 'Open Desk'),
    reloadView: () => { diagnosticCommands.destroy(); desk.destroy(); actions.destroy(); actions = createActions(); desk = newView(); desk.restoreMountedHosts(); },
    remove: uid => { const parent = nodes.get(uid)?.parentUid; nodes.delete(uid); notify({ uid, fields: ['string'] }, { uid: parent, fields: ['children'] }); },
    move: (uid, order) => roam.moveBlock({ block: { uid }, location: { 'parent-uid': nodes.get(uid).parentUid, order } }),
    destroy: cleanup,
  };
}
window.deskHarness = { mount, destroy: () => cleanup() };
