const { formatDuration } = require('./log-core');

const COPY = {
  en: {
    title: 'Nautilus Log', intro: 'Give every minute a job.',
    window: 'Window', default: 'Default task', nextDay: 'next day', unknown: 'Check settings', guide: 'Full guide',
    rows: [
      { key: 'available', label: 'Available & Events', text: 'Remaining / full-day flexible time and fixed-event time.' },
      { key: 'planned', label: 'Planned', text: 'Estimated time for unfinished tasks.' },
      { key: 'left', label: 'free', text: 'Unassigned budget ÷ full-day Available, after Planned. 0% can mean fully planned.' },
      { key: 'schedule', label: 'Schedule', text: 'Whole tasks fill free gaps in order. DONE keeps fixed ranges reserved.' },
      { key: 'desk', label: 'Views', text: 'Chart shows Desk cards; List shows original blocks. The native caret folds either view.' },
      { key: 'completed', label: 'Completed', text: 'Actual sums CLOCK; its interval does not replay sessions. ≈ = estimate; stripes = elapsed.' },
    ],
    settings: 'Settings: Roam Depot → Nautilus Log. CLOCK/POMO use Execution Layer; turn off the separate Roam Logbook. POMO does not record Actual.',
  },
  zh: {
    title: 'Nautilus Log', intro: '给每一分钟一份工作。',
    window: '时段', default: '默认任务时长', nextDay: '次日', unknown: '请检查设置', guide: '完整指南',
    rows: [
      { key: 'available', label: '可安排与事件', text: '分别显示可安排时间与固定事件的剩余／全天时间。' },
      { key: 'planned', label: '已计划', text: '未完成任务所需的估计时间。' },
      { key: 'left', label: '未分配', text: '扣除已计划后，未分配预算 ÷ 全天可安排容量。0% 可表示排满，不一定是一天结束。' },
      { key: 'schedule', label: '排程', text: '整项任务按自身顺序填入空档；DONE 仍保留固定事件时段。' },
      { key: 'desk', label: '视图', text: '图表包含 Desk 卡片；列表显示原始块。原生箭头统一收起当前视图。' },
      { key: 'completed', label: '完成项', text: 'Actual 汇总 CLOCK，绘图区间不逐段重放会话。≈ 表示估时，斜纹表示已过去。' },
    ],
    settings: 'Roam Depot → Nautilus Log。执行层提供 CLOCK／POMO，先关闭单独的 Roam Logbook；POMO 不产生 Actual。',
  },
};

function chartHelpModel({ language = 'en', startMinutes, endMinutes, defaultDuration = 15, revision = '' } = {}) {
  const lang = language === 'zh' ? 'zh' : 'en', copy = COPY[lang];
  const valid = value => typeof value === 'number' && Number.isFinite(value);
  const clock = value => `${value >= 1440 ? copy.nextDay + ' ' : ''}${String(Math.floor(value % 1440 / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  const window = valid(startMinutes) && valid(endMinutes) && startMinutes >= 0 && startMinutes < 1440
    && endMinutes > startMinutes && endMinutes - startMinutes <= 1440
    ? `${clock(startMinutes)}–${clock(endMinutes)}` : copy.unknown;
  const duration = valid(defaultDuration) && defaultDuration >= 0 ? formatDuration(defaultDuration) : copy.unknown;
  const ref = typeof revision === 'string' && /^[a-f0-9]{40}(?:-dirty)?$/i.test(revision) ? revision.slice(0, 40) : 'main';
  return { language: lang, title: copy.title, intro: copy.intro,
    setup: `${copy.window} ${window} · ${copy.default} ${duration}`,
    rows: copy.rows.map(row => ({ ...row })), settings: copy.settings, guideLabel: copy.guide,
    guideUrl: `https://github.com/404KSG/roam-nautilus-log/blob/${ref}/docs/guide${lang === 'zh' ? '.zh-CN' : ''}.md` };
}

function helpPopoverPosition({ anchor, viewportWidth, viewportHeight, contentHeight = 0 } = {}) {
  if (![viewportWidth, viewportHeight, contentHeight, anchor?.left, anchor?.right, anchor?.top, anchor?.bottom].every(Number.isFinite)
    || viewportWidth <= 24 || viewportHeight <= 24 || contentHeight < 0) return null;
  const gutter = 12, gap = 6, width = Math.min(360, viewportWidth - gutter * 2);
  const belowTop = Math.max(gutter, anchor.bottom + gap);
  const aboveBottom = Math.min(viewportHeight - gutter, anchor.top - gap);
  const below = Math.max(0, viewportHeight - gutter - belowTop);
  const above = Math.max(0, aboveBottom - gutter);
  const useAbove = contentHeight > below && (contentHeight <= above || above > below);
  const maxHeight = Math.min(560, useAbove ? above : below);
  const height = Math.min(contentHeight, maxHeight);
  return { width, maxHeight,
    left: Math.max(gutter, Math.min(anchor.right - width, viewportWidth - gutter - width)),
    top: useAbove ? aboveBottom - height : belowTop };
}

let sequence = 0;

/** A transient native-style reader. No graph API, settings write or timer polling. */
function createChartHelp({ host = globalThis.window, document = host?.document, revision = '' } = {}) {
  let active = null, destroyed = false;
  const nativeImageViewerOpen = () => Boolean(document?.querySelector('#rm-modal-portal .rm-enhanced-image-modal-container'));
  const el = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function close(restoreFocus = false) {
    const record = active;
    if (!record) return;
    active = null;
    for (const dispose of record.disposers) dispose();
    if (record.frame !== null) host.cancelAnimationFrame(record.frame);
    record.layer.remove();
    record.anchor.setAttribute('aria-expanded', 'false');
    record.anchor.removeAttribute('aria-controls');
    if (restoreFocus && record.anchor.isConnected) record.anchor.focus({ preventScroll: true });
  }
  function toggle({ anchor, ...settings } = {}) {
    if (destroyed || !document?.body || !anchor?.isConnected || anchor.ownerDocument !== document) return false;
    if (nativeImageViewerOpen()) { close(); return false; }
    if (active?.anchor === anchor) { close(); return false; }
    close();
    const model = chartHelpModel({ ...settings, revision });
    const layer = el('div', 'nautilus-log-help-layer');
    const panel = el('div', 'bp3-popover bp3-minimal nautilus-log-help-popover');
    const content = el('div', 'bp3-popover-content rm-desk__help-popover');
    const id = `nautilus-log-help-${++sequence}`;
    panel.id = id; panel.tabIndex = -1; panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', `${id}-title`); panel.setAttribute('aria-modal', 'false');
    const title = el('h3', 'rm-desk-empty__title nautilus-log-help-title', model.title); title.id = `${id}-title`;
    const rows = el('dl', 'nautilus-log-help-rows');
    for (const row of model.rows) {
      const item = el('div', 'nautilus-log-help-row'); item.dataset.helpKey = row.key;
      item.append(el('dt', '', row.label), el('dd', '', row.text)); rows.append(item);
    }
    const guide = el('a', 'nautilus-log-help-guide', model.guideLabel);
    guide.href = model.guideUrl; guide.target = '_blank'; guide.rel = 'noopener noreferrer';
    content.append(title, el('p', 'nautilus-log-help-intro', model.intro),
      el('p', 'nautilus-log-help-setup', model.setup), rows, el('p', 'nautilus-log-help-settings', model.settings), guide);
    panel.append(content); layer.append(panel); document.body.append(layer);
    const record = { anchor, layer, panel, disposers: [], frame: null };
    active = record;
    anchor.setAttribute('aria-expanded', 'true'); anchor.setAttribute('aria-controls', id);
    const owns = target => target?.nodeType && (anchor.contains(target) || layer.contains(target));
    const listen = (target, type, callback, options) => {
      target.addEventListener(type, callback, options);
      record.disposers.push(() => target.removeEventListener(type, callback, options));
    };
    const position = () => {
      if (active !== record) return;
      if (nativeImageViewerOpen() || !anchor.isConnected || !anchor.getClientRects().length || anchor.closest('[inert],[aria-hidden="true"]')) { close(); return; }
      const rect = anchor.getBoundingClientRect(), viewportWidth = host.innerWidth, viewportHeight = host.innerHeight;
      if (rect.bottom <= 0 || rect.top >= viewportHeight || rect.right <= 0 || rect.left >= viewportWidth) { close(); return; }
      const width = helpPopoverPosition({ anchor: rect, viewportWidth, viewportHeight });
      if (!width) { close(); return; }
      const surface = anchor.closest('.nautilus-log-container') || anchor;
      const typography = host.getComputedStyle(surface);
      layer.style.fontFamily = typography.fontFamily; layer.style.color = typography.color;
      layer.classList.toggle('bp3-dark', Boolean(anchor.closest('.bp3-dark,.rm-dark-theme,.dark')));
      panel.style.width = `${width.width}px`;
      const next = helpPopoverPosition({ anchor: rect, viewportWidth, viewportHeight, contentHeight: panel.scrollHeight });
      if (!next || next.maxHeight <= 0) { close(); return; }
      panel.style.maxHeight = `${next.maxHeight}px`;
      layer.style.left = `${next.left}px`; layer.style.top = `${next.top}px`;
    };
    const schedulePosition = () => {
      if (active !== record || record.frame !== null) return;
      record.frame = host.requestAnimationFrame(() => { record.frame = null; position(); });
    };
    listen(document, 'pointerdown', event => { if (!owns(event.target)) close(); }, true);
    listen(document, 'focusin', event => { if (!owns(event.target)) close(); });
    listen(document, 'keydown', event => {
      // Native images can open without moving focus off the underlying chrome.
      // Dismiss Help, but let the viewer's own handler receive this same key.
      if (nativeImageViewerOpen()) { close(); return; }
      // Never take Escape from a native editor or another overlay.
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || !owns(event.target)) return;
      event.preventDefault(); event.stopPropagation(); close(true);
    }, true);
    listen(host, 'resize', schedulePosition);
    listen(host, 'scroll', schedulePosition, true);
    listen(host, 'hashchange', () => close());
    listen(host, 'unload', () => close());
    listen(host, 'nautilus-log:settings-changed', () => close());
    listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') close(); });
    if (host.ResizeObserver) {
      const observer = new host.ResizeObserver(schedulePosition);
      observer.observe(anchor); observer.observe(panel);
      record.disposers.push(() => observer.disconnect());
    }
    if (host.MutationObserver) {
      const observer = new host.MutationObserver(changes => {
        if (active === record && changes.some(change => !layer.contains(change.target))) schedulePosition();
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
      record.disposers.push(() => observer.disconnect());
    }
    position();
    if (active === record) panel.focus({ preventScroll: true });
    return active === record;
  }
  return { toggle, closeForAnchor(anchor) { if (active?.anchor === anchor) close(); },
    destroy() { destroyed = true; close(); } };
}

module.exports = { chartHelpModel, helpPopoverPosition, createChartHelp };
