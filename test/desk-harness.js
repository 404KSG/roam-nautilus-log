// Synthetic graph + native-editor stand-in. The view, watch bridge, task core,
// and graph read adapters are production code; this is not a real Roam session.
import { createDeskView } from '../src/desk-view';
import { createPlanWatchBridge } from '../src/plan-watch';
import { readBlockString, readChildren } from '../src/timing-roam';

let cleanup = () => {};
function mount({ count = 8, language = 'en', dark = false, editor = true, empty = false } = {}) {
  cleanup();
  document.body.classList.toggle('bp3-dark', dark);
  document.querySelector('#launchers').replaceChildren();
  const nodes = new Map();
  const watches = new Set();
  const nativeEditors = new Set();
  const stats = { renders: [], unmounts: 0, forbiddenWrites: 0, nativeWrites: [], reads: [], watches: 0 };
  let failPlan = false;
  let failRender = false;
  let holdRender = false;
  let releaseRender = null;
  const planUid = 'plan-desk';
  const rendererString = '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}';
  const add = (uid, string, parentUid = '', order = 0) => nodes.set(uid, { uid, string, parentUid, order });
  add(planUid, rendererString);
  add('other-plan', rendererString);
  add('other-task', '{{[[TODO]]}} Another plan, not today 25m', 'other-plan');
  const labels = language === 'zh'
    ? ['优化 Nautilus Desk 的任务切换体验', '整理今天的提示词日志', '验证 Roam 原生块编辑', '完善内容审核流程', '复盘产品设计与下一步']
    : ['Refine the Nautilus Desk experience', 'Organize today’s prompt logs', 'Verify native Roam block editing', 'Improve the content review flow', 'Review the design and next steps'];
  if (!empty) {
    for (let i = 0; i < count; i += 1) {
      const uid = `task-${i}`;
      add(uid, `{{[[TODO]]}} ${labels[i % labels.length]} ${i > 4 ? i + 1 : ''} ${i === 2 ? '9999m' : '45m'}`, planUid, i);
      for (let n = 0; n < (i === 0 ? 24 : 2); n += 1) {
        add(`${uid}-note-${n}`, language === 'zh'
          ? `${n === 0 ? '{{[[DONE]]}} ' : ''}第 ${n + 1} 轮提示词：保留原始任务结构，每次只聚焦一个任务。记录要求、补充说明与执行反馈。`
          : `${n === 0 ? '{{[[DONE]]}} ' : ''}Prompt ${n + 1}: Keep the original task structure. Focus on one task at a time and record the requirements, revisions, and results.`, uid, n);
      }
    }
    add('source-task', '{{[[TODO]]}} Referenced prompt 30m');
    add('reference-wrapper', '((source-task))', planUid, count);
    add('source-note', 'Notes on the original source block.', 'source-task');
  }
  add('done-task', '{{[[DONE]]}} Finished work 15m', planUid, 100);
  add('fixed-event', '11:00-12:00 Meeting', planUid, 101);
  add('divider', '---', planUid, 102);
  add('already-done', '{{[[DONE]]}} Reusable source');
  add('done-reference', '((already-done))', planUid, 103);

  const children = (uid) => [...nodes.values()].filter((n) => n.parentUid === uid).sort((a, b) => a.order - b.order);
  const entity = (node) => ({
    'block/uid': node.uid, 'block/string': node.string, 'block/order': node.order, 'block/open': true,
    'block/refs': [...node.string.matchAll(/\(\(([\w-]+)\)\)/g)].map((m) => ({
      'block/uid': m[1], 'block/string': nodes.get(m[1])?.string || '',
    })),
  });
  const notify = (...uids) => {
    for (const watch of [...watches]) if (uids.includes(watch.uid)) watch.callback();
  };
  const setString = (uid, string) => {
    nodes.get(uid).string = string;
    notify(uid, nodes.get(uid).parentUid);
  };
  const forbidden = () => { stats.forbiddenWrites += 1; throw new Error('Desk must not write graph data or native Desk state'); };
  const roam = {
    graph: { name: 'desk-fixture' },
    createBlock: forbidden, updateBlock: forbidden, moveBlock: forbidden, deleteBlock: forbidden,
    q: (_query, uid) => {
      if (failPlan) throw new Error('Graph unavailable');
      return nodes.has(uid) ? [[nodes.get(uid).string]] : [];
    },
    data: {
      pull: (pattern, lookup) => {
        const uid = lookup[1];
        stats.reads.push(uid);
        if (failPlan && uid === planUid) throw new Error('Plan read failed');
        const node = nodes.get(uid);
        if (!node) return null;
        const result = entity(node);
        if (pattern.includes(':block/children')) result['block/children'] = children(uid).map(entity);
        return result;
      },
      addPullWatch: (pattern, lookup, callback) => {
        const uid = /"([^"]+)"/.exec(lookup)?.[1];
        watches.add({ pattern, lookup, uid, callback });
        stats.watches = watches.size;
      },
      removePullWatch: (pattern, lookup, callback) => {
        for (const watch of watches) if (watch.pattern === pattern && watch.lookup === lookup && watch.callback === callback) watches.delete(watch);
        stats.watches = watches.size;
      },
    },
    ui: { desk: new Proxy({}, { get: () => forbidden }), components: {} },
  };
  if (editor) roam.ui.components = {
    renderBlock: async (options) => {
      const { uid, el } = options;
      stats.renders.push({ uid, open: options['open?'], zoom: options['zoom-path?'] });
      if (holdRender) {
        holdRender = false;
        await new Promise((resolve) => { releaseRender = resolve; });
      }
      if (failRender) { failRender = false; throw new Error('Native mount failed'); }
      nativeEditors.add(el);
      const done = document.createElement('input');
      done.type = 'checkbox';
      done.setAttribute('aria-label', 'Complete task');
      done.addEventListener('change', () => {
        stats.nativeWrites.push(uid);
        setString(uid, nodes.get(uid).string.replace('TODO', 'DONE'));
      });
      el.append(done);
      const renderNode = (node, root = false) => {
        const label = document.createElement('label');
        label.textContent = root ? 'Task title' : 'Prompt log';
        const input = document.createElement('textarea');
        input.dataset.blockUid = node.uid;
        input.value = node.string;
        input.rows = root ? 2 : 4;
        let dirty = false;
        input.addEventListener('input', () => { dirty = true; });
        input.addEventListener('blur', () => {
          if (!dirty || node.string === input.value) return;
          dirty = false;
          stats.nativeWrites.push(node.uid);
          setString(node.uid, input.value);
        });
        label.append(input);
        el.append(label);
      };
      renderNode(nodes.get(uid), true);
      for (const child of children(uid)) renderNode(child);
    },
    unmountNode: async ({ el }) => {
      stats.unmounts += 1;
      nativeEditors.delete(el);
      el.replaceChildren();
    },
  };
  window.roamAlphaAPI = roam;
  const bridge = createPlanWatchBridge({ readString: readBlockString });
  const desk = createDeskView({
    readPlan: bridge.read, watchPlan: bridge.subscribe, readString: readBlockString, readChildren,
    getSettings: () => ({ language, 'todo-duration': 15 }),
  });
  for (const uid of [planUid, 'other-plan']) {
    const launch = document.createElement('button');
    launch.className = 'fixture-launch';
    launch.textContent = uid === planUid ? 'Open Desk' : 'Open other Desk';
    launch.addEventListener('click', () => desk.open({ planUid: uid, pageTitle: uid === planUid ? 'October 26th, 2026' : 'October 25th, 2026', origin: launch }));
    document.querySelector('#launchers').append(launch);
  }
  cleanup = () => { desk.destroy(); bridge.destroy(); };
  window.deskHarness.api = {
    stats, setString, children, text: (uid) => nodes.get(uid)?.string,
    activeEditors: () => nativeEditors.size,
    failRead: (value) => { failPlan = value; notify(planUid); },
    failNextRender: () => { failRender = true; },
    holdNextRender: () => { holdRender = true; },
    release: () => { releaseRender?.(); releaseRender = null; },
    pendingRender: () => Boolean(releaseRender),
    remove: (uid) => { const parent = nodes.get(uid)?.parentUid; nodes.delete(uid); notify(uid, parent); },
    move: (uid, order) => { nodes.get(uid).order = order; notify(uid, nodes.get(uid).parentUid); },
    destroy: cleanup,
  };
}
window.deskHarness = { mount, destroy: () => cleanup() };
