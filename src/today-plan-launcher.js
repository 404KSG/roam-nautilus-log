import * as timingCore from './timing-core';
import { createPlanDiagnostics, positionTopbarTooltip } from './today-plan-view';
import { placeAfterNavigation, TOPBAR_ID } from './timing-topbar';
import { createTopbarRecovery, findSearchSurface } from './topbar-recovery';

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

export function createTodayPlanLauncher({ todayPlan, extensionAPI } = {}) {
  let destroyed = false;
  let container = null;
  let trigger = null;
  let tooltip = null;
  let unsubscribe = null;
  let settingsListener = null;
  let triggerMode = null;

  const ui = () => todayPlan?.getState?.() || null;
  const diagnostics = createPlanDiagnostics(todayPlan, () => trigger);

  const brandIcon = () => {
    const mark = element('span', 'nautilus-log-timing__brand-icon');
    mark.append(icon('unresolve'));
    return mark;
  };

  const renderTrigger = () => {
    if (!trigger) return;
    const state = ui();
    const labels = state?.labels || timingCore.executionCopy(extensionAPI?.settings?.get?.('language') || 'en').createToday;
    const status = state?.status || 'checking';
    trigger.classList.remove(
      'is-active',
      'is-overdue',
      'is-forgotten',
      'is-pomodoro',
      'has-energy',
      'is-energy-unavailable',
      'is-create-today',
      'is-checking',
      'is-blocked',
      'is-read-failed',
      'is-partial',
      'is-creating',
    );
    trigger.disabled = status === 'creating' || status === 'checking';
    let mode = status;
    let label = labels.checking;
    if (status === 'ready-absent') {
      mode = 'create';
      label = labels.create;
      trigger.classList.add('is-create-today');
    } else if (status === 'creating') {
      mode = 'creating';
      label = labels.creating;
      trigger.classList.add('is-create-today', 'is-creating');
    } else if (status === 'ready-present' || status === 'nav-failed') {
      mode = 'present';
      label = labels.locate;
    } else if (status === 'ready-blocked') {
      mode = 'blocked';
      label = labels.templateBlocked;
      trigger.classList.add('is-blocked');
    } else if (status === 'partial') {
      mode = 'partial';
      label = labels.incomplete;
      trigger.classList.add('is-partial');
    } else if (status === 'read-failed') {
      mode = 'failed';
      label = labels.readError;
      trigger.classList.add('is-read-failed');
    } else {
      mode = 'checking';
      label = labels.checking;
      trigger.classList.add('is-checking');
    }
    if (triggerMode !== mode) {
      if (mode !== 'present') {
        trigger.replaceChildren(
          brandIcon(),
          element('span', 'nautilus-log-timing__create-label', label),
        );
      } else {
        trigger.replaceChildren(brandIcon());
      }
      triggerMode = mode;
    } else if (mode !== 'present') {
      const textNode = trigger.querySelector('.nautilus-log-timing__create-label');
      if (textNode && textNode.textContent !== label) textNode.textContent = label;
    }
    trigger.setAttribute('aria-label', label);
    trigger.setAttribute('aria-describedby', 'nautilus-log-today-plan-tooltip');
    trigger.removeAttribute('title');
    const message = state?.message || label;
    if (tooltip && tooltip.textContent !== message) tooltip.textContent = message;
    positionTopbarTooltip(trigger, tooltip);
  };

  const runClick = (event) => {
    const state = ui();
    const locateMode = event.shiftKey ? 'sidebar' : 'main';
    const status = state?.status;
    if (status === 'ready-present' || status === 'ready-absent' || status === 'nav-failed') {
      return Promise.resolve(todayPlan.activateToday({ locateMode })).then((result) => {
        const next = todayPlan.getState()?.status;
        if (['read-failed', 'ready-blocked', 'partial'].includes(next)) return diagnostics.show();
        return result;
      });
    }
    if (['ready-blocked','partial','read-failed'].includes(status)) return diagnostics.show();
    return undefined;
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
    positionTopbarTooltip(trigger, tooltip);
  };

  const ensureMounted = () => {
    if (destroyed || typeof document === 'undefined') return;
    const topbar = document.querySelector('.rm-topbar');
    if (!topbar) return;
    if (!container) {
      container = element('div', 'nautilus-log-timing__topbar');
      container.id = TOPBAR_ID;
      container.dataset.density = 'full';
      trigger = element('button', 'nautilus-log-timing__trigger');
      trigger.type = 'button';
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        Promise.resolve(runClick(event)).catch(error => console.error('[Nautilus Log] plan action', error));
      });
      trigger.addEventListener('mouseenter', () => positionTopbarTooltip(trigger, tooltip));
      trigger.addEventListener('focus', () => positionTopbarTooltip(trigger, tooltip));
      tooltip = element('span', 'nautilus-log-timing__shortcut-tooltip nautilus-log-timing__today-plan-tooltip');
      tooltip.id = 'nautilus-log-today-plan-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      container.append(trigger, tooltip);
    }
    if (!container.isConnected || !topbar.contains(container)) placeAfterNavigation(topbar, container);
    renderTrigger();
    syncResponsiveDensity();
  };

  const recovery = createTopbarRecovery({
    getContainer: () => container,
    mount: ensureMounted,
    syncDensity: syncResponsiveDensity,
  });

  const initialize = () => {
    if (destroyed || typeof document === 'undefined') return false;
    recovery.recover();
    settingsListener = () => {
      triggerMode = null;
      renderTrigger();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('nautilus-log:settings-changed', settingsListener);
    }
    unsubscribe = todayPlan?.subscribe?.(renderTrigger);
    return true;
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    unsubscribe?.();
    unsubscribe = null;
    if (settingsListener && typeof window !== 'undefined') {
      window.removeEventListener('nautilus-log:settings-changed', settingsListener);
    }
    settingsListener = null;
    recovery.destroy();
    diagnostics.destroy();
    container?.remove();
    container = null;
    trigger = null;
    tooltip = null;
  };

  return { initialize, destroy, ensureMounted: recovery.recover };
}
