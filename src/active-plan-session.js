import * as logCore from './log-core';
import { graphName } from './graph-context';
import { readActivePrimaryPlan, pageTitleFor, showToast } from './timing-roam';

/** Reuse the proven calendar-date creation engine. The overnight controller
 * is strictly read-only: it can inspect/open an old owner, never create it. */
export function withActiveWorkday(options, createCalendarSession) {
  const host = globalThis.window || globalThis, now = options.now || (() => new Date());
  const settings = options.extensionAPI?.settings;
  const tracking = options.trackingEnabled || (() => false);
  const trackingSnapshot = options.readTrackingSnapshot || (() => null);
  const notify = options.notify || showToast;
  const scope = { provider: host.roamAlphaAPI, graph: graphName(host), user: '' };
  const user = () => { try { return host.roamAlphaAPI?.user?.uid?.() || ''; } catch (_) { return ''; } };
  scope.user = user();
  const assertScope = () => {
    if (host.roamAlphaAPI !== scope.provider || graphName(host) !== scope.graph || user() !== scope.user) {
      throw Error('The graph or user changed. Reload this client before changing a plan.');
    }
  };
  const runtime = () => ({ 'workday-start': settings?.get?.('workday-start'),
    'workday-end': settings?.get?.('workday-end'),
    'respect-event-order': settings?.get?.('respect-event-order') === true });
  const calendar = createCalendarSession({ ...options, trackingEnabled: () => {
    if (!tracking()) return false;
    const snapshot = trackingSnapshot()?.planSnapshot, title = snapshot?.pageTitle;
    const owner = activeContext?.ownerPageTitle || (snapshot?.workday?.state === 'active' ? title : null);
    return !(owner && title === owner && title !== pageTitleFor(now()));
  } });
  let destroyed = false, initialized = false, calendarInitialized = false;
  let active = null, activeContext = null, activeKey = '', stopActive = null, endTimer = null;
  let stopTracking = null, changing = false, unavailable = null, calendarPending = false, selectionEpoch = 0;
  const listeners = new Set(), carryRequests = new Map();
  let lastSignature = null, selectedSignal = '';
  const selectionSignal = () => {
    const snapshot = tracking() ? trackingSnapshot()?.planSnapshot : null;
    return JSON.stringify([pageTitleFor(now()), snapshot?.pageTitle || '', snapshot?.plan?.uid || '']);
  };
  const mayCarry = () => {
    const date = now(), preferences = runtime(), window = logCore.resolveRendererSettings({ runtime: preferences });
    return preferences['workday-start'] == null || preferences['workday-end'] == null
      || (window['workday-end'] > 1440 && date.getHours() * 60 + date.getMinutes() < window['workday-end'] - 1440);
  };
  const ownerIsActive = () => {
    const instant = now();
    return activeContext && logCore.timelineDayState({ displayDate: activeContext.dayStartMs, currentDate: instant,
      startMinutes: activeContext.startMinutes, endMinutes: activeContext.endMinutes,
      nowMinutes: instant.getHours() * 60 + instant.getMinutes() }).relation === 'today';
  };
  const calendarState = () => {
    const value = calendar.getState(), title = value.pageTitle || pageTitleFor(now()), zh = value.language === 'zh';
    return { ...value, calendarPending, labels: { ...value.labels,
      calendarCreate: zh ? `创建或打开 ${title} 的计划` : `Create or open the plan for ${title}` } };
  };
  const getState = () => {
    try { assertScope(); } catch (error) {
      return { ...calendar.getState(), status:'read-failed', error:'graphChanged', message:error.message, planUid:null, canResume:false };
    }
    if (unavailable) return unavailable;
    if (!active) return calendar.getState();
    const value = active.getState(), zh = value.language === 'zh';
    // An old owner disappearing is a reason to reselect, never permission to
    // create yesterday from a formerly-present button.
    const unsafeAbsent = value.status === 'ready-absent';
    return { ...value, ...(unsafeAbsent ? {status:'read-failed',error:'failed',reason:'The overnight plan changed. Check the active plan again.'} : {}),
      activeWorkday: true, workday: activeContext, calendarPageTitle: pageTitleFor(now()), calendarPlan: calendarState(),
      trackingOn: value.trackingOn, canResume: false,
      labels: { ...value.labels, locate: zh ? `打开 ${value.pageTitle} 的活动计划` : `Open the active plan for ${value.pageTitle}`,
        checking: zh ? '正在检查活动计划' : 'Checking the active plan',
        create: zh ? '检查活动计划' : 'Check the active plan' } };
  };
  const emit = () => {
    if (destroyed) return;
    const value = getState(), signature = JSON.stringify(value);
    if (signature === lastSignature) return;
    lastSignature = signature;
    for (const listener of listeners) { try { listener(value); } catch (_) {} }
  };
  const clearEnd = () => { if (endTimer !== null) host.clearTimeout?.(endTimer); endTimer = null; };
  const closeActive = () => {
    stopActive?.(); stopActive = null; stopTracking?.(); stopTracking = null;
    active?.destroy(); active = null; activeContext = null; activeKey = ''; clearEnd();
  };
  const failure = error => {
    closeActive();
    const base = calendar.getState();
    const partial = base.status === 'partial';
    unavailable = { ...base, status:partial ? 'partial' : 'read-failed', error:partial ? 'partial' : 'failed', reason:error.message,
      message:error.message, planUid:partial ? base.planUid : null, canResume:false };
    emit(); return getState();
  };
  const readActive = () => {
    const provider = host.roamAlphaAPI, graph = graphName(host);
    const value = readActivePrimaryPlan(now(), runtime(), Number(settings?.get?.('todo-duration')) || 15);
    if (provider !== host.roamAlphaAPI || graph !== graphName(host)) throw Error('The graph changed while checking the active plan.');
    return value;
  };
  function discover(config = {}) {
    if (destroyed || changing) return getState();
    changing = true;
    selectionEpoch++;
    try {
      assertScope();
      selectedSignal = selectionSignal();
      unavailable = null;
      if (!mayCarry()) {
        const hadActive = Boolean(active);
        closeActive();
        const initializeCalendar = initialized && (!calendarInitialized || hadActive);
        if (initializeCalendar) { calendarInitialized = true; calendar.initialize(); }
        const result = initializeCalendar && !config.authoritative ? calendar.getState() : calendar.discover(config);
        emit(); return result;
      }
      const snapshot = readActive();
      if (snapshot.workday?.state !== 'active') {
        closeActive();
        if (initialized && !calendarInitialized) { calendarInitialized = true; calendar.initialize(); }
        const result = calendar.discover({ ...config, targetSnapshot: snapshot }); emit(); return result;
      }
      const key = JSON.stringify([graphName(host),snapshot.pageTitle,snapshot.plan.uid]);
      if (activeKey !== key) {
        closeActive(); activeKey = key; activeContext = snapshot.workday;
        const ownerDate = new Date(activeContext.dayStartMs);
        active = createCalendarSession({ ...options, now: () => new Date(ownerDate.getTime()),
          trackingEnabled: tracking, readTrackingSnapshot: trackingSnapshot });
        stopActive = active.subscribe(emit);
        watchActiveTracking();
      } else activeContext = snapshot.workday;
      clearEnd();
      const end = new Date(activeContext.dayStartMs);
      end.setMinutes(activeContext.endMinutes);
      endTimer = host.setTimeout?.(() => { endTimer = null; discover({ authoritative:true, checkRecord:true }); }, Math.max(50, end.getTime() - now().getTime()));
      const result = active.discover({ authoritative:true, checkRecord:true, targetSnapshot:snapshot });
      if (result?.then) return result.then(() => { emit(); return getState(); });
      emit(); return getState();
    } catch (error) { return failure(error); }
    finally { changing = false; }
  }
  async function activateToday({ locateMode='main', ifPresent='locate', deferPresentCheck } = {}) {
    if (destroyed) return getState();
    let carry;
    try { assertScope(); carry = mayCarry(); } catch (error) { return failure(error); }
    if (!carry && !active && !unavailable) return calendar.activateToday({locateMode,ifPresent,deferPresentCheck});
    const previouslyPresent = Boolean(active);
    const selected = await discover({ authoritative:true, checkRecord:true });
    if (unavailable) return getState();
    if (!active) {
      if (previouslyPresent && selected.status === 'ready-absent') {
        return failure(Error('The previously active plan disappeared. Check again before explicitly creating a calendar-day plan.'));
      }
      return calendar.activateToday({locateMode,ifPresent,deferPresentCheck});
    }
    const controller = active, key = activeKey;
    if (!['ready-present','nav-failed'].includes(selected.status)) return getState();
    if (typeof deferPresentCheck === 'function' && ifPresent === 'keep') {
      if (await deferPresentCheck() === false || destroyed) return getState();
      await discover({ authoritative:true, checkRecord:true });
      if (controller !== active || key !== activeKey || !ownerIsActive()) return getState();
    }
    if (tracking() && options.requestTrackingRefresh) {
      try { await options.requestTrackingRefresh({ immediate:true, rescanPlan:true }); }
      catch (error) { return failure(error); }
      if (destroyed || controller !== active || !ownerIsActive()) return discover({ authoritative:true });
      const refreshed = trackingSnapshot();
      if (refreshed?.status === 'error' || refreshed?.planSnapshot?.plan?.uid !== getState().planUid) {
        return failure(Error('The active plan could not be confirmed. Check it again before using its actions.'));
      }
    }
    if (ifPresent === 'keep') return { ...getState(), activation:'keep' };
    await controller.locateToday({locateMode}); emit(); return getState();
  }
  function ensureToday(config = {}) {
    if (destroyed) return Promise.resolve(getState());
    try {
      assertScope();
      if (config.expectedPageTitle && config.expectedPageTitle !== pageTitleFor(now())) {
        return Promise.resolve(failure(Error('The calendar date changed. Check the dated plan before creating it.')));
      }
      if (!mayCarry()) {
        if (active) discover({ authoritative:true });
        unavailable = null;
        // Preserve the calendar engine's coalesced promise and frozen intent.
        return calendar.ensureToday(config);
      }
      readActive();
      // Capture the dated intent before publishing progress to subscribers.
      const request = calendar.ensureToday(config);
      if (carryRequests.has(request)) return carryRequests.get(request);
      const result = request.then(value => {
        if (active && ['partial','read-failed','ready-blocked','nav-failed'].includes(value.status)) {
          try { assertScope(); notify(`${value.pageTitle}: ${value.message || value.reason || 'Creation incomplete'}`, 'warning'); } catch (_) {}
        }
        return value;
      }).finally(() => {
        carryRequests.delete(request); calendarPending = carryRequests.size > 0;
        discover({ checkRecord:true }); emit();
      });
      carryRequests.set(request, result); calendarPending = true; emit();
      return result;
    } catch (error) { return Promise.resolve(failure(error)); }
  }
  const stopCalendar = calendar.subscribe(() => {
    try {
      if (!changing && initialized && mayCarry() && !active && !calendarPending && selectionSignal() !== selectedSignal) {
        const epoch = selectionEpoch;
        queueMicrotask(() => { if (!destroyed && !changing && !active && !calendarPending && epoch === selectionEpoch) discover({ checkRecord:true }); });
      }
    } catch (_) { /* The calendar engine retains receipt diagnostics during a settings outage. */ }
    emit();
  });
  const foreground = () => {
    if (host.document?.visibilityState === 'hidden') return;
    try { if (active || mayCarry()) discover({ authoritative:true,checkRecord:true }); }
    catch (error) { failure(error); }
  };
  function watchActiveTracking() {
    stopTracking?.(); stopTracking = null;
    if (!active) return;
    stopTracking = options.subscribeTracking?.(() => {
      if (!active || changing || calendarPending) return;
      if (!ownerIsActive()) { discover({ authoritative:true,checkRecord:true }); return; }
      active.discover();
    });
  }
  function initialize() {
    if (destroyed) return false;
    try { assertScope(); } catch (error) { failure(error); return false; }
    if (!initialized) {
      initialized = true;
      host.addEventListener?.('focus',foreground);host.document?.addEventListener?.('visibilitychange',foreground);
    }
    calendarInitialized = true;
    calendar.initialize();
    try {
      if (mayCarry()) discover({ checkRecord:true });
      else { unavailable = null; closeActive(); emit(); }
    } catch (error) { failure(error); return false; }
    if (active) watchActiveTracking();
    return true;
  }
  function destroy() {
    if (destroyed) return; destroyed = true; closeActive(); stopCalendar(); stopTracking?.(); calendar.destroy(); listeners.clear();
    host.removeEventListener?.('focus',foreground);host.document?.removeEventListener?.('visibilitychange',foreground);
  }
  return { getState, getCalendarState:calendarState, discover, initialize, destroy, activateToday, ensureToday,
    locateToday: config => {
      try { assertScope(); return active || mayCarry() ? activateToday({ ...config, ifPresent:'locate' }) : calendar.locateToday(config); }
      catch (error) { return Promise.resolve(failure(error)); }
    },
    openTemplate: config => { try { assertScope(); return calendar.openTemplate(config); } catch (error) { return Promise.resolve(failure(error)); } },
    getCalendarController: () => ({ getState: calendarState, subscribe: calendar.subscribe,
      discover: config => { try { assertScope(); return calendar.discover(config); } catch (error) { return Promise.resolve(failure(error)); } },
      ensureToday, locateToday: config => { try { assertScope(); return calendar.locateToday(config); } catch (error) { return Promise.resolve(failure(error)); } },
      openTemplate: config => { try { assertScope(); return calendar.openTemplate(config); } catch (error) { return Promise.resolve(failure(error)); } } }),
    subscribe(listener) { if (!destroyed) listeners.add(listener); return () => listeners.delete(listener); },
  };
}
