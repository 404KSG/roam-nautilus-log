import { nativeRowSpan } from './desk-core';

/** Keep native Desk spans; remeasure only tiles whose content actually changed. */
export function createDeskMasonry({ grid, host = window }) {
  let items = [], members = new Set();
  let frame = null, destroyed = false, measuredWidth = null, measuredGap = null;
  const layoutNow = (changed = null) => {
    if (frame !== null) host.cancelAnimationFrame(frame);
    frame = null;
    if (destroyed || !grid.isConnected) return;
    const width = grid.clientWidth;
    // A hidden grid has no useful geometry. Preserve its spans until it returns.
    if (!width) return;
    const resized = measuredWidth !== width;
    if (resized) {
      grid.style.gridTemplateColumns = '';
      const native = host.getComputedStyle(grid);
      const available = grid.clientWidth - (parseFloat(native.paddingLeft) || 0) - (parseFloat(native.paddingRight) || 0);
      const gap = parseFloat(native.columnGap) || 0;
      if (available < 2 * 240 + gap) grid.style.gridTemplateColumns = 'minmax(0, 1fr)';
      measuredWidth = grid.clientWidth;
    }
    const style = host.getComputedStyle(grid), gap = parseFloat(style.columnGap) || 0;
    const targets = !Array.isArray(changed) || resized || measuredGap !== gap
      ? items : [...new Set(changed)].filter(item => members.has(item));
    measuredGap = gap;
    // Native masonry aligns tiles to start. Read intrinsic heights before
    // changing any span; a content update must not scan every unrelated tile.
    const spans = targets.map(item => `span ${nativeRowSpan(item.offsetHeight, gap)}`);
    targets.forEach((item, index) => {
      if (item.style.gridRowEnd !== spans[index]) item.style.gridRowEnd = spans[index];
    });
    const columns = style.display === 'grid' ? String(style.gridTemplateColumns.split(/\s+/).filter(Boolean).length) : '0';
    if (grid.dataset.columns !== columns) grid.dataset.columns = columns;
  };
  const schedule = () => { if (!destroyed && frame === null) frame = host.requestAnimationFrame(() => layoutNow()); };
  // Update resized tiles before paint. Observing the grid's own height would
  // feed span placement back into this observer.
  const observer = typeof host.ResizeObserver === 'function'
    ? new host.ResizeObserver(entries => layoutNow(entries.map(entry => entry.target))) : null;
  host.addEventListener('resize', schedule);
  return {
    setItems(next) {
      const retained = new Set(next);
      for (const item of items) if (!retained.has(item)) observer?.unobserve(item);
      for (const item of next) if (!members.has(item)) observer?.observe(item);
      items = next; members = retained;
      layoutNow();
    },
    layoutNow,
    layoutItem(item) { layoutNow([item]); },
    destroy() {
      destroyed = true;
      if (frame !== null) host.cancelAnimationFrame(frame);
      observer?.disconnect(); host.removeEventListener('resize', schedule);
      items = []; members.clear();
    },
  };
}
