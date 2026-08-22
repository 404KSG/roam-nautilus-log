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
  let deleteConfirmation = null;
  let unscheduledExpanded = false;

  const clearDeleteConfirmation = () => {
    if (!deleteConfirmation) return;
    window.clearTimeout(deleteConfirmation.timer);
    const button = deleteConfirmation.button;
    button?.classList.remove('is-confirming');
    button?.setAttribute('aria-label', 'Delete current CLOCK');
    if (button) button.title = 'Delete current CLOCK';
    deleteConfirmation = null;
  };

  const cancelDeferredRefresh = () => {
    if (deferredRefreshFrame !== null) window.cancelAnimationFrame?.(deferredRefreshFrame);
    if (deferredRefreshTimer !== null) window.clearTimeout(deferredRefreshTimer);
    deferredRefreshFrame = null;
    deferredRefreshTimer = null;
  };

  const closePopover = ({ restoreFocus = false } = {}) => {
    if (!popover) return;
    cancelDeferredRefresh();
    clearDeleteConfirmation();
    popover.remove();
    popover = null;
    lastPopoverKey = null;
    document.removeEventListener('mousedown', outsideHandler, true);
    document.removeEventListener('keydown', keyHandler, true);
    outsideHandler = null;
    keyHandler = null;
    unscheduledExpanded = false;
    trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger?.focus();
  };

  const runAction = async (action) => {
    try { await action(); } catch (error) { console.error('[Nautilus Log] timing action failed', error); }
  };

  const taskRow = (task, {
    recent = false,
    entry = null,
    planState = '',
    planStart = null,
    planEnd = null,
  } = {}) => {
    const row = element('div', 'nautilus-log-timing__row');
    row.dataset.taskUid = task.uid;
    if (planState) row.classList.add(`is-${planState}`);
    const focused = state.activeWork?.focused?.taskUid === task.uid;
    if (focused) row.classList.add('is-focused');
    const forgottenMinutes = extensionAPI.settings.get('forgotten-timer-minutes') ?? 120;
    const forgotten = focused && timingCore.isForgottenClock(entry || state.activeWork?.focused, state.now, forgottenMinutes);
    if (forgotten) row.classList.add('is-forgotten');

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
    const recentRemaining = recent && entry?.end
      ? Math.max(0, Math.ceil((Number(state.activeWork?.windowMinutes || 0) * 60000 - (state.now - entry.end)) / 60000))
      : null;
    const timingText = focused
      ? `Timing ${timingCore.formatElapsed(state.now - state.activeWork.focused.start)} · ${duration.detailLabel}`
      : '';
    const remainingPlanMinutes = Math.max(0, Number(task.remainingMinutes) || 0);
    const planDurationText = remainingPlanMinutes > 0 && remainingPlanMinutes < task.plannedMinutes
      ? `Remaining ${timingCore.compactMinutes(remainingPlanMinutes)} · Planned ${timingCore.compactMinutes(task.plannedMinutes)}`
      : `Planned ${timingCore.compactMinutes(task.plannedMinutes)}`;
    let metaText = duration.detailLabel;
    if (planState === 'scheduled') {
      metaText = `Today ${formatPlanClock(planStart)}–${formatPlanClock(planEnd)} · ${planDurationText}`;
    } else if (planState === 'unscheduled') {
      metaText = `Unscheduled today · ${planDurationText}`;
    } else if (focused) {
      metaText = `${forgotten ? 'Check CLOCK · ' : ''}${timingText}`;
    } else if (recent) {
      metaText = `Recent · ${timingCore.compactMinutes(recentRemaining)} left · ${duration.detailLabel}`;
    }
    const meta = element('div', `nautilus-log-timing__row-meta${focused ? ' is-live' : ''}${forgotten ? ' is-warning' : ''}`, metaText);
    copy.append(meta);
    row.append(copy);

    const actions = element('div', 'nautilus-log-timing__row-actions');
    const timingAction = iconButton(focused ? 'log-out' : 'play', focused ? 'Clock Out' : 'Clock In', () => {
      runAction(() => focused ? runtime.stopTask() : runtime.startTask(task.uid));
    });
    const completeAction = iconButton('confirm', 'Complete task', () => runAction(() => runtime.completeTask(task.uid)));
    completeAction.classList.add('is-complete');
    timingAction.disabled = state.status === 'working';
    completeAction.disabled = state.status === 'working';
    actions.append(timingAction, completeAction);
    if (focused) {
      const deleteAction = iconButton('trash', 'Delete current CLOCK', () => {
        const clockUid = state.activeWork?.focused?.clockUid;
        if (!clockUid) return;
        if (deleteConfirmation?.clockUid === clockUid) {
          clearDeleteConfirmation();
          deleteAction.disabled = true;
          runAction(() => runtime.deleteCurrentClock(task.uid));
          return;
        }
        clearDeleteConfirmation();
        deleteAction.classList.add('is-confirming');
        deleteAction.title = 'Click again to delete current CLOCK';
        deleteAction.setAttribute('aria-label', 'Click again to delete current CLOCK');
        deleteConfirmation = {
          button: deleteAction,
          clockUid,
          timer: window.setTimeout(clearDeleteConfirmation, 2500),
        };
      });
      deleteAction.classList.add('is-delete-clock');
      deleteAction.disabled = state.status === 'working';
      actions.append(deleteAction);
    }
    row.append(actions);
    return row;
  };

  const formatPlanClock = (minutes) => {
    const safe = Math.max(0, Math.min(1440, Math.round(Number(minutes) || 0)));
    if (safe === 1440) return '24:00';
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  };

  const taskMinutes = (tasks = []) => tasks.reduce(
    (total, task) => total + Math.max(0, Number(task.duration ?? task.remainingMinutes ?? task.plannedMinutes) || 0),
    0,
  );

  const capacityStrip = (execution) => {
    // Use a neutral div instead of section so Roam themes cannot accidentally
    // apply editorial/serif section typography to this compact UI strip.
    const strip = element('div', 'nautilus-log-timing__capacity');
    strip.setAttribute('aria-label', 'Today capacity');
    const available = element('span', 'nautilus-log-timing__capacity-metric');
    available.append('Available ', element('strong', '', timingCore.compactMinutes(execution.availableMinutes || 0)));
    let statusLabel = 'Remaining';
    let statusMinutes = execution.slackMinutes || 0;
    let warning = false;
    if (execution.overloadMinutes > 0) {
      statusLabel = 'Overload';
      statusMinutes = execution.overloadMinutes;
      warning = true;
    } else if (execution.unplacedMinutes > 0) {
      statusLabel = 'No fitting slot';
      statusMinutes = execution.unplacedMinutes;
      warning = true;
    }
    const status = element(
      'span',
      `nautilus-log-timing__capacity-metric${warning ? ' is-warning' : ''}`,
    );
    status.append(`${statusLabel} `, element('strong', '', timingCore.compactMinutes(statusMinutes)));
    strip.append(available, status);
    return strip;
  };

  const planSectionHeader = ({ label, tasks, collapsible = false, expanded = true }) => {
    const tag = collapsible ? 'button' : 'div';
    const header = element(tag, `nautilus-log-timing__plan-heading${collapsible ? ' is-collapsible' : ''}`);
    if (collapsible) {
      header.type = 'button';
      header.setAttribute('aria-expanded', String(expanded));
    }
    const labelNode = element('span', 'nautilus-log-timing__plan-label');
    if (collapsible) labelNode.append(icon(expanded ? 'chevron-down' : 'chevron-right'));
    labelNode.append(label);
    const duration = timingCore.compactMinutes(taskMinutes(tasks));
    header.append(labelNode, element('span', 'nautilus-log-timing__plan-total', `${tasks.length} · ${duration}`));
    return header;
  };

  const activeTask = (entry) => ({
    uid: entry.taskUid,
    title: entry.title,
    plannedMinutes: timingCore.plannedMinutes(entry.taskString, Number(extensionAPI.settings.get('todo-duration')) || 15),
  });

  const signedMinutes = (minutes) => {
    const value = Number(minutes) || 0;
    if (value === 0) return '0m';
    return `${value > 0 ? '+' : '−'}${timingCore.compactMinutes(Math.abs(value))}`;
  };

  const reviewSummary = (summary = {}) => {
    const section = element('section', 'nautilus-log-timing__review-summary');
    section.setAttribute('aria-label', 'Today review summary');
    const counts = element('div', 'nautilus-log-timing__review-counts');
    const completed = element('span', 'nautilus-log-timing__review-count');
    completed.append('Completed ', element('strong', '', `${summary.completedCount || 0}/${summary.totalCount || 0}`));
    const compared = element('span', 'nautilus-log-timing__review-count');
    compared.append('Compared ', element('strong', '', String(summary.comparedCount || 0)));
    counts.append(completed, compared);

    const totals = element('div', 'nautilus-log-timing__review-totals');
    const metric = (label, value, className = '') => {
      const item = element('span', `nautilus-log-timing__review-total${className ? ` ${className}` : ''}`);
      item.append(`${label} `, element('strong', '', value));
      return item;
    };
    const variance = Number(summary.varianceMinutes) || 0;
    const comparable = Number(summary.comparedCount) > 0;
    totals.append(
      metric('Planned', comparable ? timingCore.compactMinutes(summary.plannedMinutes || 0) : '—'),
      metric('Actual', comparable ? timingCore.compactMinutes(summary.actualMinutes || 0) : '—'),
      metric('Variance', comparable ? signedMinutes(variance) : '—', comparable && variance > 0 ? 'is-over' : ''),
    );
    section.append(counts, totals);
    return section;
  };

  const reviewRow = (task) => {
    const stateLabels = {
      compared: 'Compared',
      live: 'Live',
      paused: 'Paused',
      'not-tracked': 'Not tracked',
      'not-started': 'Not started',
    };
    const row = element('div', `nautilus-log-timing__review-row is-${task.state}`);
    row.dataset.taskUid = task.uid;
    const heading = element('div', 'nautilus-log-timing__review-row-heading');
    const title = element('button', 'nautilus-log-timing__review-title', task.title);
    title.type = 'button';
    title.title = task.title;
    title.addEventListener('click', (event) => {
      closePopover();
      runAction(() => runtime.openTask(task.uid, { sidebar: event.shiftKey }));
    });
    heading.append(title, element('span', 'nautilus-log-timing__review-state', stateLabels[task.state] || task.state));

    const metrics = element('div', 'nautilus-log-timing__review-row-metrics');
    metrics.append(element('span', '', `Planned ${timingCore.compactMinutes(task.plannedMinutes)}`));
    const actualLabel = task.state === 'not-tracked' || task.state === 'not-started'
      ? 'Actual —'
      : `Actual ${timingCore.compactMinutes(task.actualMinutes)}`;
    const actual = element('span', 'nautilus-log-timing__review-actual', actualLabel);
    if (task.state === 'live') actual.dataset.reviewLiveActual = task.uid;
    metrics.append(actual);
    if (task.state === 'compared') {
      const variance = element(
        'span',
        `nautilus-log-timing__review-variance${task.varianceMinutes > 0 ? ' is-over' : ''}`,
        signedMinutes(task.varianceMinutes),
      );
      metrics.append(variance);
    }
    row.append(heading, metrics);
    return row;
  };

  const updateLiveElapsed = () => {
    if (!popover) return;
    const focused = state.activeWork?.focused;
    if (!focused) return;
    if (view === 'review') {
      const actual = [...popover.querySelectorAll('[data-review-live-actual]')]
        .find((candidate) => candidate.dataset.reviewLiveActual === focused.taskUid);
      if (!actual) return;
      const task = state.dailyReview?.rows?.find((candidate) => candidate.uid === focused.taskUid)
        || activeTask(focused);
      const duration = timingCore.durationMetadata({
        taskUid: focused.taskUid,
        plannedMinutes: task.plannedMinutes,
        entries: state.entries,
        now: state.now,
      });
      actual.textContent = `Actual ${timingCore.compactMinutes(duration.actualMinutes)}`;
      return;
    }
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
    const forgottenMinutes = extensionAPI.settings.get('forgotten-timer-minutes') ?? 120;
    const forgotten = timingCore.isForgottenClock(focused, state.now, forgottenMinutes);
    row.classList.toggle('is-forgotten', forgotten);
    meta.classList.toggle('is-warning', forgotten);
    meta.textContent = `${forgotten ? 'Check CLOCK · ' : ''}Timing ${timingCore.formatElapsed(state.now - focused.start)} · ${duration.detailLabel}`;
  };

  const syncActionAvailability = () => {
    if (!popover) return;
    const disabled = state.status === 'working';
    popover.querySelectorAll('.nautilus-log-timing__row-actions button')
      .forEach((button) => { button.disabled = disabled; });
  };

  const renderPopover = ({ force = false } = {}) => {
    if (!popover) return;
    if (!force && state.status === 'working' && lastPopoverKey !== null) {
      // A queued graph mutation changes only button availability. Rebuilding
      // every task row here competes with Roam's native sidebar first paint;
      // the confirmed refresh below will render the new data once.
      syncActionAvailability();
      updateLiveElapsed();
      return;
    }
    const structureKey = timingCore.executionStructureKey(state, view);
    if (!force && structureKey === lastPopoverKey) {
      updateLiveElapsed();
      return;
    }
    lastPopoverKey = structureKey;
    popover.replaceChildren();

    const header = element('div', 'nautilus-log-timing__popover-header');
    const headerMain = element('div', 'nautilus-log-timing__popover-header-main');
    const identity = element('button', 'nautilus-log-timing__identity');
    identity.type = 'button';
    identity.title = 'Locate Primary Nautilus';
    identity.setAttribute('aria-label', 'Locate Primary Nautilus');
    const identityHint = icon('chevron-right');
    identityHint.classList.add('nautilus-log-timing__identity-hint');
    identity.append(icon('unresolve'), element('span', 'nautilus-log-timing__identity-name', 'Nautilus'), identityHint);
    identity.addEventListener('click', () => {
      closePopover();
      runAction(() => runtime.locate());
    });
    const identityDivider = element('span', 'nautilus-log-timing__identity-divider');
    identityDivider.setAttribute('aria-hidden', 'true');
    const tabs = element('div', 'nautilus-log-timing__tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Nautilus execution views');
    ['timing', 'plan', 'review'].forEach((name) => {
      const button = element('button', `nautilus-log-timing__tab${view === name ? ' is-active' : ''}`, {
        timing: 'Timing',
        plan: 'Plan',
        review: 'Review',
      }[name]);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(view === name));
      button.addEventListener('click', () => {
        if (view === name) return;
        view = name;
        renderPopover({ force: true });
      });
      tabs.append(button);
    });
    headerMain.append(identity, identityDivider, tabs);
    header.append(headerMain);
    popover.append(header);

    if (state.notice) {
      const notice = element('div', 'nautilus-log-timing__notice', state.notice);
      notice.setAttribute('role', 'status');
      popover.append(notice);
    }

    const execution = state.planSnapshot?.execution;
    if (execution) popover.append(capacityStrip(execution));

    const list = element('div', 'nautilus-log-timing__list');
    if (view === 'timing') {
      const focused = state.activeWork?.focused;
      if (focused) list.append(taskRow(activeTask(focused), { entry: focused }));
      (state.activeWork?.recent || []).forEach((entry) => list.append(taskRow(activeTask(entry), { recent: true, entry })));
      if (!focused && !(state.activeWork?.recent || []).length) {
        list.append(element('div', 'nautilus-log-timing__empty', 'No active work. Open Plan to start a task.'));
      }
    } else if (view === 'plan') {
      const tasks = state.planSnapshot?.tasks || [];
      list.classList.add('is-plan');
      const scheduled = execution?.scheduledTasks || [];
      const unscheduled = execution?.overflowTasks || [];
      if (tasks.length && execution) {
        const scheduledSection = element('section', 'nautilus-log-timing__plan-section is-scheduled');
        scheduledSection.append(planSectionHeader({ label: 'Scheduled today', tasks: scheduled }));
        scheduled.forEach((task) => scheduledSection.append(taskRow(task, {
          planState: 'scheduled',
          planStart: task.start,
          planEnd: task.end,
        })));
        list.append(scheduledSection);

        if (unscheduled.length) {
          const unscheduledSection = element('section', 'nautilus-log-timing__plan-section is-unscheduled');
          const disclosure = planSectionHeader({
            label: 'Unscheduled today',
            tasks: unscheduled,
            collapsible: true,
            expanded: unscheduledExpanded,
          });
          disclosure.addEventListener('click', () => {
            unscheduledExpanded = !unscheduledExpanded;
            renderPopover({ force: true });
          });
          unscheduledSection.append(disclosure);
          if (unscheduledExpanded) {
            unscheduled.forEach((task) => unscheduledSection.append(taskRow(task, { planState: 'unscheduled' })));
          }
          list.append(unscheduledSection);
        }
      } else {
        tasks.forEach((task) => list.append(taskRow(task)));
      }
      if (!state.planSnapshot?.plan) {
        list.append(element('div', 'nautilus-log-timing__empty', 'No Nautilus Log was found on today’s Daily Note.'));
      } else if (!tasks.length) {
        list.append(element('div', 'nautilus-log-timing__empty', 'The Primary Plan has no unfinished direct-child tasks.'));
      }
    } else if (view === 'review') {
      const review = state.dailyReview || timingCore.buildDailyReview();
      list.classList.add('is-review');
      if (state.planSnapshot?.plan && review.rows.length) popover.append(reviewSummary(review.summary));
      review.rows.forEach((task) => list.append(reviewRow(task)));
      if (!state.planSnapshot?.plan) {
        list.append(element('div', 'nautilus-log-timing__empty', 'No Nautilus Log was found on today’s Daily Note.'));
      } else if (!review.rows.length) {
        list.append(element('div', 'nautilus-log-timing__empty', 'The Primary Plan has no direct-child tasks to review.'));
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
        trigger.replaceChildren(icon('unresolve'));
        triggerMode = 'idle';
      }
      trigger.classList.remove('is-active', 'is-overdue', 'is-forgotten');
      trigger.setAttribute('aria-label', 'Open Nautilus Log execution panel');
      trigger.title = 'Nautilus Log';
    } else {
      const elapsed = timingCore.formatElapsed(state.now - focused.start);
      const count = state.activeWork.count;
      const pomodoroMinutes = Number(extensionAPI.settings.get('pomodoro-minutes')) || 45;
      const pomodoroElapsed = state.pomodoro ? state.now.getTime() - Number(state.pomodoro.startedAt) : 0;
      const forgottenMinutes = extensionAPI.settings.get('forgotten-timer-minutes') ?? 120;
      const forgotten = timingCore.isForgottenClock(focused, state.now, forgottenMinutes);
      if (triggerMode !== 'active') {
        const forgottenSignal = element('span', 'nautilus-log-timing__forgotten-signal');
        forgottenSignal.append(icon('warning-sign'));
        trigger.replaceChildren(
          element('span', 'nautilus-log-timing__elapsed'),
          element('span', 'nautilus-log-timing__trigger-separator', '·'),
          element('span', 'nautilus-log-timing__threads'),
          forgottenSignal,
        );
        triggerMode = 'active';
      }
      trigger.classList.add('is-active');
      trigger.classList.toggle('is-overdue', pomodoroElapsed >= pomodoroMinutes * 60000);
      trigger.classList.toggle('is-forgotten', forgotten);
      trigger.querySelector('.nautilus-log-timing__elapsed').textContent = elapsed;
      trigger.querySelector('.nautilus-log-timing__threads').textContent = `${count} Thread${count === 1 ? '' : 's'}`;
      trigger.setAttribute('aria-label', `${forgotten ? 'Check CLOCK, ' : ''}${elapsed}, ${count} active thread${count === 1 ? '' : 's'}`);
      trigger.title = `${forgotten ? 'Check CLOCK · ' : ''}${focused.title}`;
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
    clearDeleteConfirmation();
    container?.remove();
    container = null;
    trigger = null;
  };

  return { initialize, destroy, ensureMounted };
}
