import { masonryLayout } from './desk-core';

/** Measured masonry works in Roam's main column and narrow sidebar, without a dependency. */
export function createDeskMasonry({ grid, host = window }) {
  let items = [];
  let frame = null;
  let destroyed = false;
  const layoutNow = () => {
    if (frame !== null) host.cancelAnimationFrame(frame);
    frame = null;
    if (destroyed || !grid.isConnected) return;
    const width = grid.clientWidth;
    if (!width) return;
    const { cardWidth } = masonryLayout([], width);
    for (const item of items) {
      const value = `${cardWidth}px`;
      if (item.style.width !== value) item.style.width = value;
    }
    const layout = masonryLayout(items.map((item) => item.getBoundingClientRect().height), width);
    items.forEach((item, index) => {
      item.style.left = `${layout.items[index].x}px`;
      item.style.top = `${layout.items[index].y}px`;
    });
    grid.style.height = `${Math.ceil(layout.height)}px`;
    grid.dataset.columns = String(layout.columns);
  };
  const schedule = () => {
    if (destroyed || frame !== null) return;
    frame = host.requestAnimationFrame(layoutNow);
  };
  const observer = typeof host.ResizeObserver === 'function' ? new host.ResizeObserver(schedule) : null;
  observer?.observe(grid);
  if (!observer) host.addEventListener('resize', schedule);
  return {
    setItems(next) {
      const retained = new Set(next);
      for (const item of items) if (!retained.has(item)) observer?.unobserve(item);
      const previous = new Set(items);
      for (const item of next) if (!previous.has(item)) observer?.observe(item);
      items = next;
      schedule();
    },
    schedule,
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
