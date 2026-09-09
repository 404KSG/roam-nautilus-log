import * as timingCore from './timing-core';
import { findSearchSurface, placeAfterNavigation, TOPBAR_ID } from './timing-topbar';

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
  let observers = [];
  let unsubscribe = null;
  let settingsListener = null;
  let observedTopbar = null;
  let observedSearch = null;
  let triggerMode = null;

  const ui = () => todayPlan?.getState?.() || null;

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
      'is-creating',
    );
    trigger.disabled = status === 'creating';
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
      label = labels.blocked;
      trigger.classList.add('is-blocked');
    } else if (status === 'read-failed') {
      mode = 'failed';
      label = labels.failed;
      trigger.classList.add('is-read-failed');
    } else {
      mode = 'checking';
      label = labels.checking;
      trigger.classList.add('is-checking');
    }
    if (triggerMode !== mode) {
      if (mode === 'create' || mode === 'creating') {
        trigger.replaceChildren(
          brandIcon(),
          element('span', 'nautilus-log-timing__create-label', label),
        );
      } else {
        trigger.replaceChildren(brandIcon());
      }
      triggerMode = mode;
    } else if (mode === 'create' || mode === 'creating') {
      const textNode = trigger.querySelector('.nautilus-log-timing__create-label');
      if (textNode) textNode.textContent = label;
    }
    trigger.setAttribute('aria-label', label);
    trigger.title = label;
  };

  const runClick = (event) => {
    const state = ui();
    const locateMode = event.shiftKey ? 'sidebar' : 'main';
    const status = state?.status;
    if (status === 'ready-present' || status === 'nav-failed') {
      return todayPlan.locateToday({ locateMode });
    }
    return todayPlan.ensureToday({ locateMode });
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
        void runClick(event);
      });
      container.append(trigger);
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
    if (typeof document === 'undefined') return;
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
      if (hostChanged || searchChanged || !document.getElementById(TOPBAR_ID) || !currentTopbar?.contains(container)) {
        watchTopbar();
      }
    });
    if (typeof MutationObserver !== 'function') return;
    if (!topbar) {
      const bootObserver = new MutationObserver(() => {
        if (document.querySelector('.rm-topbar')) {
          ensureMounted();
          watchTopbar();
        }
      });
      if (document.body) bootObserver.observe(document.body, { childList: true, subtree: true });
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
      if (search) resizeObserver.observe(search);
      observers.push(resizeObserver);
    }
  };

  const initialize = () => {
    if (destroyed || typeof document === 'undefined') return false;
    ensureMounted();
    watchTopbar();
    settingsListener = () => {
      triggerMode = null;
      renderTrigger();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('nautilus-log:settings-changed', settingsListener);
    }
    unsubscribe = todayPlan?.subscribe?.(() => {
      ensureMounted();
    });
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
    resetObservers();
    observedTopbar = null;
    observedSearch = null;
    container?.remove();
    container = null;
    trigger = null;
  };

  return { initialize, destroy, ensureMounted };
}
