import { nativeRowSpan } from './desk-core';

/** Roam Desk's native grid-span algorithm. Column count and typography come
 * from the host's rm-desk-* CSS, not a second layout or theme implementation. */
export function createDeskMasonry({ grid, host = window }) {
  let items = [];
  let frame = null;
  let destroyed = false;
  let measuredWidth = null;
  const layoutNow = () => {
    if (frame !== null) host.cancelAnimationFrame(frame);
    frame = null;
    if (destroyed || !grid.isConnected) return;
    // Preserve the host's native auto-fill rule. Only constrain an unusually
    // narrow embed/sidebar when that rule would overflow its content box.
    if (measuredWidth !== grid.clientWidth) {
      grid.style.gridTemplateColumns = '';
      const native = host.getComputedStyle(grid);
      const available = grid.clientWidth - (parseFloat(native.paddingLeft) || 0) - (parseFloat(native.paddingRight) || 0);
      const gap = parseFloat(native.columnGap) || 0;
      // Native auto-fill prefers 240px tracks. Some legacy/current host CSS
      // resolves a second fractional track below that floor before overflow is
      // observable, so use the same preferred track to keep a local narrow
      // surface to one contained column rather than letting cards escape.
      if (available < 2 * 240 + gap) grid.style.gridTemplateColumns = 'minmax(0, 1fr)';
      measuredWidth = grid.clientWidth;
    }
    const style = host.getComputedStyle(grid);
    const gap = parseFloat(style.columnGap) || 0;
    for (const item of items) {
      const span = `span ${nativeRowSpan(item.offsetHeight, gap)}`;
      if (item.style.gridRowEnd !== span) item.style.gridRowEnd = span;
    }
    grid.dataset.columns = style.display === 'grid' ? String(style.gridTemplateColumns.split(/\s+/).filter(Boolean).length) : '0';
  };
  const schedule = () => {
    if (!destroyed && frame === null) frame = host.requestAnimationFrame(layoutNow);
  };
  // Native Desk observes tiles, not the grid height that its own row spans
  // change. This avoids both a one-frame overlap and resize-observer feedback.
  const observer = typeof host.ResizeObserver === 'function' ? new host.ResizeObserver(layoutNow) : null;
  host.addEventListener('resize', schedule);
  return {
    setItems(next) {
      const retained = new Set(next);
      for (const item of items) if (!retained.has(item)) observer?.unobserve(item);
      const previous = new Set(items);
      for (const item of next) if (!previous.has(item)) observer?.observe(item);
      items = next;
      layoutNow();
    },
    layoutNow,
    destroy() {
      destroyed = true;
      if (frame !== null) host.cancelAnimationFrame(frame);
      observer?.disconnect();
      host.removeEventListener('resize', schedule);
      items = [];
    },
  };
}
