import * as timingCore from './timing-core';
import { createPlanDiagnostics, planEntryLabel, planActions, positionTopbarTooltip } from './today-plan-view';

const TOPBAR_ID = 'nautilus-log-timing-topbar';
const POPOVER_ID = 'nautilus-log-timing-popover';
const SHORTCUT_TOOLTIP_ID = 'nautilus-log-timing-shortcut-tooltip';
const ENERGY_CONFIRM_MS = 320;

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
  button.dataset.focusKey = name;
  button.setAttribute('aria-label', label);
  button.append(icon(name));
  button.addEventListener('click', onClick);
  return button;
}

function findSearchSurface(topbar) {
  const known = topbar?.querySelector?.('.rm-find-or-create-wrapper, .rm-find-or-create');
  if (known) return known;
  const input = [...(topbar?.querySelectorAll?.('input') || [])]
    .find((node) => /find|create|search/i.test(node.getAttribute('placeholder') || ''));
  return input?.closest?.('.bp3-input-group') || input?.parentElement || input || null;
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

export function createTimingTopbar({ runtime, extensionAPI, todayPlan } = {}) {
  let destroyed = false;
  let container = null;
  let trigger = null;
  let pomoCloseButton = null;
  let shortcutTooltip = null;
  let popover = null;
  let popoverPending = false;
  let pendingPresentChecks = 0;
  let settleDeferredRefresh = null;
  let observers = [];
  let unsubscribe = null;
  let unsubscribePlan = null;
  let outsideHandler = null;
  let keyHandler = null;
  let view = 'timing';
  let state = runtime.getSnapshot();
  let lastPopoverKey = null;
  let lastPopoverExecution = null;
  let pendingPopoverFocus = null;
  let deferredRefreshFrame = null;
  let deferredRefreshTimer = null;
  let triggerMode = null;
  let deleteConfirmation = null;
  let unscheduledExpanded = false;
  let settingsListener = null;
  let cachedCapacityExecution = null;
  let cachedCapacityLanguage = null;
  let cachedCapacitySummary = null;
  let shortcutTooltipKey = null;
  let observedTopbar = null;
  let observedSearch = null;
  let liveExecutionCache = null;
  let energyConfirmTimer = null;
  let activationGeneration = 0;

  const ui = () => timingCore.executionCopy(extensionAPI.settings.get('language') || 'en');
  const energyBarEnabled = () => extensionAPI.settings.get('energy-bar-enabled') === true;
  const todayPlanState = () => todayPlan?.getState?.() || null;
  const diagnostics = createPlanDiagnostics(todayPlan, () => trigger);
  const shouldUseTodayPlanEntry = () => {
    const status = todayPlanState()?.status;
    if (!status) return false;
    return status !== 'ready-present';
  };
  const activateTodayPlanEntry = (locateMode = 'main') => {
    const status = todayPlanState()?.status;
    if (status === 'ready-absent') return runAction(() => todayPlan.ensureToday({ locateMode }));
    if (status === 'nav-failed') return runAction(() => todayPlan.locateToday({ locateMode }));
    if (['read-failed','ready-blocked','partial'].includes(status)) {
      closePopover();
      return diagnostics.show();
    }
    return undefined;
  };
  const invalidateActivation = () => { activationGeneration += 1; };
  const recoverPresentPlan = (locateMode, onPresent, { deferPresentCheck } = {}) => {
    if (!todayPlan?.activateToday) return false;
    const roam = typeof window !== 'undefined' ? window.roamAlphaAPI : null;
    const generation = ++activationGeneration;
    const panelCheck = typeof deferPresentCheck === 'function';
    if (panelCheck) pendingPresentChecks += 1;
    void runAction(async () => {
      let result;
      try {
        result = await todayPlan.activateToday({ locateMode, ifPresent: 'keep', deferPresentCheck });
      } catch (error) {
        if (!destroyed && generation === activationGeneration && popoverPending) closePopover();
        throw error;
      }
      if (destroyed || generation !== activationGeneration) return;
      if (typeof window !== 'undefined' && window.roamAlphaAPI !== roam) {
        if (popoverPending) closePopover();
        return;
      }
      const status = result?.status || todayPlanState()?.status;
      if (['read-failed', 'ready-blocked', 'partial'].includes(status)) {
        closePopover();
        diagnostics.show();
        return;
      }
      if (result?.activation !== 'keep') {
        if (popoverPending) closePopover();
        return;
      }
      if (status === 'ready-present' || status === 'nav-failed') await onPresent?.();
    }).finally(() => {
      if (!panelCheck) return;
      pendingPresentChecks -= 1;
      if (!destroyed) renderTrigger();
    });
    return true;
  };

  const currentTriggerExecution = () => {
    const snapshot = state.planSnapshot;
    const planUi = todayPlanState();
    if (!snapshot?.plan || (planUi && (!['ready-present','nav-failed'].includes(planUi.status)
      || (planUi.planUid && planUi.planUid !== snapshot.plan.uid)))) return null;
    const execution = snapshot?.execution;
    if (!energyBarEnabled() || !snapshot?.plan) return execution || null;
    const workdayStart = extensionAPI.settings.get('workday-start') ?? 5;
    const workdayEnd = extensionAPI.settings.get('workday-end') ?? 21;
    const minute = Math.floor(state.now.getTime() / 60000);
    if (
      liveExecutionCache?.snapshot !== snapshot
      || liveExecutionCache.minute !== minute
      || liveExecutionCache.workdayStart !== workdayStart
      || liveExecutionCache.workdayEnd !== workdayEnd
    ) {
      liveExecutionCache = {
        snapshot,
        minute,
        workdayStart,
        workdayEnd,
        execution: timingCore.executionProjection(snapshot, state.now, {
          workdayStart,
          workdayEnd,
        }),
      };
    }
    return liveExecutionCache.execution;
  };

  const currentCapacitySummary = () => {
    const execution = currentTriggerExecution();
    if (!execution) return null;
    const language = extensionAPI.settings.get('language') || 'en';
    if (execution !== cachedCapacityExecution || language !== cachedCapacityLanguage) {
      cachedCapacityExecution = execution;
      cachedCapacityLanguage = language;
      cachedCapacitySummary = timingCore.capacitySummary(execution, language);
    }
    return cachedCapacitySummary;
  };

  const brandIcon = () => {
    const mark = element('span', 'nautilus-log-timing__brand-icon');
    mark.append(icon('unresolve'));
    return mark;
  };

  const triggerSeparator = (modifier) => {
    const separator = element(
      'span',
      `nautilus-log-timing__trigger-separator nautilus-log-timing__${modifier}-separator`,
    );
    separator.setAttribute('aria-hidden', 'true');
    return separator;
  };

  const modeSeparator = () => triggerSeparator('mode');

  const triggerNodes = (...nodes) => {
    const capacity = element('span', 'nautilus-log-timing__capacity-token');
    const capacityValue = element('span', 'nautilus-log-timing__capacity-value');
    const capacityLabel = element('span', 'nautilus-log-timing__capacity-label');
    const energy = energyBarEnabled();
    capacity.hidden = true;
    if (energy) {
      const energyTrack = element('span', 'nautilus-log-timing__energy-track');
      energyTrack.hidden = true;
      energyTrack.setAttribute('aria-hidden', 'true');
      energyTrack.append(
        element('span', 'nautilus-log-timing__energy-committed'),
        element('span', 'nautilus-log-timing__energy-reserve'),
      );
      const energyTimer = element('span', 'nautilus-log-timing__energy-timer');
      energyTimer.hidden = nodes.length === 0;
      energyTimer.append(...nodes);
      const energyLeft = element('span', 'nautilus-log-timing__energy-left');
      energyLeft.append(capacityValue, capacityLabel);
      const energyPlanned = element('span', 'nautilus-log-timing__energy-planned');
      energyPlanned.append(
        element('span', 'nautilus-log-timing__energy-planned-value'),
        element('span', 'nautilus-log-timing__energy-planned-label'),
      );
      const energySummarySeparator = element(
        'span',
        'nautilus-log-timing__energy-summary-separator',
        '·',
      );
      energySummarySeparator.setAttribute('aria-hidden', 'true');
      const energyBottom = element('span', 'nautilus-log-timing__energy-bottom');
      energyBottom.append(energyLeft, energySummarySeparator, energyPlanned);
      capacity.append(energyTrack, energyTimer, energyBottom);
    } else {
      capacity.append(capacityValue, capacityLabel);
    }
    const capacitySeparator = triggerSeparator('capacity');
    capacitySeparator.hidden = true;
    return [
      brandIcon(),
      ...(!energy ? nodes : []),
      capacitySeparator,
      capacity,
    ];
  };

  const updateTriggerCapacity = ({ ariaLabel }) => {
    const execution = currentTriggerExecution();
    const summary = currentCapacitySummary();
    const separator = trigger.querySelector('.nautilus-log-timing__capacity-separator');
    const capacity = trigger.querySelector('.nautilus-log-timing__capacity-token');
    if (!summary || !execution || !separator || !capacity) {
      trigger.classList.remove('has-energy');
      trigger.classList.toggle('is-energy-unavailable', energyBarEnabled());
      if (separator) separator.hidden = true;
      if (capacity) {
        const timer = capacity.querySelector('.nautilus-log-timing__energy-timer');
        const hasTimer = Boolean(timer?.childElementCount);
        capacity.hidden = !hasTimer;
        capacity.classList.toggle('is-energy', hasTimer);
        capacity.classList.toggle('is-timer-only', hasTimer);
        const track = capacity.querySelector('.nautilus-log-timing__energy-track');
        const bottom = capacity.querySelector('.nautilus-log-timing__energy-bottom');
        if (track) track.hidden = true;
        if (bottom) bottom.hidden = true;
        if (timer) timer.hidden = !hasTimer;
      }
      trigger.setAttribute('aria-label', ariaLabel);
      return;
    }
    const text = ui();
    const energy = energyBarEnabled();
    const energyTrack = capacity.querySelector('.nautilus-log-timing__energy-track');
    const planned = capacity.querySelector('.nautilus-log-timing__energy-planned');
    const plannedValue = capacity.querySelector('.nautilus-log-timing__energy-planned-value');
    const plannedLabel = capacity.querySelector('.nautilus-log-timing__energy-planned-label');
    const summaryText = `${summary.left.value} ${summary.left.label} · ${summary.status.value} ${summary.status.label} · ${summary.planned.value} ${summary.planned.label}`;
    trigger.classList.remove('is-energy-unavailable');
    trigger.classList.toggle('has-energy', energy);
    separator.hidden = energy;
    capacity.hidden = false;
    capacity.classList.remove('is-timer-only');
    const bottom = capacity.querySelector('.nautilus-log-timing__energy-bottom');
    if (bottom) bottom.hidden = false;
    capacity.classList.toggle('is-energy', energy);
    capacity.classList.toggle('is-positive', summary.left.tone === 'positive');
    capacity.classList.toggle('is-warning', summary.left.tone === 'warning');
    capacity.querySelector('.nautilus-log-timing__capacity-value').textContent = summary.left.value;
    capacity.querySelector('.nautilus-log-timing__capacity-label').textContent = summary.left.label;
    if (energyTrack) energyTrack.hidden = !energy;
    let accessibleSummary = summaryText;
    if (energy && energyTrack && planned && plannedValue && plannedLabel) {
      const model = timingCore.energyBarModel(execution);
      energyTrack.style.setProperty('--nautilus-energy-available', `${model.availablePercent}%`);
      energyTrack.style.setProperty('--nautilus-energy-reserve', `${model.reservePercent}%`);
      capacity.classList.toggle('is-status-cue', model.warning);
      planned.classList.toggle('is-warning', model.warning);
      if (model.warning) plannedValue.classList.remove('is-confirming');
      plannedValue.textContent = summary.planned.value;
      plannedLabel.textContent = summary.planned.label;
      if (model.overloadMinutes > 0) {
        plannedValue.textContent = `${text.capacity.overCue} +${timingCore.compactMinutes(model.overloadMinutes)}`;
        plannedLabel.textContent = '';
      } else if (model.unplacedMinutes > 0) {
        plannedValue.textContent = `${text.capacity.noSlotCue} ${timingCore.compactMinutes(model.unplacedMinutes)}`;
        plannedLabel.textContent = '';
      }
      accessibleSummary = `${text.capacity.energy}: ${timingCore.compactMinutes(model.reserveMinutes)} ${text.capacity.reserve}, ${timingCore.compactMinutes(model.committedMinutes)} ${text.capacity.committed}, ${timingCore.compactMinutes(model.elapsedMinutes)} ${text.capacity.elapsed}; ${summaryText}`;
    }
    capacity.removeAttribute('title');
    trigger.setAttribute('aria-label', `${ariaLabel}, ${accessibleSummary}`);
  };

  const clearEnergyConfirm = () => {
    const host = typeof window !== 'undefined' ? window : globalThis;
    if (energyConfirmTimer) {
      host.clearTimeout(energyConfirmTimer);
      energyConfirmTimer = null;
    }
    trigger?.querySelector('.nautilus-log-timing__energy-planned-value')
      ?.classList.remove('is-confirming');
  };

  const playEnergyConfirm = () => {
    const capacity = trigger?.querySelector('.nautilus-log-timing__capacity-token');
    const planned = capacity?.querySelector('.nautilus-log-timing__energy-planned');
    const plannedValue = capacity?.querySelector('.nautilus-log-timing__energy-planned-value');
    clearEnergyConfirm();
    if (!energyBarEnabled() || !capacity || !plannedValue) return;
    if (capacity.classList.contains('is-status-cue') || planned?.classList.contains('is-warning')) {
      return;
    }
    const host = typeof window !== 'undefined' ? window : globalThis;
    if (host.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    void plannedValue.offsetWidth;
    plannedValue.classList.add('is-confirming');
    energyConfirmTimer = host.setTimeout(() => {
      trigger?.querySelector('.nautilus-log-timing__energy-planned-value')
        ?.classList.remove('is-confirming');
      energyConfirmTimer = null;
    }, ENERGY_CONFIRM_MS);
  };

  const updateShortcutTooltip = () => {
    if (!shortcutTooltip) return;
    const planUi = todayPlanState();
    if (planUi && shouldUseTodayPlanEntry() && !state.activeWork?.focused && !state.standalonePomodoro) {
      const action = planUi.status === 'ready-absent' ? planUi.labels.create
        : planUi.status === 'creating' ? planUi.labels.creating
          : planUi.status === 'checking' ? planUi.labels.checking
            : planUi.message || (planUi.status === 'ready-blocked' ? planUi.labels.blocked : planUi.labels.failed);
      const key = JSON.stringify([planUi.status, action, planUi.pageTitle]);
      if (key !== shortcutTooltipKey) {
        shortcutTooltipKey = key;
        shortcutTooltip.textContent = action;
      }
      return;
    }
    const text = ui();
    const summary = currentCapacitySummary();
    const execution = currentTriggerExecution();
    const totalMinutes = Number(execution?.totalAvailableMinutes);
    const total = Number.isFinite(totalMinutes) && totalMinutes > 0
      ? timingCore.compactMinutes(totalMinutes)
      : '';
    const nextKey = JSON.stringify([
      text.actions.openPanelHint,
      summary?.status?.value,
      summary?.status?.label,
      summary?.status?.tone,
      summary?.status?.warning,
      summary?.planned?.value,
      summary?.planned?.label,
      total,
    ]);
    if (nextKey === shortcutTooltipKey) return;
    shortcutTooltipKey = nextKey;

    const actions = element(
      'span',
      'nautilus-log-timing__shortcut-tooltip-actions',
      text.actions.openPanelHint,
    );
    if (!summary) {
      shortcutTooltip.replaceChildren(actions);
      return;
    }

    const data = element('span', 'nautilus-log-timing__shortcut-tooltip-data');
    const statusTone = summary.status.tone === 'positive' || summary.status.tone === 'warning'
      ? ` is-${summary.status.tone}`
      : '';
    data.append(
      element('strong', `nautilus-log-timing__shortcut-tooltip-value${statusTone}`, summary.status.value),
      ` ${summary.status.label}`,
    );
    if (total && !summary.status.warning) {
      data.append(
        ` ${text.capacity.totalConnector} `,
        element('strong', 'nautilus-log-timing__shortcut-tooltip-value', total),
      );
    }
    data.append(
      ' · ',
      element('strong', 'nautilus-log-timing__shortcut-tooltip-value', summary.planned.value),
      ` ${summary.planned.label}`,
    );
    shortcutTooltip.replaceChildren(data, actions);
  };

  const clearDeleteConfirmation = () => {
    if (!deleteConfirmation) return;
    window.clearTimeout(deleteConfirmation.timer);
    const button = deleteConfirmation.button;
    button?.classList.remove('is-confirming');
    button?.setAttribute('aria-label', ui().actions.deleteClock);
    if (button) button.title = ui().actions.deleteClock;
    deleteConfirmation = null;
  };

  const cancelDeferredRefresh = () => {
    if (deferredRefreshFrame !== null) window.cancelAnimationFrame?.(deferredRefreshFrame);
    if (deferredRefreshTimer !== null) window.clearTimeout(deferredRefreshTimer);
    deferredRefreshFrame = null;
    deferredRefreshTimer = null;
    const settle = settleDeferredRefresh;
    settleDeferredRefresh = null;
    settle?.(false);
  };

  const afterPopoverPaint = () => new Promise((resolve) => {
    cancelDeferredRefresh();
    settleDeferredRefresh = resolve;
    const finish = () => {
      deferredRefreshTimer = null;
      settleDeferredRefresh = null;
      resolve(!destroyed && Boolean(popover));
    };
    if (typeof window.requestAnimationFrame === 'function') {
      deferredRefreshFrame = window.requestAnimationFrame(() => {
        deferredRefreshFrame = null;
        deferredRefreshTimer = window.setTimeout(finish, 0);
      });
    } else {
      deferredRefreshTimer = window.setTimeout(finish, 0);
    }
  });

  const closePopover = ({ restoreFocus = false } = {}) => {
    invalidateActivation();
    cancelDeferredRefresh();
    popoverPending = false;
    if (!popover) return;
    clearDeleteConfirmation();
    popover.remove();
    popover = null;
    lastPopoverKey = null;
    lastPopoverExecution = null;
    pendingPopoverFocus = null;
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

  const plannedTaskDuration = (task) => {
    const text = ui();
    const remaining = Math.max(0, Number(task.remainingMinutes) || 0);
    return remaining > 0 && remaining < task.plannedMinutes
      ? `${text.timing.remaining} ${timingCore.compactMinutes(remaining)} · ${text.timing.planned} ${timingCore.compactMinutes(task.plannedMinutes)}`
      : `${text.timing.planned} ${timingCore.compactMinutes(task.plannedMinutes)}`;
  };

  const scheduledTaskMeta = (task, start, end) => {
    const language = extensionAPI.settings.get('language') || 'en';
    const today = Number(start) < 1440 ? `${ui().plan.today} ` : '';
    return `${today}${timingCore.formatPlanClock(start, language)}–${timingCore.formatPlanClock(end, language)} · ${plannedTaskDuration(task)}`;
  };

  const taskRow = (task, {
    recent = false,
    entry = null,
    planState = '',
    planStart = null,
    planEnd = null,
  } = {}) => {
    const text = ui();
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
    title.dataset.focusKey = 'title';
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
      language: extensionAPI.settings.get('language') || 'en',
    });
    const recentRemaining = recent && entry?.end
      ? Math.max(0, Math.ceil((Number(state.activeWork?.windowMinutes || 0) * 60000 - (state.now - entry.end)) / 60000))
      : null;
    const timingText = focused
      ? `${text.timing.timing} ${timingCore.formatElapsed(state.now - state.activeWork.focused.start)} · ${duration.detailLabel}`
      : '';
    const planDurationText = plannedTaskDuration(task);
    let metaText = duration.detailLabel;
    if (planState === 'scheduled') {
      metaText = scheduledTaskMeta(task, planStart, planEnd);
    } else if (planState === 'unscheduled') {
      metaText = `${text.plan.unscheduled} · ${planDurationText}`;
    } else if (focused) {
      metaText = `${forgotten ? `${text.timing.check} · ` : ''}${timingText}`;
    } else if (recent) {
      metaText = `${text.timing.recent} · ${timingCore.compactMinutes(recentRemaining)} ${text.timing.left} · ${duration.detailLabel}`;
    }
    const liveMeta = focused && !planState;
    const meta = element('div', `nautilus-log-timing__row-meta${liveMeta ? ' is-live' : ''}${forgotten ? ' is-warning' : ''}`, metaText);
    copy.append(meta);
    row.append(copy);

    const actions = element('div', 'nautilus-log-timing__row-actions');
    const timingAction = iconButton(focused ? 'log-out' : 'play', focused ? text.actions.clockOut : text.actions.clockIn, () => {
      runAction(() => focused ? runtime.stopTask() : runtime.startTask(task.uid));
    });
    const completeAction = iconButton('confirm', text.actions.complete, () => {
      runAction(async () => {
        await runtime.completeTask(task.uid);
        playEnergyConfirm();
      });
    });
    completeAction.classList.add('is-complete');
    timingAction.dataset.focusKey = 'clock';
    completeAction.dataset.focusKey = 'complete';
    timingAction.disabled = state.status === 'working';
    completeAction.disabled = state.status === 'working';
    actions.append(timingAction, completeAction);
    if (focused) {
      const deleteAction = iconButton('trash', text.actions.deleteClock, () => {
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
        deleteAction.title = text.actions.confirmDelete;
        deleteAction.setAttribute('aria-label', text.actions.confirmDelete);
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

  const capacityStrip = (execution) => {
    const text = ui().capacity;
    const summary = timingCore.capacitySummary(
      execution,
      extensionAPI.settings.get('language') || 'en',
    );
    // Use a neutral div instead of section so Roam themes cannot accidentally
    // apply editorial/serif section typography to this compact UI strip.
    const strip = element('div', 'nautilus-log-timing__capacity');
    strip.setAttribute('aria-label', text.label);
    const metric = element('span', 'nautilus-log-timing__capacity-metric');
    const part = ({ value, label }, { tone = 'neutral', left = false } = {}) => {
      const node = element(
        'span',
        `nautilus-log-timing__capacity-part${tone !== 'neutral' ? ` is-${tone}` : ''}${left ? ' is-left' : ''}`,
      );
      node.append(element('strong', '', value), ` ${label}`);
      return node;
    };
    metric.append(
      part(summary.left, { tone: summary.left.tone, left: true }),
      ' · ',
      part(summary.status, { tone: summary.status.tone }),
      ' · ',
      part(summary.planned),
    );
    strip.append(metric);
    return strip;
  };

  const planSectionHeader = ({ label, tasks, collapsible = false, expanded = true }) => {
    const tag = collapsible ? 'button' : 'div';
    const header = element(tag, `nautilus-log-timing__plan-heading${collapsible ? ' is-collapsible' : ''}`);
    if (collapsible) {
      header.type = 'button';
      header.dataset.focusKey = 'unscheduled';
      header.setAttribute('aria-expanded', String(expanded));
    }
    const labelNode = element('span', 'nautilus-log-timing__plan-label');
    if (collapsible) labelNode.append(icon(expanded ? 'chevron-down' : 'chevron-right'));
    labelNode.append(`${label} · ${tasks.length}`);
    header.append(labelNode);
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
    const text = ui().review;
    const section = element('section', 'nautilus-log-timing__review-summary');
    section.setAttribute('aria-label', text.summary);
    const counts = element('div', 'nautilus-log-timing__review-counts');
    const completed = element('span', 'nautilus-log-timing__review-count');
    completed.append(`${text.completed} `, element('strong', '', `${summary.completedCount || 0}/${summary.totalCount || 0}`));
    const compared = element('span', 'nautilus-log-timing__review-count');
    compared.append(`${text.compared} `, element('strong', '', String(summary.comparedCount || 0)));
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
      metric(text.planned, comparable ? timingCore.compactMinutes(summary.plannedMinutes || 0) : '—'),
      metric(text.actual, comparable ? timingCore.compactMinutes(summary.actualMinutes || 0) : '—'),
      metric(text.variance, comparable ? signedMinutes(variance) : '—', comparable && variance > 0 ? 'is-over' : ''),
    );
    section.append(counts, totals);
    return section;
  };

  const reviewRow = (task) => {
    const text = ui().review;
    const stateLabels = {
      compared: text.compared,
      live: text.live,
      paused: text.paused,
      'not-tracked': text.notTracked,
      'not-started': text.notStarted,
    };
    const row = element('div', `nautilus-log-timing__review-row is-${task.state}`);
    row.dataset.taskUid = task.uid;
    const heading = element('div', 'nautilus-log-timing__review-row-heading');
    const title = element('button', 'nautilus-log-timing__review-title', task.title);
    title.type = 'button';
    title.dataset.focusKey = 'title';
    title.title = task.title;
    title.addEventListener('click', (event) => {
      closePopover();
      runAction(() => runtime.openTask(task.uid, { sidebar: event.shiftKey }));
    });
    heading.append(title, element('span', 'nautilus-log-timing__review-state', stateLabels[task.state] || task.state));

    const metrics = element('div', 'nautilus-log-timing__review-row-metrics');
    metrics.append(element('span', '', `${text.planned} ${timingCore.compactMinutes(task.plannedMinutes)}`));
    const actualLabel = task.state === 'not-tracked' || task.state === 'not-started'
      ? `${text.actual} —`
      : `${text.actual} ${timingCore.compactMinutes(task.actualMinutes)}`;
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
    if (!popover || view === 'plan') return;
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
        language: extensionAPI.settings.get('language') || 'en',
      });
      actual.textContent = `${ui().review.actual} ${timingCore.compactMinutes(duration.actualMinutes)}`;
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
      language: extensionAPI.settings.get('language') || 'en',
    });
    const forgottenMinutes = extensionAPI.settings.get('forgotten-timer-minutes') ?? 120;
    const forgotten = timingCore.isForgottenClock(focused, state.now, forgottenMinutes);
    row.classList.toggle('is-forgotten', forgotten);
    meta.classList.toggle('is-warning', forgotten);
    const text = ui().timing;
    meta.textContent = `${forgotten ? `${text.check} · ` : ''}${text.timing} ${timingCore.formatElapsed(state.now - focused.start)} · ${duration.detailLabel}`;
  };

  const syncActionAvailability = () => {
    if (!popover) return;
    const disabled = state.status === 'working';
    popover.querySelectorAll('.nautilus-log-timing__row-actions button')
      .forEach((button) => { button.disabled = disabled; });
  };

  const planEmptyNode = (planUi, text) => {
    const wrap = element('div', 'nautilus-log-timing__empty');
    if (planUi) wrap.append(planActions(todayPlan, planUi));
    else wrap.textContent = text.empty.noLog;
    return wrap;
  };

  const capturePopoverFocus = () => {
    const active = document.activeElement;
    if (!popover?.contains(active) || !active.dataset.focusKey) return null;
    const row = active.closest('[data-task-uid]');
    const order = [...popover.querySelectorAll('[data-task-uid]')].map((item) => item.dataset.taskUid);
    const index = order.indexOf(row?.dataset.taskUid);
    return {
      key: active.dataset.focusKey,
      uid: row?.dataset.taskUid || null,
      successors: index < 0 ? [] : [...order.slice(index + 1), ...order.slice(0, index).reverse()],
    };
  };

  const restorePopoverFocus = (focus) => {
    if (!focus || !popover) return;
    // A user who moved to another control while a mutation was pending keeps
    // that focus. Automatic blur caused by disabling/removing a row does not.
    if (document.activeElement !== document.body && !popover.contains(document.activeElement)) return;
    const keyed = (root, key) => [...root.querySelectorAll('[data-focus-key]')]
      .find((node) => node.dataset.focusKey === key && !node.disabled);
    let target = null;
    if (focus.uid) {
      const rows = [...popover.querySelectorAll('[data-task-uid]')];
      const row = [focus.uid, ...focus.successors].map((uid) => rows.find((item) => item.dataset.taskUid === uid)).find(Boolean);
      if (row) target = keyed(row, focus.key) || keyed(row, 'title');
    } else {
      target = keyed(popover, focus.key);
    }
    (target || popover.querySelector('[role="tab"][aria-selected="true"]'))?.focus({ preventScroll: true });
  };

  const updatePopoverProjection = (execution) => {
    if (!popover || execution === lastPopoverExecution) return;
    lastPopoverExecution = execution;
    const strip = popover.querySelector('.nautilus-log-timing__capacity');
    if (execution && strip) strip.replaceWith(capacityStrip(execution));
    if (view !== 'plan') return;
    const rows = new Map([...popover.querySelectorAll('.nautilus-log-timing__row')]
      .map((row) => [row.dataset.taskUid, row]));
    for (const task of execution?.scheduledTasks || []) {
      const meta = rows.get(task.uid)?.querySelector('.nautilus-log-timing__row-meta');
      if (meta) meta.textContent = scheduledTaskMeta(task, task.start, task.end);
    }
  };

  const renderPopover = ({ force = false } = {}) => {
    if (!popover) return;
    const text = ui();
    if (popoverPending) {
      const checking = todayPlanState()?.labels?.checking || text.createToday.checking;
      if (lastPopoverKey !== `checking:${checking}`) {
        const status = element('div', 'nautilus-log-timing__empty', checking);
        status.setAttribute('role', 'status');
        popover.replaceChildren(status);
        lastPopoverKey = `checking:${checking}`;
      }
      return;
    }
    const execution = currentTriggerExecution();
    if (!force && state.status === 'working' && lastPopoverKey !== null) {
      // A queued graph mutation changes only button availability. Rebuilding
      // every task row here competes with Roam's native sidebar first paint;
      // the confirmed refresh below will render the new data once.
      pendingPopoverFocus = capturePopoverFocus() || pendingPopoverFocus;
      syncActionAvailability();
      updateLiveElapsed();
      updatePopoverProjection(execution);
      return;
    }
    const structureKey = JSON.stringify([
      timingCore.executionStructureKey(state, view),
      view === 'plan' ? [
        (execution?.scheduledTasks || []).map((task) => task.uid),
        (execution?.overflowTasks || []).map((task) => task.uid),
      ] : null,
    ]);
    if (!force && structureKey === lastPopoverKey) {
      syncActionAvailability();
      restorePopoverFocus(pendingPopoverFocus);
      pendingPopoverFocus = null;
      updateLiveElapsed();
      updatePopoverProjection(execution);
      return;
    }
    const focus = capturePopoverFocus() || pendingPopoverFocus;
    pendingPopoverFocus = null;
    const scrollTop = popover.querySelector('.nautilus-log-timing__list')?.scrollTop || 0;
    lastPopoverKey = structureKey;
    lastPopoverExecution = execution;
    clearDeleteConfirmation();
    popover.replaceChildren();

    const header = element('div', 'nautilus-log-timing__popover-header');
    const headerMain = element('div', 'nautilus-log-timing__popover-header-main');
    const identity = element('button', 'nautilus-log-timing__identity');
    identity.type = 'button';
    identity.dataset.focusKey = 'identity';
    identity.title = text.identity.locate;
    identity.setAttribute('aria-label', text.identity.locate);
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
    tabs.setAttribute('aria-label', text.identity.views);
    ['timing', 'plan', 'review'].forEach((name) => {
      const button = element('button', `nautilus-log-timing__tab${view === name ? ' is-active' : ''}`, text.tabs[name]);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(view === name));
      button.dataset.focusKey = `tab-${name}`;
      button.tabIndex = view === name ? 0 : -1;
      button.addEventListener('keydown', (event) => {
        const names = ['timing', 'plan', 'review'];
        const index = names.indexOf(name);
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? 2
          : event.key === 'ArrowRight' ? (index + 1) % 3
            : event.key === 'ArrowLeft' ? (index + 2) % 3 : null;
        if (target === null) return;
        event.preventDefault();
        event.stopPropagation();
        const next = [...tabs.children][target];
        next.focus();
        next.click();
      });
      button.addEventListener('click', () => {
        if (view === name) return;
        view = name;
        renderPopover({ force: true });
      });
      tabs.append(button);
    });
    headerMain.append(identity, identityDivider, tabs);
    header.append(headerMain);
    if (!state.activeWork?.focused) {
      const standalonePomodoroRunning = Boolean(state.standalonePomodoro);
      const pomodoroAction = iconButton(
        standalonePomodoroRunning ? 'small-cross' : 'stopwatch',
        standalonePomodoroRunning ? text.actions.stopPomodoro : text.actions.startPomodoro,
        (event) => {
          event.stopPropagation();
          runAction(async () => {
            if (standalonePomodoroRunning) await runtime.stopStandalonePomodoro();
            else await runtime.startStandalonePomodoro();
            closePopover();
          });
        },
      );
      pomodoroAction.classList.add('nautilus-log-timing__pomodoro-action');
      header.append(pomodoroAction);
    }
    popover.append(header);

    if (state.notice) {
      const notice = element('div', 'nautilus-log-timing__notice', state.notice);
      notice.setAttribute('role', 'status');
      popover.append(notice);
    }

    if (execution) popover.append(capacityStrip(execution));

    const list = element('div', 'nautilus-log-timing__list');
    if (view === 'timing') {
      const focused = state.activeWork?.focused;
      if (focused) list.append(taskRow(activeTask(focused), { entry: focused }));
      (state.activeWork?.recent || []).forEach((entry) => list.append(taskRow(activeTask(entry), { recent: true, entry })));
      if (!focused && !(state.activeWork?.recent || []).length) {
        list.append(element('div', 'nautilus-log-timing__empty', text.empty.noActive));
      }
    } else if (view === 'plan') {
      const tasks = state.planSnapshot?.tasks || [];
      list.classList.add('is-plan');
      const scheduled = execution?.scheduledTasks || [];
      const unscheduled = execution?.overflowTasks || [];
      if (tasks.length && execution) {
        const scheduledSection = element('section', 'nautilus-log-timing__plan-section is-scheduled');
        scheduledSection.append(planSectionHeader({ label: text.plan.scheduled, tasks: scheduled }));
        scheduled.forEach((task) => scheduledSection.append(taskRow(task, {
          planState: 'scheduled',
          planStart: task.start,
          planEnd: task.end,
        })));
        list.append(scheduledSection);

        if (unscheduled.length) {
          const unscheduledSection = element('section', 'nautilus-log-timing__plan-section is-unscheduled');
          const disclosure = planSectionHeader({
            label: text.plan.unscheduled,
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
      if (!state.planSnapshot?.plan || shouldUseTodayPlanEntry()) {
        list.replaceChildren(planEmptyNode(todayPlanState(), text));
      } else if (!tasks.length) {
        list.append(element('div', 'nautilus-log-timing__empty', text.empty.noPlanTasks));
      }
    } else if (view === 'review') {
      const review = state.dailyReview || timingCore.buildDailyReview();
      list.classList.add('is-review');
      if (state.planSnapshot?.plan && review.rows.length) popover.append(reviewSummary(review.summary));
      review.rows.forEach((task) => list.append(reviewRow(task)));
      if (!state.planSnapshot?.plan) {
        list.append(element('div', 'nautilus-log-timing__empty', text.empty.noLog));
      } else if (!review.rows.length) {
        list.append(element('div', 'nautilus-log-timing__empty', text.empty.noReviewTasks));
      }
    }
    popover.append(list);
    restorePopoverFocus(focus);
    list.scrollTop = scrollTop;
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

  const syncPopoverTypography = () => {
    if (!popover || typeof window.getComputedStyle !== 'function') return;
    const source = document.querySelector('.nautilus-log-metric')
      || document.querySelector('.nautilus-log-container');
    const fontFamily = source ? window.getComputedStyle(source).fontFamily : '';
    if (fontFamily) popover.style.setProperty('--nl-exec-font-family', fontFamily);
  };

  const openPopover = async ({ focusPanel = false, pending = false } = {}) => {
    if (popover) return closePopover({ restoreFocus: true });
    popoverPending = pending;
    popover = element('div', 'nautilus-log-timing__popover');
    popover.id = POPOVER_ID;
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', ui().identity.panel);
    popover.setAttribute('aria-busy', String(pending));
    popover.tabIndex = -1;
    document.body.append(popover);
    syncPopoverTypography();
    trigger.setAttribute('aria-expanded', 'true');
    renderPopover({ force: true });
    positionPopover();
    if (focusPanel) (pending ? popover : popover.querySelector('[role="tab"][aria-selected="true"]'))?.focus({ preventScroll: true });
    if (!pending) void runAction(async () => {
      if (await afterPopoverPaint()) await runtime.requestRefresh();
    });
    outsideHandler = (event) => {
      if (!popover?.contains(event.target) && !container?.contains(event.target)) closePopover();
    };
    keyHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePopover({ restoreFocus: true });
      }
    };
    document.addEventListener('mousedown', outsideHandler, true);
    document.addEventListener('keydown', keyHandler, true);
  };

  const confirmPopoverOpen = () => {
    if (!popover) return;
    const restorePanelFocus = document.activeElement === popover;
    popoverPending = false;
    popover.setAttribute('aria-busy', 'false');
    renderPopover({ force: true });
    if (restorePanelFocus) popover.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    // The session already refreshed the runtime before confirming this open.
    // Do not schedule another identical read/rebuild immediately afterward.
  };

  const renderTrigger = () => {
    if (!trigger) return;
    const text = ui();
    trigger.setAttribute('aria-description', text.actions.openPanelHint);
    updateShortcutTooltip();
    const focused = state.activeWork?.focused;
    const standalone = !focused && state.standalonePomodoro;
    if (standalone) {
      const elapsed = timingCore.formatElapsed(state.now.getTime() - Number(standalone.startedAt));
      const pomodoroMinutes = Number(extensionAPI.settings.get('pomodoro-minutes')) || 45;
      if (triggerMode !== 'pomodoro') {
        trigger.replaceChildren(
          ...triggerNodes(
            element('span', 'nautilus-log-timing__elapsed'),
            modeSeparator(),
            element('span', 'nautilus-log-timing__pomodoro-label', 'POMO'),
          ),
        );
        triggerMode = 'pomodoro';
      }
      trigger.classList.add('is-active', 'is-pomodoro');
      trigger.classList.remove('is-forgotten');
      trigger.classList.toggle('is-overdue', timingCore.isStandalonePomodoroOverdue(
        standalone,
        state.now,
        pomodoroMinutes,
      ));
      trigger.disabled = false;
      trigger.classList.remove('is-create-today', 'is-creating', 'is-checking', 'is-blocked', 'is-read-failed');
      trigger.querySelector('.nautilus-log-timing__elapsed').textContent = elapsed;
      trigger.querySelector('.nautilus-log-timing__pomodoro-label').textContent = 'POMO';
      updateTriggerCapacity({ ariaLabel: `${elapsed}, POMO` });
      if (pomoCloseButton) {
        pomoCloseButton.hidden = false;
        pomoCloseButton.title = text.actions.stopPomodoro;
        pomoCloseButton.setAttribute('aria-label', text.actions.stopPomodoro);
      }
      return;
    }
    if (!focused) {
      const planUi = todayPlanState();
      const planStatus = planUi?.status;
      if (['ready-absent', 'creating', 'checking', 'ready-blocked', 'read-failed', 'partial', 'nav-failed'].includes(planStatus)) {
        const label = planEntryLabel(planUi);
        const mode = `plan-${planStatus}`;
        if (triggerMode !== mode) {
          trigger.replaceChildren(brandIcon(), element('span', 'nautilus-log-timing__create-label', label));
          triggerMode = mode;
        } else {
          const labelNode = trigger.querySelector('.nautilus-log-timing__create-label');
          if (labelNode) labelNode.textContent = label;
        }
        trigger.classList.remove('is-active', 'is-overdue', 'is-forgotten', 'is-pomodoro', 'has-energy');
        trigger.classList.toggle('is-create-today', planStatus === 'ready-absent' || planStatus === 'creating');
        trigger.classList.toggle('is-creating', planStatus === 'creating');
        trigger.classList.toggle('is-checking', planStatus === 'checking');
        trigger.classList.toggle('is-blocked', planStatus === 'ready-blocked');
        trigger.classList.toggle('is-read-failed', planStatus === 'read-failed');
        trigger.disabled = !popoverPending && (planStatus === 'creating'
          || (planStatus === 'checking' && pendingPresentChecks === 0));
        trigger.setAttribute('aria-label', label);
        trigger.setAttribute('aria-description', planUi.message || label);
        if (pomoCloseButton) pomoCloseButton.hidden = true;
        return;
      }
      trigger.disabled = false;
      trigger.classList.remove('is-create-today', 'is-creating', 'is-checking', 'is-blocked', 'is-read-failed');
      if (triggerMode !== 'idle') {
        trigger.replaceChildren(...triggerNodes());
        triggerMode = 'idle';
      }
      trigger.classList.remove('is-active', 'is-overdue', 'is-forgotten', 'is-pomodoro');
      updateTriggerCapacity({ ariaLabel: text.actions.openPanel });
      if (pomoCloseButton) pomoCloseButton.hidden = true;
    } else {
      trigger.disabled = false;
      trigger.classList.remove('is-create-today', 'is-creating', 'is-checking', 'is-blocked', 'is-read-failed');
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
          ...triggerNodes(
            element('span', 'nautilus-log-timing__elapsed'),
            modeSeparator(),
            element('span', 'nautilus-log-timing__threads'),
            forgottenSignal,
          ),
        );
        triggerMode = 'active';
      }
      trigger.classList.add('is-active');
      trigger.classList.remove('is-pomodoro');
      trigger.classList.toggle('is-overdue', pomodoroElapsed >= pomodoroMinutes * 60000);
      trigger.classList.toggle('is-forgotten', forgotten);
      trigger.querySelector('.nautilus-log-timing__elapsed').textContent = elapsed;
      trigger.querySelector('.nautilus-log-timing__threads').textContent = `${count} ${count === 1 ? text.trigger.thread : text.trigger.threads}`;
      updateTriggerCapacity({
        ariaLabel: `${forgotten ? `${text.trigger.check}, ` : ''}${elapsed}, ${count} ${count === 1 ? text.trigger.thread : text.trigger.threads}`,
      });
      if (pomoCloseButton) pomoCloseButton.hidden = true;
    }
  };

  const syncResponsiveDensity = () => {
    if (!container?.isConnected) return;
    const topbar = document.querySelector('.rm-topbar');
    const search = findSearchSurface(topbar);
    const searchRect = search?.getBoundingClientRect?.();
    const controlRect = container.getBoundingClientRect();
    const density = searchRect
      ? timingCore.topbarDensity({ availableWidth: searchRect.left - controlRect.left })
      : 'full';
    if (container.dataset.density !== density) container.dataset.density = density;
    positionTopbarTooltip(trigger, shortcutTooltip);
  };

  const ensureMounted = () => {
    if (destroyed) return;
    const topbar = document.querySelector('.rm-topbar');
    if (!topbar) return;
    if (!container) {
      container = element('div', 'nautilus-log-timing__topbar');
      container.id = TOPBAR_ID;
      container.dataset.density = 'full';
      trigger = element('button', 'nautilus-log-timing__trigger');
      trigger.type = 'button';
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-controls', POPOVER_ID);
      trigger.setAttribute('aria-describedby', SHORTCUT_TOOLTIP_ID);
      trigger.setAttribute('aria-expanded', 'false');
      trigger.addEventListener('mouseenter', () => positionTopbarTooltip(trigger, shortcutTooltip));
      trigger.addEventListener('focus', () => positionTopbarTooltip(trigger, shortcutTooltip));
      trigger.addEventListener('click', (event) => {
        const liveTimer = Boolean(state.activeWork?.focused || state.standalonePomodoro);
        if (event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          closePopover();
          if (!liveTimer && shouldUseTodayPlanEntry()) activateTodayPlanEntry('sidebar');
          else if (!liveTimer && recoverPresentPlan('sidebar', () => runtime.locate({ sidebar: true }))) return;
          else runAction(() => runtime.locate({ sidebar: true }));
          return;
        }
        if (event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          closePopover();
          if (!liveTimer && shouldUseTodayPlanEntry()) activateTodayPlanEntry('main');
          else if (!liveTimer && recoverPresentPlan('main', () => runtime.locate())) return;
          else runAction(() => runtime.locate());
          return;
        }
        // Closing is always local UI work, even while a read is pending or
        // the underlying plan has changed. Never run creation on a close click.
        if (popover) {
          closePopover({ restoreFocus: true });
          return;
        }
        if (!liveTimer && shouldUseTodayPlanEntry()) {
          invalidateActivation();
          activateTodayPlanEntry('main');
          return;
        }
        if (event.target.closest?.('.nautilus-log-timing__capacity-token')) view = 'plan';
        const pending = !liveTimer && typeof todayPlan?.activateToday === 'function';
        openPopover({ focusPanel: event.detail === 0, pending });
        if (pending) recoverPresentPlan('main', confirmPopoverOpen, { deferPresentCheck: afterPopoverPaint });
      });
      pomoCloseButton = element('button', 'nautilus-log-timing__pomodoro-close');
      pomoCloseButton.type = 'button';
      pomoCloseButton.hidden = true;
      pomoCloseButton.append(icon('small-cross'));
      pomoCloseButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        runAction(async () => {
          closePopover();
          await runtime.stopStandalonePomodoro();
        });
      });
      shortcutTooltip = element('span', 'nautilus-log-timing__shortcut-tooltip');
      shortcutTooltip.id = SHORTCUT_TOOLTIP_ID;
      shortcutTooltip.setAttribute('role', 'tooltip');
      container.append(trigger, pomoCloseButton, shortcutTooltip);
    }
    if (!container.isConnected || !topbar.contains(container)) placeAfterNavigation(topbar, container);
    renderTrigger();
    syncResponsiveDensity();
  };

  const resetObservers = () => {
    observers.forEach((entry) => entry.disconnect());
    observers = [];
  };

  const watchTopbar = () => {
    resetObservers();
    const topbar = document.querySelector('.rm-topbar');
    const search = findSearchSurface(topbar);
    observedTopbar = topbar;
    observedSearch = search;
    const scheduleRecovery = () => queueMicrotask(() => {
      if (destroyed) return;
      const currentTopbar = document.querySelector('.rm-topbar');
      const currentSearch = findSearchSurface(currentTopbar);
      const hostChanged = currentTopbar !== observedTopbar;
      const searchChanged = currentSearch !== observedSearch;
      ensureMounted();
      if (hostChanged || searchChanged || !document.getElementById(TOPBAR_ID) || !currentTopbar?.contains(container)) watchTopbar();
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
    const hostObserver = new MutationObserver((records) => {
      const externalMutation = records.some((record) => !container?.contains(record.target));
      if (externalMutation) scheduleRecovery();
    });
    hostObserver.observe(topbar, { childList: true, subtree: true });
    observers.push(hostObserver);
    if (topbar.parentElement) {
      const shellObserver = new MutationObserver(scheduleRecovery);
      shellObserver.observe(topbar.parentElement, { childList: true });
      observers.push(shellObserver);
    }
    if (typeof ResizeObserver === 'function') {
      const resizeObserver = new ResizeObserver(syncResponsiveDensity);
      resizeObserver.observe(topbar);
      if (container) resizeObserver.observe(container);
      if (search) resizeObserver.observe(search);
      observers.push(resizeObserver);
    }
  };

  const initialize = () => {
    ensureMounted();
    watchTopbar();
    settingsListener = () => {
      triggerMode = null;
      liveExecutionCache = null;
      renderTrigger();
      if (popover) renderPopover({ force: true });
    };
    window.addEventListener('nautilus-log:settings-changed', settingsListener);
    unsubscribe = runtime.subscribe((next) => {
      state = next;
      if (!container?.isConnected) ensureMounted();
      else renderTrigger();
      if (popover) renderPopover();
    });
    unsubscribePlan = todayPlan?.subscribe?.(() => {
      renderTrigger();
      if (popover) renderPopover({ force: true });
    }) || null;
    return true;
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    invalidateActivation();
    closePopover();
    diagnostics.destroy();
    unsubscribe?.();
    unsubscribe = null;
    unsubscribePlan?.();
    unsubscribePlan = null;
    if (settingsListener) window.removeEventListener('nautilus-log:settings-changed', settingsListener);
    settingsListener = null;
    resetObservers();
    observedTopbar = null;
    observedSearch = null;
    cancelDeferredRefresh();
    clearDeleteConfirmation();
    clearEnergyConfirm();
    liveExecutionCache = null;
    container?.remove();
    container = null;
    trigger = null;
    pomoCloseButton = null;
    shortcutTooltip = null;
    shortcutTooltipKey = null;
  };

  return { initialize, destroy, ensureMounted };
}

export { TOPBAR_ID, findSearchSurface, placeAfterNavigation };
