import { graphName } from './graph-context';
import { compactMinutes } from './timing-core';
import { createDeskMasonry } from './desk-masonry';
import { createDeskDrag } from './desk-drag';
import {
  projectDeskTasks, plainDeskText, deskPreview, reconcileDeskSelection, stepDeskSelection, deskShortcut,
  orderDeskTasks, moveDeskTask,
} from './desk-core';

const COPY = {
  en: {
    back: 'Hide Desk', refresh: 'Refresh', title: 'Nautilus Desk', focus: 'Task focus',
    reset: 'Restore outline order', drag: 'Drag to reorder cards · Alt+Shift+←/→',
    moved: 'Card layout updated. Outline order and scheduling are unchanged.',
    cards: 'Back to cards', previous: 'Previous task', next: 'Next task', loading: 'Opening task…',
    count: (n) => `${n} unfinished ${n === 1 ? 'task' : 'tasks'}`,
    empty: 'No unfinished tasks. Completed tasks and events stay in your outline.',
    unavailable: 'Could not read this plan. Refresh to try again.',
    stale: 'This view is out of date. Editing is paused until the plan can be read again.',
    missing: 'This Nautilus plan is no longer available. Return to your outline.',
    previewError: 'Preview unavailable. Open the task to view its notes.',
    editorError: 'The native Roam editor could not open this task.',
    editorMissing: 'This Roam version does not expose the native block editor. Return to your outline to edit.',
    retry: 'Try again', nextHint: 'Next', previousHint: 'Previous', backHint: 'Back to cards',
  },
  zh: {
    back: '收起 Desk', refresh: '刷新', title: 'Nautilus Desk', focus: '任务聚焦',
    reset: '恢复大纲顺序', drag: '拖动调整卡片位置 · Alt+Shift+←/→',
    moved: '已调整卡片布局，原大纲顺序和排程不变。',
    cards: '返回卡片', previous: '上一项任务', next: '下一项任务', loading: '正在打开任务…',
    count: (n) => `${n} 项未完成任务`,
    empty: '没有未完成任务。已完成任务和事件仍保留在原大纲中。',
    unavailable: '暂时无法读取计划，请刷新重试。',
    stale: '当前是上次读取的内容，恢复读取前暂停编辑。',
    missing: '这个 Nautilus 计划已不可用，请返回原大纲。',
    previewError: '预览暂不可用，可打开任务查看笔记。',
    editorError: '无法打开 Roam 原生块编辑器。',
    editorMissing: '当前 Roam 版本未提供原生块编辑接口，请返回原大纲编辑。',
    retry: '重试', nextHint: '下一项', previousHint: '上一项', backHint: '返回卡片',
  },
};

/** No data writes, CLOCK calls, native Desk APIs, timers, or editor mounts while closed. */
export function createDeskView({
  host = globalThis.window,
  document = host?.document,
  readPlan,
  watchPlan,
  readString,
  readChildren,
  getSettings = () => ({}),
} = {}) {
  const sessions = new Map();
  const viewOrders = new Map(); // Session-only UID order; never persisted to the graph or localStorage.
  let focusOwner = null;
  let destroyed = false;
  let nativeLane = Promise.resolve();
  // Serialize native mounts/unmounts, including slow mounts from an already closed Desk.
  const enqueueNative = (work) => {
    nativeLane = nativeLane.then(work, work);
    nativeLane = nativeLane.catch((error) => console.error('[Nautilus Log] Desk editor cleanup failed', error));
    return nativeLane;
  };

  const open = (options = {}) => {
    if (destroyed || !document?.body || !options.planUid || !options.container?.isConnected) return;
    const existing = sessions.get(options.container);
    if (existing) { existing.close(); return; }
    const session = createSession(options);
    sessions.set(options.container, session);
    session.start();
  };

  function createSession({ planUid, container, pageTitle = '', origin = document.activeElement }) {
    const roam = host.roamAlphaAPI;
    const graph = graphName(host);
    const orderKey = `${graph}\u0000${planUid}`;
    const copy = COPY[getSettings().language === 'zh' ? 'zh' : 'en'];
    const cards = new Map();
    const previews = new Map();
    const previewQueue = new Set();
    const scrollPositions = new Map();
    let tasks = [];
    let outlineTasks = [];
    let status = 'loading';
    let selectedUid = null;
    let mount = null;
    let closed = false;
    let stopWatch = null;
    let previewFrame = null;
    let previewEpoch = 0;
    let composing = false;
    let deferredSnapshot = null;
    let compositionFrame = null;
    let observer = null;

    const element = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const button = (label, action, text = label) => {
      const node = element('button', 'nautilus-desk__button', text);
      node.type = 'button';
      node.setAttribute('aria-label', label);
      node.title = label;
      node.addEventListener('click', action);
      return node;
    };
    const root = element('section', 'nautilus-desk');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', copy.title);
    root.tabIndex = -1;
    root.dataset.planUid = planUid;
    const board = element('div', 'nautilus-desk__board');
    const header = element('header', 'nautilus-desk__header');
    const back = button(copy.back, () => close(), '×');
    const identity = element('div', 'nautilus-desk__identity');
    const title = element('h3', '', copy.title);
    const summary = element('span', 'nautilus-desk__summary');
    summary.setAttribute('role', 'status');
    identity.append(title, summary);
    const refreshButton = button(copy.refresh, () => refresh(true), '↻');
    const resetOrder = button(copy.reset, () => {
      viewOrders.delete(orderKey);
      tasks = outlineTasks;
      renderCards();
    }, '↺');
    resetOrder.hidden = true;
    header.append(identity, resetOrder, refreshButton, back);
    const movement = element('span', 'nautilus-desk__sr-only');
    movement.setAttribute('role', 'status');
    const notice = element('div', 'nautilus-desk__notice');
    notice.setAttribute('role', 'status');
    notice.hidden = true;
    const content = element('div', 'nautilus-desk__content');
    const grid = element('div', 'nautilus-desk__grid');
    const empty = element('p', 'nautilus-desk__empty');
    empty.hidden = true;
    content.append(grid, empty);
    board.append(header, movement, notice, content);
    const masonry = createDeskMasonry({ grid, host });
    const drag = createDeskDrag({
      grid,
      canDrag: () => inScope() && status === 'ready' && !selectedUid && !composing,
      move: (uid, target, after) => applyViewOrder(uid, target, after),
      nudge: (uid, direction) => {
        const index = tasks.findIndex((task) => task.uid === uid);
        const target = tasks[index + direction];
        if (target) applyViewOrder(uid, target.uid, direction > 0);
      },
    });

    const layer = element('div', 'nautilus-desk__focus-layer');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', copy.focus);
    layer.hidden = true;
    const focus = element('section', 'nautilus-desk__focus');
    focus.setAttribute('role', 'region');
    focus.setAttribute('aria-label', copy.focus);
    focus.tabIndex = -1;
    const focusHeader = element('header', 'nautilus-desk__focus-header');
    const navigation = element('div', 'nautilus-desk__navigation');
    const previous = button(copy.previous, () => step(-1), '‹');
    const position = element('span', 'nautilus-desk__position');
    position.setAttribute('role', 'status');
    const next = button(copy.next, () => step(1), '›');
    navigation.append(previous, position, next);
    const focusTitle = element('strong', '', copy.title);
    const closeFocusButton = button(copy.cards, () => showOverview(), '×');
    focusHeader.append(navigation, focusTitle, closeFocusButton);
    const focusBody = element('div', 'nautilus-desk__focus-body');
    const context = element('div', 'nautilus-desk__context', pageTitle);
    const editorStatus = element('div', 'nautilus-desk__editor-status');
    editorStatus.setAttribute('role', 'status');
    const editorMessage = element('p');
    const retry = button(copy.retry, () => showTask(selectedUid, true));
    editorStatus.append(editorMessage, retry);
    const editor = element('div', 'nautilus-desk__editor');
    focusBody.append(context, editorStatus, editor);
    const footer = element('footer', 'nautilus-desk__focus-footer');
    const alt = /Mac|iPhone|iPad/.test(host.navigator?.platform || '') ? '⌥' : 'Alt';
    footer.textContent = `${alt}+, ${copy.nextHint}    ${alt}+. ${copy.previousHint}    Esc ${copy.backHint}`;
    focus.append(focusHeader, focusBody, footer);
    layer.append(focus);
    root.append(board);

    const inScope = () => !closed && container.isConnected && host.roamAlphaAPI === roam && graphName(host) === graph;
    const checkScope = () => {
      if (inScope()) return true;
      close(false);
      return false;
    };
    const nativeCurrent = (record) => inScope() && mount === record && !record.disposed;
    const cleanupNative = async (record) => {
      if (!record.attempted || record.cleaned) return;
      record.cleaned = true;
      await record.components.unmountNode({ el: record.el });
    };
    const dropEditor = () => {
      const record = mount;
      mount = null;
      if (!record) return;
      record.disposed = true;
      scrollPositions.set(record.uid, focusBody.scrollTop);
      // Native Roam editors own their commit/blur behavior. Never read or rewrite their drafts.
      if (inOriginalGraph() && record.el.contains(document.activeElement)) document.activeElement.blur();
      record.el.remove();
      enqueueNative(() => cleanupNative(record));
      previews.delete(record.uid);
      const card = cards.get(record.uid);
      if (card) observer?.observe(card.button);
    };
    const updatePosition = () => {
      position.textContent = `${Math.max(0, tasks.findIndex(({ uid }) => uid === selectedUid) + 1)} / ${tasks.length}`;
      previous.disabled = next.disabled = status !== 'ready' || tasks.length < 2;
    };

    function showOverview(restoreFocus = true) {
      const uid = selectedUid;
      composing = false;
      deferredSnapshot = null;
      selectedUid = null;
      dropEditor();
      layer.hidden = true;
      layer.remove();
      if (focusOwner === session) focusOwner = null;
      if (!document.querySelector('.nautilus-desk__focus-layer')) document.body.classList.remove('nautilus-desk-focus-open');
      board.inert = false;
      board.removeAttribute('aria-hidden');
      root.classList.remove('is-focused');
      if (restoreFocus && !closed) (cards.get(uid)?.button || back).focus({ preventScroll: true });
      schedulePreviews();
    }

    function showTask(uid, force = false) {
      if (!uid || !checkScope() || status !== 'ready' || !tasks.some((task) => task.uid === uid)) return;
      if (uid === selectedUid && !force) return;
      if (focusOwner && focusOwner !== session) focusOwner.showOverview(false);
      focusOwner = session;
      drag.cancel();
      dropEditor();
      selectedUid = uid;
      document.body.append(layer);
      document.body.classList.add('nautilus-desk-focus-open');
      layer.hidden = false;
      root.classList.add('is-focused');
      focus.focus({ preventScroll: true });
      board.inert = true;
      board.setAttribute('aria-hidden', 'true');
      updatePosition();
      focusBody.scrollTop = 0;
      editorStatus.hidden = false;
      editorMessage.textContent = copy.loading;
      retry.hidden = true;
      const components = roam?.ui?.components;
      if (typeof components?.renderBlock !== 'function' || typeof components?.unmountNode !== 'function') {
        editorMessage.textContent = copy.editorMissing;
        return;
      }
      const record = { uid, el: element('div', 'nautilus-desk__native'), components, attempted: false, cleaned: false, disposed: false };
      mount = record;
      record.el.dataset.taskUid = uid;
      editor.append(record.el);
      enqueueNative(async () => {
        if (!nativeCurrent(record)) return;
        record.attempted = true;
        try {
          await components.renderBlock({ uid, el: record.el, 'open?': true, 'zoom-path?': false });
          if (!nativeCurrent(record)) { await cleanupNative(record); return; }
          editorStatus.hidden = true;
          focusBody.scrollTop = scrollPositions.get(uid) || 0;
        } catch (_error) {
          if (nativeCurrent(record)) {
            editorMessage.textContent = copy.editorError;
            retry.hidden = false;
            record.el.remove();
          }
          await cleanupNative(record);
        }
      });
    }

    function step(direction) {
      if (!composing) showTask(stepDeskSelection(tasks, selectedUid, direction));
    }

    function schedulePreviews() {
      if (closed || selectedUid || previewFrame !== null || !previewQueue.size) return;
      previewFrame = host.requestAnimationFrame(() => {
        previewFrame = null;
        if (!checkScope() || selectedUid) return;
        const uid = previewQueue.values().next().value;
        previewQueue.delete(uid);
        loadPreview(uid).finally(schedulePreviews);
      });
    }

    async function loadPreview(uid) {
      const card = cards.get(uid);
      if (!card || previews.has(uid) || status !== 'ready' || !checkScope()) return;
      const epoch = previewEpoch;
      try {
        let lines = deskPreview(await readChildren(uid));
        if (!checkScope()) return;
        const sourceUid = tasks.find((task) => task.uid === uid)?.sourceUid;
        if (!lines.length && sourceUid && sourceUid !== uid) lines = deskPreview(await readChildren(sourceUid));
        if (!checkScope() || epoch !== previewEpoch || cards.get(uid) !== card) return;
        previews.set(uid, lines);
        card.preview.replaceChildren(...lines.map((line) => {
          const row = element('span', 'nautilus-desk__preview-line', line);
          if (/^[☑☐]/.test(line)) row.classList.add('is-task');
          return row;
        }));
        card.preview.hidden = !lines.length;
        // Preview promises settle between animation and paint: place the newly
        // taller card now so it never paints on top of the following card.
        masonry.layoutNow();
      } catch (_error) {
        if (inScope() && epoch === previewEpoch && cards.get(uid) === card) {
          card.preview.textContent = copy.previewError;
          card.preview.hidden = false;
          masonry.layoutNow();
        }
      }
    }

    function applyViewOrder(uid, target, after) {
      if (!checkScope() || status !== 'ready' || selectedUid) return;
      viewOrders.set(orderKey, moveDeskTask(tasks, uid, target, after));
      if (viewOrders.size > 64) viewOrders.delete(viewOrders.keys().next().value);
      tasks = orderDeskTasks(outlineTasks, viewOrders.get(orderKey));
      renderCards();
      cards.get(uid)?.button.focus({ preventScroll: true });
      movement.textContent = copy.moved;
    }

    function renderCards() {
      const focusedCard = root.contains(document.activeElement)
        ? document.activeElement?.closest?.('.nautilus-desk__card')?.dataset.taskUid
        : null;
      const live = new Set(tasks.map(({ uid }) => uid));
      for (const [uid, card] of cards) {
        if (live.has(uid)) continue;
        observer?.unobserve(card.button);
        card.button.remove();
        cards.delete(uid);
        previews.delete(uid);
        scrollPositions.delete(uid);
      }
      tasks.forEach((task, index) => {
        let card = cards.get(task.uid);
        if (!card) {
          const item = button(plainDeskText(task.title), () => showTask(task.uid));
          item.className = 'nautilus-desk__card';
          item.dataset.taskUid = task.uid;
          item.draggable = true;
          const heading = element('span', 'nautilus-desk__card-title');
          const statusIcon = element('span', 'nautilus-desk__task-box');
          statusIcon.setAttribute('aria-hidden', 'true');
          const headingText = element('span');
          heading.append(statusIcon, headingText);
          const preview = element('span', 'nautilus-desk__preview');
          preview.hidden = true;
          const date = element('span', 'nautilus-desk__date', pageTitle);
          date.hidden = !pageTitle;
          const grip = element('span', 'nautilus-desk__grip', '⠿');
          grip.setAttribute('aria-hidden', 'true');
          item.replaceChildren(grip, heading, preview, date);
          card = { button: item, heading: headingText, preview };
          cards.set(task.uid, card);
        }
        const label = plainDeskText(task.title);
        card.heading.textContent = `${label} ${compactMinutes(task.plannedMinutes)}`;
        card.button.setAttribute('aria-label', label);
        card.button.title = `${label}\n${copy.drag}`;
        card.button.disabled = status !== 'ready';
        card.button.draggable = status === 'ready';
        if (grid.children[index] !== card.button) grid.insertBefore(card.button, grid.children[index] || null);
        if (!previews.has(task.uid)) {
          if (observer) observer.observe(card.button);
          else previewQueue.add(task.uid);
        }
      });
      masonry.setItems(tasks.map((task) => cards.get(task.uid).button));
      if (focusedCard && !selectedUid) {
        const target = status === 'ready'
          ? cards.get(focusedCard)?.button || cards.values().next().value?.button || back
          : back;
        target.focus({ preventScroll: true });
      }
      summary.textContent = status === 'ready' ? `(${tasks.length})` : '';
      summary.setAttribute('aria-label', status === 'ready' ? copy.count(tasks.length) : '');
      resetOrder.hidden = !viewOrders.has(orderKey);
      empty.hidden = tasks.length > 0;
      empty.textContent = status === 'missing' ? copy.missing : status === 'ready' ? copy.empty : copy.unavailable;
      notice.hidden = status === 'ready' || status === 'loading' || !tasks.length;
      notice.textContent = status === 'missing' ? copy.missing : tasks.length ? copy.stale : copy.unavailable;
      root.dataset.status = status;
      schedulePreviews();
    }

    function acceptSnapshot(snapshot) {
      if (!checkScope()) return;
      if (composing && !snapshot?.unavailable && !snapshot?.missing) {
        deferredSnapshot = snapshot;
        return;
      }
      deferredSnapshot = null; // A fresh watch result supersedes any queued IME snapshot.
      const previousTasks = tasks;
      if (snapshot?.missing) {
        status = 'missing';
        outlineTasks = tasks = [];
      } else {
        try {
          outlineTasks = projectDeskTasks(snapshot, planUid, { fallbackMinutes: getSettings()['todo-duration'] ?? 15, readString });
          tasks = orderDeskTasks(outlineTasks, viewOrders.get(orderKey));
          status = 'ready';
        } catch (_error) {
          status = 'unavailable'; // Keep last-good cards visibly stale, never a false empty success.
        }
      }
      if (status !== 'ready' || tasks.map((task) => task.uid).join() !== previousTasks.map((task) => task.uid).join()) drag.cancel();
      const nextUid = reconcileDeskSelection(previousTasks, tasks, selectedUid);
      if (status !== 'ready' || !nextUid) {
        if (selectedUid) showOverview();
      } else if (nextUid !== selectedUid) {
        showTask(nextUid);
      }
      renderCards();
      if (selectedUid) updatePosition(); // Never remount an editor just because its text changed.
    }

    function refresh(clearPreviews = false) {
      if (!checkScope()) return;
      if (clearPreviews) { previewEpoch += 1; previews.clear(); }
      try { acceptSnapshot(readPlan(planUid)); }
      catch (_error) { acceptSnapshot({ unavailable: true }); }
    }

    const onKey = (event) => {
      if ((!root.contains(event.target) && !layer.contains(event.target) && event.target !== origin) || !checkScope() || composing) return;
      const action = deskShortcut(event);
      if (action && (action === 'back' || selectedUid)) {
        event.preventDefault();
        event.stopPropagation();
        if (action === 'back') { if (selectedUid) showOverview(); else close(); }
        else step(action === 'next' ? 1 : -1);
        return;
      }
      // Do not intercept native editor Tab indentation or its portal/menu shortcuts.
      if (!selectedUid || event.key !== 'Tab' || event.defaultPrevented || event.target.closest('textarea,input,[contenteditable="true"]')) return;
      const surface = focus;
      const stops = [...surface.querySelectorAll('button:not(:disabled),[tabindex="0"]')]
        .filter((node) => !node.closest('[hidden],[inert]'));
      const first = stops[0];
      const last = stops.at(-1);
      if (first && ((event.shiftKey && (document.activeElement === first || document.activeElement === focus))
        || (!event.shiftKey && document.activeElement === last))) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const onCompositionStart = () => { composing = true; };
    const onCompositionEnd = () => {
      composing = false;
      if (compositionFrame !== null) host.cancelAnimationFrame(compositionFrame);
      compositionFrame = host.requestAnimationFrame(() => {
        compositionFrame = null;
        if (!deferredSnapshot || closed) return;
        const snapshot = deferredSnapshot;
        deferredSnapshot = null;
        acceptSnapshot(snapshot);
      });
    };
    const onNavigation = () => close(false);
    const onVisible = () => { if (document.visibilityState !== 'hidden') refresh(); };

    function close(restoreFocus = true) {
      if (closed) return;
      closed = true;
      selectedUid = null;
      dropEditor();
      stopWatch?.();
      stopWatch = null;
      observer?.disconnect();
      masonry.destroy();
      drag.destroy();
      if (previewFrame !== null) host.cancelAnimationFrame(previewFrame);
      if (compositionFrame !== null) host.cancelAnimationFrame(compositionFrame);
      previewQueue.clear();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      host.removeEventListener('hashchange', onNavigation);
      host.removeEventListener('focus', onVisible);
      host.removeEventListener('nautilus-log:settings-changed', onVisible);
      root.remove();
      layer.remove();
      if (focusOwner === session) focusOwner = null;
      if (!document.querySelector('.nautilus-desk__focus-layer')) document.body.classList.remove('nautilus-desk-focus-open');
      if (sessions.get(container) === session) sessions.delete(container);
      origin?.setAttribute?.('aria-expanded', 'false');
      if (restoreFocus && origin?.isConnected && inOriginalGraph()) origin.focus?.({ preventScroll: true });
    }
    const inOriginalGraph = () => host.roamAlphaAPI === roam && graphName(host) === graph;

    function start() {
      if (origin?.closest?.('.bp3-dark,.rm-dark-theme,.dark') || document.querySelector('.roam-app.rm-dark-theme')) {
        root.classList.add('nautilus-desk--dark', 'bp3-dark');
        layer.classList.add('nautilus-desk--dark', 'bp3-dark');
      }
      container.append(root);
      origin?.setAttribute?.('aria-expanded', 'true');
      // Inline content follows the page's normal scroll and keyboard navigation.
      // Leave focus on the toggle instead of scrolling the user away from the chart.
      document.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onVisible);
      host.addEventListener('hashchange', onNavigation);
      host.addEventListener('focus', onVisible);
      host.addEventListener('nautilus-log:settings-changed', onVisible);
      layer.addEventListener('compositionstart', onCompositionStart);
      layer.addEventListener('compositionend', onCompositionEnd);
      if (typeof host.IntersectionObserver === 'function') {
        observer = new host.IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            previewQueue.add(entry.target.dataset.taskUid);
          }
          schedulePreviews();
        }, { root: null, rootMargin: '150px' });
      }
      if (!graph) { status = 'unavailable'; renderCards(); return; }
      try {
        stopWatch = watchPlan(planUid, acceptSnapshot, { emitInitial: false });
        refresh(); // Do not trust a cached initial watch snapshot when reopening Desk.
      } catch (_error) {
        status = 'unavailable';
        renderCards();
      }
    }
    const session = { root, start, close, showOverview };
    return session;
  }

  const closeAll = () => { for (const session of [...sessions.values()]) session.close(false); };
  return {
    open,
    close: closeAll,
    closeForHost: (container) => sessions.get(container)?.close(false),
    destroy: () => { destroyed = true; closeAll(); viewOrders.clear(); },
  };
}
