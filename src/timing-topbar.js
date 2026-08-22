import * as timingCore from './timing-core';

const TOPBAR_ID = 'nautilus-log-timing-topbar';
const POPOVER_ID = 'nautilus-log-timing-popover';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const node = element('span', `bp3-icon bp3-icon-${name}`);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function iconButton(name, label, onClick) {
  const button = element('button', 'nautilus-log-timing__icon-button');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(icon(name));
  button.addEventListener('click', onClick);
  return button;
}

function placeAfterNavigation(topbar, container) {
  const signals = [...topbar.querySelectorAll('button, a, [role="button"], span')];
  const signal = signals.find((node) => /forward|arrow-right|chevron-right/i.test([
    node.className,
    node.getAttribute?.('data-icon'),
    node.getAttribute?.('aria-label'),
    node.getAttribute?.('title'),
  ].filter(Boolean).join(' '))) || signals.find((node) => /back|arrow-left|chevron-left/i.test([
    node.className,
    node.getAttribute?.('data-icon'),
    node.getAttribute?.('aria-label'),
    node.getAttribute?.('title'),
  ].filter(Boolean).join(' ')));
  const anchor = signal?.closest?.('button, a, [role="button"]') || signal;
  if (anchor?.parentNode) anchor.parentNode.insertBefore(container, anchor.nextSibling);
  else topbar.insertBefore(container, topbar.firstChild?.nextSibling || null);
}

export function createTimingTopbar({ runtime, extensionAPI }) {
  let destroyed = false;
  let container = null;
  let trigger = null;
  let popover = null;
  let observers = [];
  let unsubscribe = null;
  let outsideHandler = null;
  let keyHandler = null;
  let view = 'timing';
  let state = runtime.getSnapshot();
  let lastPopoverKey = null;
  let deferredRefreshFrame = null;
  let deferredRefreshTimer = null;
  let triggerMode = null;

  const cancelDeferredRefresh = () => {
    if (deferredRefreshFrame !== null) window.cancelAnimationFrame?.(deferredRefreshFrame);
    if (deferredRefreshTimer !== null) window.clearTimeout(deferredRefreshTimer);
    deferredRefreshFrame = null;
    deferredRefreshTimer = null;
  };

  const closePopover = ({ restoreFocus = false } = {}) => {
    if (!popover) return;
    cancelDeferredRefresh();
    popover.remove();
    popover = null;
    lastPopoverKey = null;
    document.removeEventListener('mousedown', outsideHandler, true);
    document.removeEventListener('keydown', keyHandler, true);
    outsideHandler = null;
    keyHandler = null;
    trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger?.focus();
  };

  const runAction = async (action) => {
    try { await action(); } catch (error) { console.error('[Nautilus Log] timing action failed', error); }
  };

  const taskRow = (task, { recent = false } = {}) => {
    const row = element('div', 'nautilus-log-timing__row');
    row.dataset.taskUid = task.uid;
    const focused = state.activeWork?.focused?.taskUid === task.uid;
    if (focused) row.classList.add('is-focused');

    const copy = element('div', 'nautilus-log-timing__row-copy');
    const title = element('button', 'nautilus-log-timing__row-title', task.title);
    title.type = 'button';
    title.title = task.title;
    title.addEventListener('click', (event) => {
      closePopover();
      runAction(() => runtime.openTask(task.uid, { sidebar: event.shiftKey }));
    });
    copy.append(title);
    const duration = timingCore.durationMetadata({
      taskUid: task.uid,
      plannedMinutes: task.plannedMinutes,
      entries: state.entries,
      now: state.now,
    });
    const metaText = focused
      ? `Timing ${timingCore.formatElapsed(state.now - state.activeWork.focused.start)} · ${duration.detailLabel}`
      : recent ? `Recent · ${duration.detailLabel}` : duration.detailLabel;
    const meta = element('div', `nautilus-log-timing__row-meta${focused ? ' is-live' : ''}`, metaText);
    copy.append(meta);
    row.append(copy);

    const actions = element('div', 'nautilus-log-timing__row-actions');
    const timingAction = iconButton(focused ? 'log-out' : 'play', focused ? 'Clock Out' : 'Clock In', () => {
      runAction(() => focused ? runtime.stopTask() : runtime.startTask(task.uid));
    });
    const completeAction = iconButton('tick', 'Complete task', () => runAction(() => runtime.completeTask(task.uid)));
    timingAction.disabled = state.status === 'working';
    completeAction.disabled = state.status === 'working';
    actions.append(timingAction, completeAction);
    row.append(actions);
    return row;
  };

  const activeTask = (entry) => ({
    uid: entry.taskUid,
    title: entry.title,
    plannedMinutes: timingCore.plannedMinutes(entry.taskString, Number(extensionAPI.settings.get('todo-duration')) || 15),
  });

  const updateLiveElapsed = () => {
    if (!popover) return;
    const focused = state.activeWork?.focused;
    if (!focused) return;
    const row = [...popover.querySelectorAll('.nautilus-log-timing__row')]
      .find((candidate) => candidate.dataset.taskUid === focused.taskUid);
    const meta = row?.querySelector('.nautilus-log-timing__row-meta.is-live');
    if (!meta) return;
    const task = activeTask(focused);
    const duration = timingCore.durationMetadata({
      taskUid: task.uid,
      plannedMinutes: task.plannedMinutes,
      entries: state.entries,
      now: state.now,
    });
    meta.textContent = `Timing ${timingCore.formatElapsed(state.now - focused.start)} · ${duration.detailLabel}`;
  };

  const renderPopover = ({ force = false } = {}) => {
    if (!popover) return;
    const structureKey = timingCore.executionStructureKey(state, view);
    if (!force && structureKey === lastPopoverKey) {
      updateLiveElapsed();
      return;
    }
    lastPopoverKey = structureKey;
    popover.replaceChildren();

    const header = element('div', 'nautilus-log-timing__popover-header');
    const tabs = element('div', 'nautilus-log-timing__tabs');
    ['timing', 'plan'].forEach((name) => {
      const button = element('button', `nautilus-log-timing__tab${view === name ? ' is-active' : ''}`, name === 'timing' ? 'Timing' : 'Plan');
      button.type = 'button';
      button.addEventListener('click', () => {
        if (view === name) return;
        view = name;
        renderPopover({ force: true });
      });
      tabs.append(button);
    });
    header.append(tabs);
    header.append(iconButton('locate', 'Locate Primary Nautilus Log', () => {
      closePopover();
      runAction(() => runtime.locate());
    }));
    popover.append(header);

    if (state.notice) {
      const notice = element('div', 'nautilus-log-timing__notice', state.notice);
      notice.setAttribute('role', 'status');
      popover.append(notice);
    }

    const list = element('div', 'nautilus-log-timing__list');
    if (view === 'timing') {
      const focused = state.activeWork?.focused;
      if (focused) list.append(taskRow(activeTask(focused)));
      (state.activeWork?.recent || []).forEach((entry) => list.append(taskRow(activeTask(entry), { recent: true })));
      if (!focused && !(state.activeWork?.recent || []).length) {
        list.append(element('div', 'nautilus-log-timing__empty', 'No active work. Open Plan to start a task.'));
      }
    } else {
      const tasks = state.planSnapshot?.tasks || [];
      tasks.forEach((task) => list.append(taskRow(task)));
      if (!state.planSnapshot?.plan) {
        list.append(element('div', 'nautilus-log-timing__empty', 'No Nautilus Log was found on today’s Daily Note.'));
      } else if (!tasks.length) {
        list.append(element('div', 'nautilus-log-timing__empty', 'The Primary Plan has no unfinished direct-child tasks.'));
      }
    }
    popover.append(list);
  };

  const positionPopover = () => {
    if (!popover || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(260, Math.min(420, window.innerWidth - 24));
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    popover.style.width = `${width}px`;
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.min(window.innerHeight - 120, rect.bottom + 8)}px`;
  };

  const openPopover = async () => {
    if (popover) return closePopover({ restoreFocus: true });
    popover = element('section', 'nautilus-log-timing__popover');
    popover.id = POPOVER_ID;
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Nautilus Log execution panel');
    document.body.append(popover);
    trigger.setAttribute('aria-expanded', 'true');
    renderPopover({ force: true });
    positionPopover();
    const refreshAfterPaint = () => {
      deferredRefreshFrame = null;
      deferredRefreshTimer = window.setTimeout(() => {
        deferredRefreshTimer = null;
        if (popover) void runtime.requestRefresh();
      }, 0);
    };
    if (typeof window.requestAnimationFrame === 'function') {
      deferredRefreshFrame = window.requestAnimationFrame(refreshAfterPaint);
    } else {
      deferredRefreshTimer = window.setTimeout(() => {
        deferredRefreshTimer = null;
        if (popover) void runtime.requestRefresh();
      }, 0);
    }
    outsideHandler = (event) => {
      if (!popover?.contains(event.target) && !container?.contains(event.target)) closePopover();
    };
    keyHandler = (event) => {
      if (event.key === 'Escape') closePopover({ restoreFocus: true });
    };
    document.addEventListener('mousedown', outsideHandler, true);
    document.addEventListener('keydown', keyHandler, true);
  };

  const renderTrigger = () => {
    if (!trigger) return;
    const focused = state.activeWork?.focused;
    if (!focused) {
      if (triggerMode !== 'idle') {
        trigger.replaceChildren(icon('ring'));
        triggerMode = 'idle';
      }
      trigger.classList.remove('is-active', 'is-overdue');
      trigger.setAttribute('aria-label', 'Open Nautilus Log execution panel');
      trigger.title = 'Nautilus Log';
    } else {
      const elapsed = timingCore.formatElapsed(state.now - focused.start);
      const count = state.activeWork.count;
      const pomodoroMinutes = Number(extensionAPI.settings.get('pomodoro-minutes')) || 45;
      const pomodoroElapsed = state.pomodoro ? state.now.getTime() - Number(state.pomodoro.startedAt) : 0;
      if (triggerMode !== 'active') {
        trigger.replaceChildren(
          element('span', 'nautilus-log-timing__elapsed'),
          element('span', 'nautilus-log-timing__trigger-separator', '·'),
          element('span', 'nautilus-log-timing__threads'),
        );
        triggerMode = 'active';
      }
      trigger.classList.add('is-active');
      trigger.classList.toggle('is-overdue', pomodoroElapsed >= pomodoroMinutes * 60000);
      trigger.querySelector('.nautilus-log-timing__elapsed').textContent = elapsed;
      trigger.querySelector('.nautilus-log-timing__threads').textContent = `${count} Thread${count === 1 ? '' : 's'}`;
      trigger.setAttribute('aria-label', `${elapsed}, ${count} active thread${count === 1 ? '' : 's'}`);
      trigger.title = focused.title;
    }
  };

  const ensureMounted = () => {
    if (destroyed) return;
    const topbar = document.querySelector('.rm-topbar');
    if (!topbar) return;
    if (!container) {
      container = element('div', 'nautilus-log-timing__topbar');
      container.id = TOPBAR_ID;
      trigger = element('button', 'nautilus-log-timing__trigger');
      trigger.type = 'button';
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-controls', POPOVER_ID);
      trigger.setAttribute('aria-expanded', 'false');
      trigger.addEventListener('click', openPopover);
      container.append(trigger);
    }
    if (!container.isConnected || !topbar.contains(container)) placeAfterNavigation(topbar, container);
    renderTrigger();
  };

  const resetObservers = () => {
    observers.forEach((entry) => entry.disconnect());
    observers = [];
  };

  const watchTopbar = () => {
    resetObservers();
    const topbar = document.querySelector('.rm-topbar');
    const scheduleRecovery = () => queueMicrotask(() => {
      if (destroyed) return;
      ensureMounted();
      if (!document.getElementById(TOPBAR_ID) || !document.querySelector('.rm-topbar')?.contains(container)) watchTopbar();
    });
    if (!topbar) {
      const bootObserver = new MutationObserver(() => {
        if (document.querySelector('.rm-topbar')) {
          ensureMounted();
          watchTopbar();
        }
      });
      bootObserver.observe(document.body, { childList: true, subtree: true });
      observers.push(bootObserver);
      return;
    }
    const hostObserver = new MutationObserver(scheduleRecovery);
    hostObserver.observe(topbar, { childList: true });
    observers.push(hostObserver);
    if (topbar.parentElement) {
      const shellObserver = new MutationObserver(scheduleRecovery);
      shellObserver.observe(topbar.parentElement, { childList: true });
      observers.push(shellObserver);
    }
  };

  const initialize = () => {
    ensureMounted();
    watchTopbar();
    unsubscribe = runtime.subscribe((next) => {
      state = next;
      ensureMounted();
      if (popover) renderPopover();
    });
    return true;
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    closePopover();
    unsubscribe?.();
    unsubscribe = null;
    resetObservers();
    cancelDeferredRefresh();
    container?.remove();
    container = null;
    trigger = null;
  };

  return { initialize, destroy, ensureMounted };
}
