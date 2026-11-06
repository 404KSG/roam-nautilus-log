import { graphName } from './graph-context';
import { projectDeskTasks, reconcileDeskSelection, stepDeskSelection, deskShortcut, nativeEditorOwnsEscape, createModernDeskPreviewAdapter } from './desk-core';
import { nativeElements, nativePreviewText, readNativePreview } from './desk-native';
import { deskEmbedPreviewUid, readDeskPlan } from './desk-preview';
import { readDeskCapabilities, sameDeskCapabilities } from './desk-capabilities';
import { createModernDeskRemoveAdapter, readStrictDeskRemoveSnapshot } from './desk-remove';
import { createDeskMasonry } from './desk-masonry';
import { createDeskWidth } from './desk-width';
import { createDeskNavigation } from './desk-navigation';
import { createDeskDrag } from './desk-drag';
import { createDeskDropFeedback } from './desk-drop-feedback';
import { createDeskExternalDrop } from './desk-external-drop';
import { createDeskNotifications } from './desk-notification';
import { createDeskPreferences, createDeskOutlineVisibility } from './desk-host';

/** A scoped data adapter around Roam's native Desk styles, not its starred-note store. */
export function createDeskView({
  host = globalThis.window, document = host?.document,
  readPlan, watchPlan, readString, readChildren, actions,
  openTask = () => {}, getSettings = () => ({}),
  notify = (message) => console.warn('[Nautilus Log] Desk', message),
} = {}) {
  const hosts = new Map();
  const preferences = createDeskPreferences(host);
  const providerApi = host?.roamAlphaAPI;
  const providerGraph = graphName(host);
  let focusOwner = null;
  let destroyed = false;
  let nativeLane = Promise.resolve();
  let nativeJobs = 0;
  // Preview rows are intentionally watched separately from the Plan projection:
  // the projection observes direct task strings/orders only, while a loaded card
  // needs child image/text changes without invalidating every other card.
  const previewWatchers = new Map();
  let previewListeners = 0, pendingWatchRegistrations = 0;
  const previewLookup = (uid) => `[:block/uid "${String(uid || '').replace(/["\\]/g, '')}"]`;
  const previewPattern = (fields) => `[${fields.map(field => `:${field.includes('/') ? field : `block/${field}`}`).join(' ')}]`;
  const subscribePreviewWatch = (target, listener) => {
    const api = host?.roamAlphaAPI?.data;
    const uid = target?.uid, pattern = previewPattern(target?.fields || []);
    if (!uid || !target?.fields?.length || typeof listener !== 'function' || typeof api?.addPullWatch !== 'function' || typeof api?.removePullWatch !== 'function') {
      const stop = () => {};
      stop.ready = Promise.reject(new Error('Preview watch unavailable.')); stop.ready.catch(() => {}); return stop;
    }
    const key = `${pattern}\u0000${uid}`;
    let entry = previewWatchers.get(key);
    if (previewListeners >= 8192 || !entry && (previewWatchers.size >= 4096 || pendingWatchRegistrations >= 8192)) {
      const stop = () => {}; stop.ready = Promise.reject(Object.assign(new Error('Preview watch limit reached.'), { code: 'preview-resource-limit' })); stop.ready.catch(() => {}); return stop;
    }
    if (!entry) {
      pendingWatchRegistrations += 1;
      entry = { uid, pattern, api, listeners: new Set(), callback: null, registered: null, removing: null };
      entry.callback = () => { for (const callback of [...entry.listeners]) callback(); };
      previewWatchers.set(key, entry);
      try {
        // Removal must wait for a delayed registration. This mirrors the Plan
        // bridge lifetime contract and prevents post-fold leaked listeners.
        entry.registered = Promise.resolve(api.addPullWatch(pattern, previewLookup(uid), entry.callback));
      } catch (error) {
        entry.registered = Promise.reject(error);
      }
      entry.registered.then(() => { pendingWatchRegistrations -= 1; }, () => { pendingWatchRegistrations -= 1; });
      entry.registered.catch(() => { if (previewWatchers.get(key) === entry) previewWatchers.delete(key); });
    }
    if (!entry.listeners.has(listener)) previewListeners += 1;
    entry.listeners.add(listener);
    const stop = () => {
      if (entry.listeners.delete(listener)) previewListeners -= 1;
      if (entry.listeners.size || entry.removing) return;
      if (previewWatchers.get(key) === entry) previewWatchers.delete(key);
      entry.removing = Promise.resolve(entry.registered).catch(() => {}).then(() => {
        // Registration has no meaningful return value (including host nil/null).
        // Even a rejected/ambiguous add may have installed this exact callback.
        if (typeof entry.api.removePullWatch !== 'function') return;
        return entry.api.removePullWatch(entry.pattern, previewLookup(entry.uid), entry.callback);
      }).catch(() => {});
    };
    stop.ready = entry.registered;
    return stop;
  };
  const enqueueNative = (work) => {
    nativeJobs += 1;
    nativeLane = nativeLane.then(work, work).catch((error) => console.error('[Nautilus Log] Desk native editor cleanup failed', error)).finally(() => { nativeJobs -= 1; });
    return nativeLane;
  };
  const validHost = (options) => !destroyed && document?.body && options?.planUid
    && options.container?.isConnected && providerApi === host.roamAlphaAPI && providerGraph === graphName(host);
  const syncControl = (binding) => {
    const control = binding?.origin;
    const attribute = control?.getAttribute?.('role') === 'switch' ? 'aria-checked' : 'aria-expanded';
    control?.setAttribute?.(attribute, String(Boolean(binding?.session)));
  };
  const registerHost = (options = {}) => {
    if (!validHost(options)) return;
    let binding = hosts.get(options.container);
    if (binding && binding.planUid !== options.planUid) { binding.session?.close(false); hosts.delete(options.container); binding = null; }
    if (!binding) {
      binding = { ...options, session: null };
      hosts.set(options.container, binding);
    }
    if (options.origin) binding.origin = options.origin;
    if (!binding.session && preferences.read(providerGraph, binding.planUid)) start(binding);
    binding.session?.updateSettings?.();
    syncControl(binding);
    return binding;
  };
  const start = (binding) => {
    const session = createSession(binding);
    binding.session = session;
    session.start();
  };
  const open = (options = {}) => {
    if (!validHost(options)) return;
    let binding = hosts.get(options.container);
    if (!binding) { binding = { ...options, session: null }; hosts.set(options.container, binding); }
    if (options.origin) binding.origin = options.origin;
    const enabled = !binding.session;
    const saved = preferences.write(providerGraph, options.planUid, enabled);
    if (enabled) start(binding);
    else binding.session.close(true);
    if (!saved && enabled) binding.session?.notice('Desk is open, but browser storage is unavailable. This view may not survive a reload.');
  };

  const newTaskCopy = () => {
    let zh = false;
    try { zh = getSettings()?.language === 'zh'; } catch (_) {}
    return zh ? {label:'新任务',placeholder:'新任务。开始输入…',counter:'新建'}
      : {label:'New task',placeholder:'New task. Start typing...',counter:'new'};
  };
  function createSession(binding) {
    let draftCopy = newTaskCopy();
    const { planUid, container, pageTitle = '', origin = document.activeElement } = binding;
    const chart = container.closest('.nautilus-log-container');
    const roam = host.roamAlphaAPI;
    const graph = graphName(host);
    let previewAdapter = null;
    try { previewAdapter = createModernDeskPreviewAdapter(roam); }
    catch (_error) { /* A card reports Preview unavailable without falling back to query readers. */ }
    const { el, icon, button, check, preview, clearPreview } = nativeElements(document);
    const cards = new Map();
    const previews = new Map();
    const previewDirty = new Set();
    const previewQueue = new Set();
    const previewWatchStops = new Map();
    const footerWatchStops = new Map();
    const footerProvenance = new Map();
    const removeIntentCache = new Map();
    const scrollPositions = new Map();
    const outlineVisibility = createDeskOutlineVisibility(container, host);
    const notifications = createDeskNotifications({ host, document });
    let tasks = [];
    let status = 'loading';
    let selectedUid = null;
    let returnUid = null;
    let mode = 'overview';
    let draft = null;
    let mount = null;
    let nativeGeneration = 0;
    let pendingRetarget = null;
    let closed = false;
    let busy = false;
    let removeBusy = false, removeSurface = null, removeError = false;
    let stopWatch = null;
    let previewFrame = null;
    let previewEpoch = 0;
    const previewVersions = new Map();
    const previewLoading = new Map();
    let composing = false;
    let deferredSnapshot = null;
    let compositionFrame = null;
    let selectionFrame = null;
    let editingHoldUid = null;
    let swipeFrame = null, swipeAnimation = null, swipeTarget = null, swipeOffset = 0, swipeGeneration = 0;
    let observer = null;
    let foldObserver = null;
    let widthBinding = null;
    let externalDrop = null;
    let folded = false;
    let search = '';
    let capabilities = readDeskCapabilities(roam);

    // rm-desk-page owns the native route, including ancestor :has() padding.
    // An embedded component must never claim that page-level ownership.
    const root = el('section', 'nautilus-desk');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Nautilus Desk');
    root.dataset.planUid = planUid;
    const toolbar = el('div', 'rm-desk-page__toolbar');
    const title = el('h1', 'rm-desk-page__title');
    const titleLabel = el('span', 'nautilus-desk__title-label', 'Nautilus Desk');
    const count = el('span', 'rm-desk-page__count');
    titleLabel.append(count);
    title.append(titleLabel);
    const tools = el('div', 'rm-desk-page__tools');
    const searchGroup = el('div', 'bp3-input-group');
    const searchInput = el('input', 'bp3-input bp3-round bp3-minimal');
    searchInput.placeholder = 'Search Desk';
    searchInput.setAttribute('aria-label', 'Search Desk');
    searchGroup.append(icon('search'), searchInput);
    const add = button(draftCopy.label, 'plus', () => showDraft(), 'rm-desk-page__new-note');
    add.classList.remove('bp3-small');
    add.append(el('span', 'bp3-button-text', draftCopy.label));
    tools.append(searchGroup, add);
    toolbar.append(title, tools);
    const message = el('div', 'nautilus-desk__notice');
    message.setAttribute('role', 'status');
    message.hidden = true;
    const retryRead = button('Refresh', 'refresh', async () => {
      if (busy || !inScope()) return;
      busy = true;
      try { await actions?.verifyPendingRemovals?.(planUid); removeError = false; }
      catch (error) { removeError = true; if (inScope()) externalDrop.announce(error?.message || 'Removal is still unconfirmed.'); }
      finally { busy = false; if (inScope()) { refreshCapabilities(true); refresh(true); } }
    });
    retryRead.hidden = true;
    const grid = el('div', 'rm-desk-overview rm-desk-overview--masonry nautilus-desk__grid');
    const empty = el('div', 'rm-desk-card__missing');
    root.append(toolbar, message, retryRead, grid, empty);
    const masonry = createDeskMasonry({ grid, host });
    let affordances = null;
    const dropFeedback = createDeskDropFeedback({ root, grid, empty, host, getTasks: () => tasks });
    const drag = createDeskDrag({
      grid, host, feedback: dropFeedback,
      canDrag: () => inScope() && !folded && status === 'ready' && !busy && mode === 'overview' && Boolean(actions) && currentCapabilities().move,
      move,
      nudge: (uid, direction) => {
        const index = tasks.findIndex((task) => task.uid === uid);
        const target = tasks[index + direction];
        if (target) move(uid, target.uid, direction > 0 ? 'after' : 'before');
      },
    });

    const layer = el('div', 'nautilus-desk__focus-layer');
    const nativeImageViewerOpen = () => Boolean(document.querySelector('#rm-modal-portal .rm-enhanced-image-modal-container'));
    const backdrop = el('div', 'rm-desk-backdrop');
    backdrop.addEventListener('click', () => { if (!nativeImageViewerOpen()) showOverview(true); });
    const focus = el('section', 'rm-desk rm-desk--dialog rm-desk--overlay bp3-elevation-3');
    focus.setAttribute('role', 'dialog');
    focus.setAttribute('aria-modal', 'true');
    focus.setAttribute('aria-label', 'Desk');
    focus.tabIndex = -1;
    const header = el('div', 'rm-desk__header');
    const navigation = el('div', 'rm-desk__side');
    // Native Desk calls the left chevron Next and the right chevron Previous.
    const next = button('Next', 'chevron-left', () => step(1), 'rm-desk__next');
    const counter = el('span', 'rm-desk__counter');
    counter.setAttribute('role', 'status');
    const previous = button('Previous', 'chevron-right', () => step(-1), 'rm-desk__previous');
    navigation.append(next, counter, previous);
    const end = el('div', 'rm-desk__side rm-desk__side--end');
    const newNote = button(draftCopy.label, 'plus', () => showDraft(), 'rm-desk__new-note');
    const more = button('More', 'more', () => {
      const anchor = more.getBoundingClientRect(), frame = focus.getBoundingClientRect();
      menu.style.top = `${anchor.bottom - frame.top}px`;
      menu.style.right = `${frame.right - anchor.right}px`;
      menu.hidden = !menu.hidden;
    }, 'rm-desk__more');
    const back = button('Close', 'cross', () => showOverview(true), 'rm-desk__close');
    end.append(newNote, more, back);
    header.append(navigation, el('div', 'rm-desk__title', 'Desk'), end);
    const menu = el('div', 'bp3-popover bp3-minimal rm-desk__more-menu nautilus-desk__menu');
    menu.hidden = true;
    const menuContent = el('div', 'bp3-popover-content');
    const menuList = el('ul', 'bp3-menu');
    menuList.setAttribute('role', 'menu');
    const menuAction = (label, glyph, action) => {
      const item = el('li');
      const link = el('a', 'bp3-menu-item');
      link.setAttribute('role', 'menuitem'); link.tabIndex = 0;
      link.append(icon(glyph), el('span', 'bp3-text-overflow-ellipsis', label));
      link.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); if (!link.disabled) action(); });
      link.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); link.click(); } });
      item.append(link); menuList.append(item);
      return link;
    };
    const openMain = menuAction('Open in main window', 'share', () => {
      if (selectedUid) {
        // Content navigation follows the currently requested view. An explicit
        // local-entry edit must not jump away to the source on its way to main.
        const uid = mount?.entryView ? selectedUid : editorTarget(selectedUid).editorUid;
        showOverview(false); Promise.resolve().then(() => openTask(uid, false)).catch(noticeError);
      }
    });
    const openEntry = menuAction('Open plan entry', 'document-open', () => {
      menu.hidden = true;
      if (!selectedUid) return;
      const current = mount?.editorUid;
      if (current === selectedUid) showTask(selectedUid, true);
      else showTask(selectedUid, true, null, 0, selectedUid);
    });
    const focusTop = menuAction('Move to top', 'double-chevron-up', () => { menu.hidden = true; if (selectedUid) move(selectedUid, null, 'top'); });
    menuContent.append(menuList); menu.append(menuContent);
    const body = el('div', 'rm-desk__body nautilus-desk__focus-body');
    const editorStatus = el('div', 'rm-desk-card__missing');
    editorStatus.setAttribute('role', 'status');
    const editorMessage = el('div');
    const retryEditor = button('Try again', 'refresh', () => {
      if (mode === 'draft') saveDraft();
      else if (selectedUid) showTask(selectedUid, true);
    });
    editorStatus.append(editorMessage, retryEditor);
    const editor = el('div', 'nautilus-desk__editor');
    const draftInput = el('textarea', 'rm-desk-draft__input');
    draftInput.placeholder = draftCopy.placeholder;
    draftInput.setAttribute('aria-label', draftCopy.label);
    draftInput.rows = 1;
    draftInput.hidden = true;
    body.append(editorStatus, editor, draftInput);
    const keys = el('div', 'rm-desk__keys');
    const alt = /Mac|iPhone|iPad/.test(host.navigator?.platform || '') ? 'opt' : 'alt';
    for (const [chord, label] of [[`${alt}+,`, 'Next'], [`${alt}+.`, 'Previous']]) {
      const key = el('span', 'rm-sidecar__key');
      key.append(el('span', 'rm-sidecar__chord', chord), label);
      keys.append(key);
    }
    const escapeKey = el('span', 'rm-sidecar__key');
    const escapeHint = el('span', 'nautilus-desk__escape-hint', 'Close');
    escapeKey.append(el('span', 'rm-sidecar__chord', 'esc'), escapeHint);
    keys.append(escapeKey);
    const updateEscapeHint = (target = document.activeElement) => {
      escapeHint.textContent = mode === 'task' && mount?.el?.isConnected && mount.el.contains(target) ? 'Roam editor' : 'Close';
    };
    layer.addEventListener('focusin', event => updateEscapeHint(event.target));
    layer.addEventListener('focusout', event => updateEscapeHint(event.relatedTarget));
    focus.append(header, menu, body, keys);
    layer.append(backdrop, focus);

    const inScope = () => !closed && container.isConnected && roam === host.roamAlphaAPI && graph === graphName(host);
    affordances = createDeskNavigation({
      root, grid, body, origin, getOrigin: () => binding.origin || origin, host,
      isOverview: () => !closed && mode === 'overview',
      canNavigate: () => inScope() && status === 'ready' && mode !== 'overview' && !busy && !composing,
      step: direction => {
        const beforeUid = selectedUid, beforeMode = mode;
        step(direction);
        return beforeUid !== selectedUid || beforeMode !== mode;
      },
      onSwipe: paintSwipe,
    });
    const checkScope = () => { if (inScope()) return true; close(false); return false; };
    const notice = (text) => { message.textContent = String(text); message.hidden = !text; };
    const currentCapabilities = () => {
      const next = readDeskCapabilities(roam);
      if (!sameDeskCapabilities(capabilities, next)) capabilities = next;
      return capabilities;
    };
    function refreshCapabilities(explicit = false) {
      const previous = capabilities;
      const next = currentCapabilities();
      if (!sameDeskCapabilities(previous, next)) {
        removeIntentCache.clear();
        if (!next.move) drag.cancel();
        if (mode === 'draft' && draft && !next.create) notice("Notes can't be added in this graph.");
        if (mode === 'draft' && draft && next.create && draft.uncommitted) {
          draft.uncommitted = false; void saveDraft();
        }
      }
      if (explicit && !next.create) notice("Notes can't be added in this graph.");
      return next;
    }
    externalDrop = createDeskExternalDrop({
      root, grid, empty, statusRegion: title, host, actions, planUid, feedback: dropFeedback, notify: notifications.notify,
      canAccept: () => inScope() && !folded && status === 'ready' && mode === 'overview' && !busy
        && currentCapabilities().import && typeof actions?.importReferenceDrop === 'function',
    });
    function noticeError(error) {
      const text = error?.message || 'Desk could not complete this action.';
      if (!closed) notice(text);
      else notify(`Desk could not confirm a pending action. Check the original plan. ${text}`);
    }
    const nativeCurrent = (record) => inScope() && mount === record && mode === 'task'
      && selectedUid === record.entryUid && record.generation === nativeGeneration;
    // Card membership and management always retain the local entry identity.
    // Only an exact, metadata-tolerant native embed may nominate its immediate
    // readable block as the content editor; references and malformed carriers
    // deliberately stay on the entry.
    const editorTarget = (entryUid, task = tasks.find(row => row.uid === entryUid)) => {
      const sourceUid = deskEmbedPreviewUid(task?.localString);
      if (!sourceUid) return { entryUid, editorUid: entryUid, sourceUid: null, unavailable: false };
      try {
        const source = createModernDeskPreviewAdapter(roam).read(sourceUid);
        if (source?.kind === 'block' && typeof source.string === 'string') return { entryUid, editorUid: sourceUid, sourceUid, unavailable: false };
      } catch (_error) { /* A local entry is the recoverable unreadable-source route. */ }
      return { entryUid, editorUid: entryUid, sourceUid, unavailable: true };
    };
    const nativeInputActive = (record) => {
      const active = document.activeElement;
      return Boolean(record?.el?.contains(active) && active?.matches?.('textarea,input:not([type="checkbox"]),[contenteditable="true"]'));
    };
    const retargetAfterBlur = (record) => {
      host.requestAnimationFrame(() => {
        if (!nativeCurrent(record) || nativeInputActive(record)) return;
        record.dirty = false;
        if (pendingRetarget?.entryUid === record.entryUid && !composing) {
          pendingRetarget = null; showTask(record.entryUid, true);
        }
      });
    };
    const reduceMotion = () => Boolean(host.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    function clearSwipeMotion() {
      swipeGeneration += 1;
      if (swipeFrame !== null) host.cancelAnimationFrame(swipeFrame);
      swipeFrame = null;
      swipeAnimation?.cancel(); swipeAnimation = null;
      if (swipeTarget) swipeTarget.style.transform = '';
      swipeTarget = null; swipeOffset = 0;
    }
    function paintSwipe(delta) {
      const target = mode === 'draft' ? draftInput : mode === 'task' ? mount?.el : null;
      if (!inScope() || folded || composing || !target?.isConnected || reduceMotion()) { clearSwipeMotion(); return; }
      if (swipeTarget && swipeTarget !== target) clearSwipeMotion();
      swipeAnimation?.cancel(); swipeAnimation = null;
      const previous = swipeOffset;
      const direction = delta > 0 ? -1 : 1;
      const index = tasks.findIndex(task => task.uid === selectedUid);
      const available = mode === 'draft' ? direction > 0 && tasks.length > 0
        : direction < 0 ? index >= 0 : index >= 0 && index < tasks.length - 1;
      swipeTarget = target;
      swipeOffset = delta === null ? 0 : -delta / (available ? 1 : 3);
      if (swipeFrame !== null) host.cancelAnimationFrame(swipeFrame);
      const generation = ++swipeGeneration;
      swipeFrame = host.requestAnimationFrame(() => {
        if (generation !== swipeGeneration) return;
        swipeFrame = null;
        const current = mode === 'draft' ? draftInput : mount?.el;
        if (!inScope() || folded || composing || target !== current || !target.isConnected) return;
        if (delta === null) {
          target.style.transform = '';
          if (previous && target.animate) swipeAnimation = target.animate([
            { transform: `translateX(${previous}px)` }, { transform: 'translateX(0)' },
          ], { duration: 200, easing: 'ease-out' });
        } else target.style.transform = `translateX(${swipeOffset}px)`;
      });
    }
    function animateEntry(target, direction, offset = 0) {
      if (!direction || !target.animate || reduceMotion()) return;
      swipeAnimation?.cancel();
      swipeTarget = target;
      swipeAnimation = target.animate([
        { transform: `translateX(${(direction > 0 ? -body.clientWidth : body.clientWidth) + offset}px)` },
        { transform: 'translateX(0)' },
      ], { duration: 200, easing: 'ease-out' });
    }
    const cleanupNative = async (record) => {
      if (!record.attempted || record.cleaned) return;
      record.cleaned = true;
      await record.components.unmountNode({ el: record.el });
    };
    // The requested view and resolved editor can differ during source recovery.
    // Preserve each reading position even when both currently render the entry.
    const scrollKey = (record) => `${record.entryUid}\u0000${record.entryView ? 'entry' : 'source'}\u0000${record.editorUid}`;
    function dropEditor() {
      affordances?.resetForSelection();
      clearSwipeMotion();
      const record = mount;
      mount = null;
      if (!record) return;
      nativeGeneration += 1;
      scrollPositions.set(scrollKey(record), body.scrollTop);
      if (graph === graphName(host) && roam === host.roamAlphaAPI && record.el.contains(document.activeElement)) document.activeElement.blur();
      record.el.remove();
      enqueueNative(() => cleanupNative(record));
      previews.delete(record.entryUid);
      const card = cards.get(record.entryUid);
      if (card) observer?.observe(card.tile);
    }
    function updateControls() {
      updateEscapeHint();
      const index = tasks.findIndex((task) => task.uid === selectedUid);
      counter.textContent = mode === 'draft' ? draftCopy.counter : `${Math.max(0, index + 1)} / ${tasks.length}`;
      next.disabled = busy || status !== 'ready' || (mode === 'draft' ? !tasks.length : index < 0 || index === tasks.length - 1);
      previous.disabled = busy || status !== 'ready' || mode === 'draft';
      const previousLabel = index === 0 && mode === 'task' ? draftCopy.label : 'Previous';
      previous.title = previousLabel;
      previous.setAttribute('aria-label', previousLabel);
      const capability = currentCapabilities();
      add.disabled = newNote.disabled = busy || status !== 'ready' || !actions || !capability.create;
      focusTop.disabled = busy || !selectedUid || status !== 'ready' || Boolean(editingHoldUid) || !capability.move;
      openMain.disabled = !selectedUid;
      const target = selectedUid ? editorTarget(selectedUid) : null;
      const alternate = Boolean(target && target.editorUid !== selectedUid);
      openEntry.hidden = !alternate;
      if (alternate) openEntry.querySelector('.bp3-text-overflow-ellipsis').textContent = mount?.editorUid === selectedUid ? 'Open source' : 'Open plan entry';
      openEntry.disabled = !alternate || busy || status !== 'ready';
      for (const item of [openMain, openEntry, focusTop]) {
        item.setAttribute('aria-disabled', String(item.disabled));
        item.tabIndex = item.disabled ? -1 : 0;
        item.classList.toggle('bp3-disabled', item.disabled);
      }
    }
    function revealFocus() {
      if (focusOwner && focusOwner !== session) focusOwner.showOverview(false);
      focusOwner = session;
      drag.cancel();
      externalDrop?.suspend();
      menu.hidden = true;
      // Viewport geometry belongs to the scoped focus CSS, not the chart or
      // background columns. Resizing must not recreate the native editor.
      document.body.append(layer);
      focus.focus({ preventScroll: true });
      root.inert = true;
      root.setAttribute('aria-hidden', 'true');
      updateControls();
    }
    function showOverview(restoreFocus = true) {
      const uid = selectedUid || returnUid;
      if (mode === 'draft') {
        captureDraft();
        if (draft && draft.saved === null && !draft.saving && !draft.text.trim()) { actions.releaseDraft(draft.uid); draft.handedOff = true; }
        else void saveDraft();
      }
      mode = 'overview';
      externalDrop?.resume();
      selectedUid = null;
      composing = false;
      deferredSnapshot = null;
      dropEditor();
      layer.remove();
      root.inert = false;
      root.removeAttribute('aria-hidden');
      if (focusOwner === session) focusOwner = null;
      if (restoreFocus && !closed) (cards.get(uid)?.open || add).focus({ preventScroll: true });
      updateControls();
      schedulePreviews();
    }
    function setFolded(next) {
      if (closed || folded === next) return;
      folded = next;
      if (folded) {
        if (mode === 'draft') {
          // Keep a nonempty or in-flight reservation alive. Input can change
          // while create is awaiting confirmation; releasing it here makes the
          // guarded save loop lose its only UID.
          captureDraft();
          if (draft && !draft.handedOff && !draft.saving && !draft.text.trim()) {
            actions?.releaseDraft(draft.uid); draft.handedOff = true;
          }
        }
        mode = 'overview';
        selectedUid = null;
        composing = false;
        deferredSnapshot = null;
        drag.cancel();
        externalDrop?.suspend();
        menu.hidden = true;
        dropEditor();
        layer.remove();
        if (focusOwner === session) focusOwner = null;
        if (previewFrame !== null) { host.cancelAnimationFrame(previewFrame); previewFrame = null; }
        clearPreviewWatches();
        clearFooterWatches();
        resetPreviews();
        root.inert = true;
        root.hidden = true;
        root.setAttribute('aria-hidden', 'true');
        return;
      }
      root.hidden = false;
      externalDrop?.resume();
      root.inert = false;
      root.removeAttribute('aria-hidden');
      renderCards();
      host.requestAnimationFrame(() => { if (!closed && !folded) masonry.layoutNow(); });
    }
    async function focusNativeInput(record, caret) {
      const candidates = [...record.el.querySelectorAll('.roam-block[id],textarea')];
      const target = candidates.find((node) => node.dataset.blockUid === record.editorUid || node.id?.endsWith(`-${record.editorUid}`));
      if (!target || !nativeCurrent(record)) return;
      if (target.tagName === 'TEXTAREA') {
        target.focus({ preventScroll: true }); target.setSelectionRange(caret, caret); return;
      }
      // Native IDs are block-input-<window-id>-<uid>. Never focus a hidden copy
      // in the main outline or click a generic data-UID element/checkbox.
      const prefix = 'block-input-', suffix = `-${record.editorUid}`;
      const windowId = target.id.startsWith(prefix) ? target.id.slice(prefix.length, -suffix.length) : '';
      if (windowId && typeof roam.ui?.setBlockFocusAndSelection === 'function') {
        try {
          await roam.ui.setBlockFocusAndSelection({
            location: { 'block-uid': record.editorUid, 'window-id': windowId },
            selection: { start: caret, end: caret },
          });
        } catch (_error) {
          if (nativeCurrent(record)) {
            editorStatus.hidden = false; retryEditor.hidden = true;
            editorMessage.textContent = 'Saved. Click the note to continue editing.';
          }
        }
      }
    }
    function showTask(uid, force = false, caret = null, slide = 0, requestedEditorUid = null) {
      if (!uid || !checkScope() || status !== 'ready' || !tasks.some((task) => task.uid === uid)) return;
      if (actions?.isRemovalLocked?.(planUid)) { noticeError(new Error('A removal is pending or unconfirmed. Use Refresh before editing.')); return; }
      const entryView = requestedEditorUid === uid;
      const target = entryView ? { entryUid: uid, editorUid: uid, unavailable: false } : editorTarget(uid);
      if (uid === selectedUid && mode === 'task' && mount?.editorUid === target.editorUid && !force) return;
      const entryOffset = swipeOffset;
      if (mode === 'draft') { captureDraft(); void saveDraft(); }
      dropEditor();
      const entryGeneration = swipeGeneration;
      mode = 'task';
      selectedUid = returnUid = uid;
      draftInput.hidden = true;
      editor.hidden = false;
      revealFocus();
      editorStatus.hidden = false;
      editorMessage.textContent = 'Opening note...';
      retryEditor.hidden = true;
      const components = roam?.ui?.components;
      if (!components?.renderBlock || !components?.unmountNode) {
        editorMessage.textContent = 'The native Roam block editor is unavailable. Return to the outline to edit.';
        return;
      }
      const record = { entryUid: uid, editorUid: target.editorUid, entryView, sourceUnavailable: target.unavailable,
        generation: ++nativeGeneration, el: el('div', 'nautilus-desk__native'), components, attempted: false, cleaned: false, dirty: false };
      record.el.dataset.taskUid = uid;
      record.el.dataset.editorUid = target.editorUid;
      record.el.addEventListener('input', () => { if (nativeCurrent(record)) record.dirty = true; });
      record.el.addEventListener('focusout', () => retargetAfterBlur(record));
      mount = record;
      editor.append(record.el);
      updateControls();
      enqueueNative(async () => {
        if (!nativeCurrent(record)) return;
        record.attempted = true;
        try { await components.renderBlock({ uid: record.editorUid, el: record.el, 'open?': true, 'zoom-path?': true }); }
        catch (_error) {
          if (nativeCurrent(record)) { clearSwipeMotion(); editorMessage.textContent = 'The native Roam editor could not open this note.'; retryEditor.hidden = false; record.el.remove(); }
          await cleanupNative(record);
          return;
        }
        if (!nativeCurrent(record)) { await cleanupNative(record); return; }
        if (record.sourceUnavailable) {
          editorStatus.hidden = false; retryEditor.hidden = false;
          editorMessage.textContent = 'Source unavailable. Editing this plan entry instead.';
        } else editorStatus.hidden = true;
        body.scrollTop = scrollPositions.get(scrollKey(record)) || 0;
        if (entryGeneration === swipeGeneration) animateEntry(record.el, slide, entryOffset);
        // A draft caret is meaningful only in its local entry text. Never map a
        // wrapper-macro offset into unrelated source content.
        if (caret !== null && record.editorUid === record.entryUid) await focusNativeInput(record, caret);
      });
    }
    function showDraft(slide = 0) {
      if (!checkScope() || busy || status !== 'ready' || !actions) return;
      if (!currentCapabilities().create) { notice("Notes can't be added in this graph."); updateControls(); return; }
      if (actions?.isRemovalLocked?.(planUid)) { noticeError(new Error('A removal is pending or unconfirmed. Use Refresh before editing.')); return; }
      if (mode === 'draft') { draftInput.focus(); return; }
      let reserved = draft && !draft.handedOff ? draft : null;
      if (!reserved) {
        try { reserved = actions.beginDraft(planUid); }
        catch (error) { noticeError(error); return; }
      }
      returnUid = selectedUid || returnUid;
      const entryOffset = swipeOffset;
      dropEditor();
      mode = 'draft';
      selectedUid = null;
      draft = reserved.saving ? reserved : { ...reserved, text: reserved.text || '', saved: reserved.saved ?? null,
        caret: reserved.caret || 0, saving: null, handedOff: false };
      draftInput.value = draft.text;
      draftInput.hidden = false;
      editor.hidden = true;
      editorStatus.hidden = true;
      revealFocus();
      draftInput.focus({ preventScroll: true });
      animateEntry(draftInput, slide, entryOffset);
    }
    function captureDraft() {
      if (!draft || mode !== 'draft') return;
      draft.text = draftInput.value;
      draft.caret = draftInput.selectionStart;
      draftInput.style.height = 'auto';
      draftInput.style.height = `${draftInput.scrollHeight}px`;
    }
    function saveDraft() {
      const current = draft;
      if (!current || composing || current.uncommitted || current.handedOff || current.saving || (!current.text.trim() && current.saved === null)) return current?.saving;
      if (!currentCapabilities().create) {
        current.uncommitted = true;
        if (inScope()) notice("Notes can't be added in this graph.");
        return current?.saving;
      }
      current.saving = (async () => {
        try {
          while (current.text !== current.saved) {
            if (composing || current.uncommitted) return;
            const text = current.text;
            await actions.saveDraft({ planUid, uid: current.uid, string: text });
            current.saved = text;
          }
          if (inScope()) refresh();
          if (inScope() && mode === 'draft' && draft === current && current.text.trim() && !composing && !current.uncommitted) {
            current.handedOff = true;
            if (tasks.some((task) => task.uid === current.uid)) showTask(current.uid, true, current.caret);
            else { showOverview(false); notice('Saved under this Nautilus plan. Events and completed blocks are not shown as cards.'); }
            actions.releaseDraft(current.uid);
          } else if (!composing && !current.uncommitted && current.text === current.saved && (closed || mode !== 'draft' || draft !== current)) {
            current.handedOff = true;
            actions.releaseDraft(current.uid);
          }
        } catch (error) {
          if (inScope() && mode === 'draft' && draft === current) {
            editorStatus.hidden = false;
            editorMessage.textContent = error?.message || 'Could not save the new task.';
            retryEditor.hidden = false;
          } else noticeError(error);
        } finally {
          current.saving = null;
          if (closed && current.uncommitted && !current.handedOff) {
            actions.releaseDraft(current.uid); current.handedOff = true;
          }
        }
      })();
      return current.saving;
    }
    draftInput.addEventListener('input', (event) => {
      captureDraft();
      if (mode === 'draft' && draft) draft.uncommitted = Boolean(event.isComposing || composing);
      if (!event.isComposing && !composing) void saveDraft();
    });
    function step(direction) {
      if (busy || composing) return;
      if (mode === 'draft') { if (direction > 0 && tasks[0]) showTask(tasks[0].uid, false, null, direction); return; }
      const index = tasks.findIndex((task) => task.uid === selectedUid);
      if (direction < 0 && index === 0) { showDraft(direction); return; }
      const targetUid = stepDeskSelection(tasks, selectedUid, direction);
      if (targetUid) showTask(targetUid, false, null, direction);
    }
    async function move(uid, targetUid, position = 'before') {
      if (!checkScope() || busy || status !== 'ready' || !actions) return;
      if (!currentCapabilities().move) { notice('Roam block moving is unavailable.'); renderCards(); return; }
      busy = true;
      notice('');
      renderCards();
      try {
        await actions.moveTask({ planUid, uid, targetUid, position });
        if (inScope()) refresh();
      } catch (error) { noticeError(error); }
      finally {
        busy = false;
        if (inScope()) { renderCards(); if (mode === 'overview') cards.get(uid)?.open.focus({ preventScroll: true }); }
      }
    }
    async function removeCard(uid) {
      if (!checkScope() || mode !== 'overview' || folded || busy || composing || !removeSurface) return;
      const item = tasks.find(task => task.uid === uid); if (!item || !removeAvailable(item, true)) return;
      const before = visibleTasks().map(task => task.uid), index = before.indexOf(uid);
      busy = true; removeBusy = true; renderCards();
      try {
        const result = await removeSurface.remove({ uid, expectedString: item.localString });
        if (inScope()) {
          removeError = false; refresh();
          if (result.status === 'removed-reference') externalDrop.announce('Local reference removed. Source unchanged.', { intent: 'success', key: `remove:${uid}:reference` });
          else if (result.status === 'moved-to-daily-note') externalDrop.announce('Moved to the owning Daily Note. Content kept.', { intent: 'success', key: `remove:${uid}:daily-note` });
          else externalDrop.announce('Already outside this plan.', { intent: 'primary', key: `remove:${uid}:absent` });
        }
      } catch (error) { removeError = true; if (inScope()) externalDrop.announce(error?.message || 'Removal could not be confirmed. Check the original outline.', { intent: 'warning', key: `remove:${uid}:error` }); }
      finally {
        busy = false; removeBusy = false;
        if (inScope()) {
          renderCards();
          const candidates = [...before.slice(index + 1), ...before.slice(0, index).reverse(), uid];
          const nextCard = candidates.map(id => cards.get(id)?.open).find(node => node?.isConnected);
          (nextCard || add).focus({ preventScroll: true });
        }
      }
    }
    function schedulePreviews() {
      // The inert overview remains visible behind the editor. Its read-only
      // previews must keep consuming graph changes in task and draft modes.
      if (closed || folded || previewFrame !== null || !previewQueue.size) return;
      previewFrame = host.requestAnimationFrame(() => {
        previewFrame = null;
        if (!checkScope() || folded) return;
        const uid = previewQueue.values().next().value;
        previewQueue.delete(uid);
        loadPreview(uid);
        schedulePreviews();
      });
    }
    function renderHeading(card, text, status, hidden, label) {
      if (card.headingText.textContent !== text) card.headingText.textContent = text;
      if (card.heading.hidden !== hidden) card.heading.hidden = hidden;
      const marker = card.heading.querySelector('.rm-desk-tile__check');
      if (!status) marker?.remove();
      else if (!marker) card.heading.prepend(check(status));
      else marker.classList.toggle('rm-desk-tile__check--done', status === 'DONE');
      if (card.open.getAttribute('aria-label') !== label) card.open.setAttribute('aria-label', label);
    }
    async function loadPreview(uid) {
      const card = cards.get(uid);
      if (!card || (previews.has(uid) && !previewDirty.has(uid)) || previewLoading.has(uid) || status !== 'ready' || !checkScope()) return;
      const epoch = previewEpoch, version = previewVersions.get(uid) || 0, token = {};
      previewLoading.set(uid, token);
      card.tile.dataset.previewState = previews.has(uid) && !previews.get(uid).error ? 'updating' : 'loading';
      const current = () => inScope() && !folded && epoch === previewEpoch && version === (previewVersions.get(uid) || 0) && cards.get(uid) === card;
      const query = Boolean(search);
      let model;
      try {
        if (!previewAdapter) throw new Error('Preview unavailable.');
        // Each admission owns its reader cache; overlapping cards cannot clear
        // or share an incomplete read set while their watches are registering.
        const adapter = createModernDeskPreviewAdapter(roam, { origin: host.location?.origin });
        const read = () => { adapter.clear(); return readNativePreview({ uid, adapter, search: query }); };
        model = read();
        const keys = value => JSON.stringify((value.watchTargets || []).map(t => [t.uid, [...t.fields].sort()]).sort((a, b) => a[0].localeCompare(b[0])));
        let admitted = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          await syncPreviewWatches(uid, model);
          if (!current()) return;
          const after = read();
          if (keys(model) === keys(after)) { model = after; admitted = true; break; }
          model = after;
        }
        if (!admitted) throw new Error('Preview changed during watch registration. Refresh to retry.');
        if (!current()) return;
        const cost = new TextEncoder().encode(JSON.stringify(model)).length;
        const retained = [...previews.entries()].reduce((sum, [id, value]) => sum + (id === uid ? 0 : value.cost || 0), 0);
        if (cost + retained > 8 * 1024 * 1024) throw Object.assign(new Error('Preview memory limit reached.'), { code: 'preview-resource-limit' });
        model.cost = cost;
        previews.set(uid, model); previewDirty.delete(uid); card.tile.dataset.previewState = 'ready';
        const rootText = model.root.text, rootStatus = model.root.status;
        renderHeading(card, rootText, rootStatus, !rootText && !rootStatus, rootText || model.rows.find(row => row.text)?.text || 'Note');
        // Image completion concerns the retained visible DOM, not the version of
        // the text read which first created that image. The renderer rejects
        // detached/replaced images; this guard owns the card and view lifetime.
        preview(card.images, card.lines, model, () => {
          if (inScope() && !folded && cards.get(uid) === card && card.tile.isConnected) masonry.layoutNow();
        });
        if (search) renderCards(); else masonry.layoutNow();
      } catch (error) {
        if (current()) {
          const known = error.code === 'preview-resource-limit' ? [{ uid, fields: ['block/string', 'block/open', 'block/children'] }]
            : error.watchTargets || model?.watchTargets;
          if (known?.length) syncPreviewWatches(uid, { watchTargets: known }).catch(() => {});
          previews.set(uid, { root: { text: '', status: null }, rows: [], images: [], more: false, searchText: '', searchIncomplete: true, error: true });
          previewDirty.delete(uid);
          card.tile.dataset.previewState = 'error'; clearPreview(card.images, card.lines);
          card.lines.textContent = 'Preview unavailable. Use Refresh to retry.';
          retryRead.hidden = false;
          if (search) renderCards(); else masonry.layoutNow();
        }
      } finally {
        if (previewLoading.get(uid) === token) previewLoading.delete(uid);
        if (inScope() && !folded && cards.has(uid) && (!previews.has(uid) || previewDirty.has(uid))) { previewQueue.add(uid); schedulePreviews(); }
      }
    }
    const visibleTasks = () => tasks.filter(task => {
      if (!search) return true;
      const model = previews.get(task.uid);
      if (!model || previewDirty.has(task.uid) || model.error || model.searchIncomplete || !model.searchReady) return true;
      return `${model.searchText} ${pageTitle}`.toLocaleLowerCase().includes(search);
    });
    function clearFooterWatches(uid = null) {
      const entries = uid ? [[uid, footerWatchStops.get(uid) || []]] : [...footerWatchStops.entries()];
      for (const [key, stops] of entries) {
        for (const stop of stops) stop();
        footerWatchStops.delete(key); footerProvenance.delete(key);
      }
    }
    function renderFooterProvenance(card, title) {
      if (typeof title === 'string' && title) {
        if (!card.source) {
          card.source = el('span', 'rm-desk-tile__source');
          card.footer.insertBefore(card.source, card.tools);
        }
        card.source.textContent = title;
      } else card.source?.remove(), card.source = null;
    }
    function syncFooterProvenance(task) {
      const card = cards.get(task.uid);
      const sourceUid = deskEmbedPreviewUid(task.localString);
      if (!card || !sourceUid) { clearFooterWatches(task.uid); if (card) renderFooterProvenance(card, ''); return; }
      const cached = footerProvenance.get(task.uid);
      if (cached?.sourceUid === sourceUid) { renderFooterProvenance(card, cached.title); return; }
      clearFooterWatches(task.uid);
      let title = '', targets = [];
      try {
        const source = createModernDeskPreviewAdapter(roam).read(sourceUid);
        if (source?.kind === 'block' && typeof source.page?.uid === 'string' && typeof source.page?.title === 'string' && source.page.title) {
          title = source.page.title;
          targets = [{ uid: sourceUid, fields: ['block/page'] }, { uid: source.page.uid, fields: ['node/title'] }];
        }
      } catch (_error) { /* Provenance is optional; the preview remains available. */ }
      footerProvenance.set(task.uid, { sourceUid, title });
      renderFooterProvenance(card, title);
      const stops = targets.map(target => subscribePreviewWatch(target, () => {
        const live = tasks.find(row => row.uid === task.uid);
        footerProvenance.delete(task.uid);
        if (live) syncFooterProvenance(live);
      }));
      if (stops.length) footerWatchStops.set(task.uid, stops);
    }
    function removeAvailable(task, fresh = false) {
      // desk-remove invokes only data.block[kind]; legacy methods must not make
      // a destructive or Daily Note promotion look available.
      const capability = { delete: typeof roam?.data?.block?.delete === 'function', move: typeof roam?.data?.block?.move === 'function' };
      if (!removeSurface || (!capability.delete && !capability.move)) return false;
      const key = `${task.localString}\u0000${capability.delete}\u0000${capability.move}`;
      const cached = removeIntentCache.get(task.uid);
      if (!fresh && cached?.key === key) return cached.available;
      let available = false;
      try {
        const snapshot = readStrictDeskRemoveSnapshot({ adapter: createModernDeskRemoveAdapter(roam), api: roam, planUid, targetUid: task.uid });
        available = snapshot.status === 'present' && (snapshot.intent?.kind === 'delete-wrapper' ? capability.delete : snapshot.intent?.kind === 'promote' && capability.move);
      } catch (_error) { /* Unknown removal shape is deliberately unavailable. */ }
      removeIntentCache.set(task.uid, { key, available });
      return available;
    }
    function renderCards() {
      const focusedCard = root.contains(document.activeElement) ? document.activeElement?.closest?.('[data-task-uid]')?.dataset.taskUid : null;
      const live = new Set(tasks.map((task) => task.uid));
      for (const [uid, card] of cards) {
        if (live.has(uid)) continue;
        observer?.unobserve(card.tile);
        card.tile.remove();
        clearPreview(card.images, card.lines);
        cards.delete(uid);
        previews.delete(uid); previewDirty.delete(uid); previewQueue.delete(uid); previewVersions.delete(uid); removeIntentCache.delete(uid);
        for (const key of scrollPositions.keys()) if (key.startsWith(`${uid}\u0000`)) scrollPositions.delete(key);
        clearPreviewWatches(uid); clearFooterWatches(uid);
      }
      for (const [taskIndex, task] of tasks.entries()) {
        let card = cards.get(task.uid);
        if (!card) {
          const tile = el('div', 'rm-desk-tile nautilus-desk__card');
          tile.dataset.taskUid = task.uid;
          const open = el('div', 'rm-desk-tile__preview');
          open.setAttribute('role', 'button');
          open.tabIndex = 0;
          const images = el('div');
          const heading = el('div', 'rm-desk-tile__title');
          const headingText = el('span');
          const lines = el('div');
          heading.append(headingText);
          open.append(images, heading, lines);
          const footer = el('div', 'rm-desk-tile__footer');
          const tools = el('div', 'rm-desk-tile__actions');
          const top = button('Move to top', 'double-chevron-up', () => move(task.uid, null, 'top'), 'rm-desk-tile__move-to-top');
          const removeButton = button('Remove from Desk', 'log-out', () => removeCard(task.uid), 'rm-desk-tile__remove');
          removeButton.addEventListener('pointerdown', event => event.stopPropagation());
          removeButton.addEventListener('dragstart', event => { event.preventDefault(); event.stopPropagation(); });
          tools.append(top, removeButton);
          footer.append(tools);
          tile.append(open, footer);
          const activate = (event) => {
            if (!checkScope() || busy || status !== 'ready') return;
            if (actions?.isRemovalLocked?.(planUid)) { noticeError(new Error('A removal is pending or unconfirmed. Use Refresh before editing.')); return; }
            if (event.shiftKey) Promise.resolve().then(() => inScope() && !actions?.isRemovalLocked?.(planUid) && openTask(editorTarget(task.uid).editorUid, true)).catch(noticeError);
            else showTask(task.uid);
          };
          tile.addEventListener('click', activate);
          open.addEventListener('keydown', (event) => {
            if (!event.defaultPrevented && !event.isComposing && ['Enter', ' '].includes(event.key)) { event.preventDefault(); activate(event); }
          });
          card = { tile, open, images, heading, headingText, lines, footer, tools, source: null, top, removeButton };
          cards.set(task.uid, card);
        }
        // Native drag pills use full collection order; Alt counters use the
        // visible DOM order independently, including when search is active.
        card.tile.dataset.position = String(taskIndex + 1);
        const cached = previews.get(task.uid);
        // Loaded preview text/status is authoritative. Before it arrives, keep
        // a neutral placeholder instead of briefly promoting image alt text.
        const loaded = Boolean(cached);
        let safeText = { text: '' };
        if (!loaded) {
          try { safeText = nativePreviewText(task.localString); } catch (_error) { /* Full admission exposes the retryable error. */ }
        }
        const rootText = loaded ? cached.root?.text || '' : (safeText.text || 'Loading preview…');
        const rootStatus = loaded ? cached.root?.status : null;
        const rowLabel = loaded ? cached.rows?.find((row) => row.text)?.text || '' : '';
        const label = rootText || rowLabel || 'Note';
        renderHeading(card, rootText, rootStatus, loaded && !rootText && !rootStatus, label);
        card.open.setAttribute('aria-disabled', String(busy || status !== 'ready'));
        card.open.tabIndex = status === 'ready' ? 0 : -1;
        const capability = currentCapabilities();
        card.tile.draggable = !busy && status === 'ready' && capability.move;
        card.top.disabled = busy || status !== 'ready' || !actions || !capability.move || task.uid === editingHoldUid;
        card.removeButton.disabled = busy || status !== 'ready' || !removeAvailable(task) || task.uid === editingHoldUid;
        syncFooterProvenance(task);
        if (!previews.has(task.uid) || previewDirty.has(task.uid)) {
          if (search || !observer) previewQueue.add(task.uid);
          else observer.observe(card.tile);
        }
      }
      const visible = visibleTasks();
      const visibleUids = new Set(visible.map((task) => task.uid));
      for (const [uid, card] of cards) if (!visibleUids.has(uid)) card.tile.remove();
      visible.forEach((task, index) => {
        const tile = cards.get(task.uid).tile;
        if (grid.children[index] !== tile) grid.insertBefore(tile, grid.children[index] || null);
      });
      affordances?.reconcile();
      drag.reconcile();
      if (!folded && mode === 'overview') externalDrop?.resume();
      externalDrop?.reconcile();
      masonry.setItems(visible.map((task) => cards.get(task.uid).tile));
      if (focusedCard && mode === 'overview') {
        const target = status === 'ready' ? cards.get(focusedCard)?.open : retryRead;
        if (target?.isConnected) target.focus({ preventScroll: true });
      }
      count.textContent = status === 'ready' ? ` · ${tasks.length}` : '';
      empty.hidden = visible.length > 0;
      empty.textContent = status !== 'ready' ? 'Could not read this plan. Refresh or hide Desk to inspect the outline.'
        : !tasks.length ? 'Nothing unfinished in this plan. Start a new task.'
          : search && previews.size < tasks.length ? 'Searching...'
            : search && [...previews.values()].some((model) => model.error) ? 'Some notes could not be searched. Refresh to try again.' : 'No notes match.';
      retryRead.hidden = status === 'ready' && capabilities.create && capabilities.move && capabilities.import
        && !removeError && !actions?.hasUnconfirmedRemoval?.(planUid) && ![...previews.values()].some(model => model.error);
      root.dataset.status = status;
      updateControls();
      schedulePreviews();
    }
    function clearPreviewWatches(uid = null) {
      const entries = uid ? [[uid, previewWatchStops.get(uid) || []]] : [...previewWatchStops.entries()];
      for (const [key, stops] of entries) {
        for (const stop of stops) stop();
        previewWatchStops.delete(key);
      }
    }
    function syncPreviewWatches(uid, model) {
      clearPreviewWatches(uid);
      const targets = [...new Map((model.watchTargets || []).filter((target) => target?.uid)
        .map((target) => [`${target.uid}\u0000${(target.fields || []).join(',')}`, target])).values()];
      const stops = targets.map(target => subscribePreviewWatch(target, () => invalidatePreview(uid)));
      previewWatchStops.set(uid, stops);
      return Promise.all(stops.map(stop => stop.ready));
    }
    function invalidatePreview(uid) {
      if (!checkScope()) return;
      clearPreviewWatches(uid);
      const card = cards.get(uid);
      if (!card) return;
      previewVersions.set(uid, (previewVersions.get(uid) || 0) + 1);
      previewDirty.add(uid);
      previewQueue.delete(uid);
      // Keep the last admitted model and DOM while the replacement is read
      // and its watches are verified. Input must not briefly empty a card.
      if (search || !observer) previewQueue.add(uid); else observer.observe(card.tile);
      schedulePreviews();
    }
    function previewKey(task) {
      return `${task.localString || ''}\u0000${task.sourceUid || ''}\u0000${task.title || ''}`;
    }
    function reconcilePreviews(previousTasks, nextTasks) {
      const previous = new Map(previousTasks.map((task) => [task.uid, previewKey(task)]));
      const next = new Map(nextTasks.map((task) => [task.uid, previewKey(task)]));
      for (const uid of previous.keys()) if (!next.has(uid)) previewVersions.delete(uid);
      for (const [uid, key] of next) if (previous.get(uid) !== undefined && previous.get(uid) !== key) invalidatePreview(uid);
    }
    function resetPreviews() {
      previewEpoch += 1;
      previewLoading.clear();
      clearPreviewWatches();
      previews.clear(); previewDirty.clear();
      previewQueue.clear();
      for (const card of cards.values()) clearPreview(card.images, card.lines);
    }
    function acceptSnapshot(snapshot) {
      if (!checkScope()) return;
      if (composing && !snapshot?.unavailable && !snapshot?.missing) { deferredSnapshot = snapshot; return; }
      deferredSnapshot = null;
      const previousTasks = tasks;
      const previousStatus = status;
      removeIntentCache.clear();
      if (snapshot?.missing) { tasks = []; status = 'missing'; }
      else {
        try {
          if (snapshot?.unavailable) throw new Error('Plan unavailable.');
          const projectionReader = createModernDeskPreviewAdapter(roam);
          tasks = projectDeskTasks(readDeskPlan(roam, planUid), planUid, { fallbackMinutes: getSettings()['todo-duration'] ?? 15,
            readString: uid => { const node = projectionReader.read(uid); return node ? node.string ?? node.title : null; },
          }); status = 'ready';
        }
        catch (_error) { status = 'unavailable'; }
      }
      if (status === 'ready' && previousStatus !== 'ready') notice('');
      if (status !== 'ready') {
        drag.cancel();
        if (mode !== 'overview') showOverview(false);
        notice('The last known cards are shown. Editing is paused until the plan can be read again.');
      }
      editingHoldUid = null;
      const activeInput = document.activeElement;
      const editing = mode === 'task' && mount?.el.contains(activeInput)
        && activeInput?.matches?.('textarea,input:not([type="checkbox"]),[contenteditable="true"]');
      const stillInPlan = snapshot?.['block/children']?.some((row) => row['block/uid'] === selectedUid);
      const previousSelected = previousTasks.find((task) => task.uid === selectedUid);
      const missingEmbedSource = previousSelected && editorTarget(selectedUid, previousSelected).unavailable;
      if (status === 'ready' && stillInPlan && !tasks.some((task) => task.uid === selectedUid) && (editing || missingEmbedSource)) {
        // A temporarily empty title/state edit must not unmount native input;
        // likewise a deleted embed source keeps its local entry available as a
        // recoverable fallback rather than silently selecting a different card.
        const index = previousTasks.findIndex((task) => task.uid === selectedUid);
        if (index >= 0) { tasks.splice(Math.min(index, tasks.length), 0, previousTasks[index]); if (editing) editingHoldUid = selectedUid; }
      }
      const activeRecord = mount;
      if (mode === 'task' && activeRecord && status === 'ready' && selectedUid === activeRecord.entryUid && !activeRecord.entryView) {
        const target = editorTarget(selectedUid);
        if (target.editorUid !== activeRecord.editorUid) {
          if (composing || activeRecord.dirty || nativeInputActive(activeRecord)) {
            pendingRetarget = target;
            editorStatus.hidden = false; retryEditor.hidden = false;
            editorMessage.textContent = 'This plan entry now points to a different source. Finish editing, then reopen it.';
          } else showTask(selectedUid, true);
        } else pendingRetarget = null;
      } else if (activeRecord?.entryView) pendingRetarget = null;
      const nextUid = reconcileDeskSelection(previousTasks, tasks, selectedUid);
      if (mode === 'task' && nextUid !== selectedUid) { if (nextUid && status === 'ready') showTask(nextUid); else showOverview(false); }
      if (status === 'ready') reconcilePreviews(previousTasks, tasks);
      renderCards();
    }
    function refresh(clear = false) {
      if (!checkScope()) return;
      if (clear) { resetPreviews(); notice(''); }
      refreshCapabilities();
      try { acceptSnapshot(readPlan(planUid)); }
      catch (_error) { acceptSnapshot({ unavailable: true }); }
    }
    searchInput.addEventListener('input', () => {
      const previous = Boolean(search); search = searchInput.value.trim().toLocaleLowerCase();
      if (previous !== Boolean(search)) resetPreviews();
      renderCards();
    });
    const onKey = (event) => {
      // Roam's enhanced image viewer is a portal modal above this focus dialog.
      // Yield all keys so its document handlers retain Escape, Tab, and zoom
      // navigation ownership without remounting the editor underneath.
      if (nativeImageViewerOpen()) return;
      if ((!root.contains(event.target) && !layer.contains(event.target) && event.target !== (binding.origin || origin)) || !checkScope() || composing) return;
      if (mode === 'overview' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
        && !event.target.closest('input,textarea,[contenteditable="true"]') && /^Digit[1-9]$/.test(event.code)) {
        const task = visibleTasks()[Number(event.code.slice(-1)) - 1];
        if (task) { event.preventDefault(); event.stopPropagation(); showTask(task.uid); }
        return;
      }
      if (!menu.hidden && event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault(); event.stopPropagation(); menu.hidden = true; more.focus({ preventScroll: true }); return;
      }
      // Roam owns Escape inside its mounted editor (for example, to turn an
      // editing block into a native selection before a host copy action). Do
      // not classify the event by trust, timing, or typed input; preserving the
      // editor subtree is sufficient and leaves Desk chrome behavior unchanged.
      if (mode === 'task' && mount?.el?.isConnected && nativeEditorOwnsEscape(event, mount)) return;
      const action = deskShortcut(event);
      if (action && (mode !== 'overview' || action === 'back' && event.target !== searchInput)) {
        event.preventDefault(); event.stopPropagation();
        if (action === 'back') { if (mode !== 'overview') showOverview(true); else { preferences.write(graph, planUid, false); close(true); } }
        else step(action === 'next' ? 1 : -1);
        return;
      }
      if (mode === 'overview' || event.key !== 'Tab' || event.defaultPrevented || event.target.closest('textarea,input,[contenteditable="true"]')) return;
      const stops = [...focus.querySelectorAll('button:not(:disabled),[tabindex="0"]')].filter((node) => !node.closest('[hidden]'));
      const first = stops[0], last = stops.at(-1);
      if (first && ((event.shiftKey && [first, focus].includes(document.activeElement)) || !event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    const onCompositionStart = (event) => {
      composing = true;
      affordances?.resetGesture();
      clearSwipeMotion();
      if (mode === 'draft' && event.target === draftInput && draft) draft.uncommitted = true;
    };
    const onCompositionEnd = (event) => {
      composing = false;
      // Folding resets the UI-level IME flag, not the parked draft's commit
      // state. A different native editor's composition must not commit it.
      if (mode === 'draft' && event.target === draftInput && draft) draft.uncommitted = false;
      captureDraft(); void saveDraft();
      if (compositionFrame !== null) host.cancelAnimationFrame(compositionFrame);
      compositionFrame = host.requestAnimationFrame(() => {
        compositionFrame = null;
        if (!deferredSnapshot || closed) return;
        const snapshot = deferredSnapshot; deferredSnapshot = null; acceptSnapshot(snapshot);
      });
    };
    const onEditorBlur = () => {
      if (!editingHoldUid || selectionFrame !== null) return;
      selectionFrame = host.requestAnimationFrame(() => { selectionFrame = null; if (!closed) refresh(); });
    };
    const onNavigation = () => { if (checkScope() && mode !== 'overview') showOverview(false); };
    const onVisible = () => { if (!folded && document.visibilityState !== 'hidden') refresh(); };
    function close(restoreFocus = true) {
      if (closed) return;
      if (mode === 'draft') captureDraft();
      if (draft && !draft.handedOff) {
        if (!draft.saving && (draft.uncommitted || draft.saved === null && !draft.text.trim())) {
          actions.releaseDraft(draft.uid); draft.handedOff = true;
        } else if (!composing) void saveDraft();
      }
      closed = true;
      removeSurface?.destroy(); removeSurface = null;
      mode = 'overview';
      selectedUid = null;
      dropEditor();
      stopWatch?.();
      resetPreviews();
      clearFooterWatches();
      observer?.disconnect();
      foldObserver?.disconnect();
      masonry.destroy(); drag.destroy(); externalDrop?.destroy(); notifications.destroy(); affordances.destroy(); outlineVisibility.destroy(); widthBinding?.destroy();
      if (previewFrame !== null) host.cancelAnimationFrame(previewFrame);
      if (compositionFrame !== null) host.cancelAnimationFrame(compositionFrame);
      if (selectionFrame !== null) host.cancelAnimationFrame(selectionFrame);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      host.removeEventListener('hashchange', onNavigation);
      host.removeEventListener('focus', onVisible);
      root.remove(); layer.remove();
      if (focusOwner === session) focusOwner = null;
      if (binding.session === session) binding.session = null;
      syncControl(binding);
      if (restoreFocus && graph === graphName(host)) {
        const control = binding.origin || origin;
        const target = control?.isConnected && control.getClientRects?.()?.length
          ? control : chart?.querySelector('.nautilus-log-collapse-btn');
        if (target?.isConnected) target.focus?.({ preventScroll: true });
      }
    }
    function start() {
      // The chart has its own text color. Inherit typography from the actual
      // Roam article/app instead, exactly as native Desk does (including themes).
      const surface = container.closest('.roam-article') || document.querySelector('.roam-app') || document.body;
      const typography = host.getComputedStyle(surface);
      for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'textTransform', 'lineHeight', 'color']) {
        root.style[property] = typography[property];
        layer.style[property] = typography[property];
      }
      if (origin?.closest?.('.bp3-dark,.rm-dark-theme,.dark') || document.querySelector('.roam-app.rm-dark-theme')) layer.classList.add('bp3-dark');
      container.append(root);
      try {
        removeSurface = actions?.registerRemoveSurface?.({ planUid,
          isAlive: () => inScope() && !folded && root.isConnected,
          isQuiescent: () => mode === 'overview' && !mount && !nativeJobs && !composing && !draft?.saving && (!busy || removeBusy),
        });
      } catch (_error) { removeSurface = null; }
      widthBinding = createDeskWidth({ root, container, host, onResize: masonry.layoutNow });
      syncControl(binding);
      outlineVisibility.setHidden(true);
      document.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onVisible);
      host.addEventListener('hashchange', onNavigation);
      host.addEventListener('focus', onVisible);
      layer.addEventListener('compositionstart', onCompositionStart);
      layer.addEventListener('compositionend', onCompositionEnd);
      layer.addEventListener('focusout', onEditorBlur);
      layer.addEventListener('pointerdown', (event) => { if (!menu.contains(event.target) && !more.contains(event.target)) menu.hidden = true; });
      if (chart && typeof host.MutationObserver === 'function') {
        foldObserver = new host.MutationObserver(() => setFolded(chart.classList.contains('nautilus-log-collapsed')));
        foldObserver.observe(chart, { attributes: true, attributeFilter: ['class'] });
      }
      setFolded(Boolean(chart?.classList.contains('nautilus-log-collapsed')));
      if (host.IntersectionObserver) observer = new host.IntersectionObserver((entries) => {
        for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); previewQueue.add(entry.target.dataset.taskUid); }
        schedulePreviews();
      }, { rootMargin: '300px' });
      try { stopWatch = watchPlan(planUid, acceptSnapshot, { emitInitial: false }); refresh(); }
      catch (_error) { status = 'unavailable'; renderCards(); }
    }
    const session = { start, close, showOverview, notice, updateSettings() {
      draftCopy = newTaskCopy();
      for (const control of [add,newNote]) { control.title=draftCopy.label;control.setAttribute('aria-label',draftCopy.label); }
      add.querySelector('.bp3-button-text').textContent=draftCopy.label;
      draftInput.placeholder=draftCopy.placeholder;draftInput.setAttribute('aria-label',draftCopy.label);
      updateControls();
    } };
    return session;
  }
  const closeForHost = (container) => { const binding = hosts.get(container); binding?.session?.close(false); hosts.delete(container); };
  return {
    open, registerHost, closeForHost,
    restoreMountedHosts(register = registerHost) {
      if (!document?.querySelectorAll) return;
      for (const container of document.querySelectorAll('[data-nautilus-desk-plan]')) register({
        container, planUid: container.dataset.nautilusDeskPlan, pageTitle: container.dataset.nautilusDeskPage || '',
        origin: container.closest('.nautilus-log-container')?.querySelector('.nautilus-log-desk-btn'),
      });
    },
    close: () => { for (const binding of hosts.values()) binding.session?.close(false); },
    destroy: () => { destroyed = true; for (const container of [...hosts.keys()]) closeForHost(container); return nativeLane; },
  };
}
