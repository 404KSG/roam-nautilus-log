/** Daily Notes centers an 800px article inside a much wider native wrapper.
 * Let only the embedded Desk use that wrapper's available page width; do not
 * resize the chart, change Roam settings, or bleed out of sidebars/embeds. */
export function createDeskWidth({ root, container, host = window, onResize = () => {} }) {
  let frame = null;
  let destroyed = false;
  const article = container.closest('.roam-article');
  const wrapper = container.closest('.rm-article-wrapper');
  const confined = container.closest('#right-sidebar,.rm-sidebar-window,.rm-embed-container,.rm-callout__body');
  const update = () => {
    frame = null;
    if (destroyed || !container.isConnected) return;
    if (!article || !wrapper || confined) { root.style.width = '100%'; root.style.marginLeft = '0px'; onResize(); return; }
    const style = host.getComputedStyle(article);
    const leftPadding = parseFloat(style.paddingLeft) || 0;
    const rightPadding = parseFloat(style.paddingRight) || 0;
    const rect = wrapper.getBoundingClientRect();
    const width = Math.max(0, wrapper.clientWidth - leftPadding - rightPadding);
    const left = rect.left + wrapper.clientLeft + leftPadding - container.getBoundingClientRect().left;
    root.style.width = `${width}px`;
    root.style.marginLeft = `${left}px`;
    onResize();
  };
  const schedule = () => { if (!destroyed && frame === null) frame = host.requestAnimationFrame(update); };
  const observer = host.ResizeObserver ? new host.ResizeObserver(schedule) : null;
  for (const node of new Set([container, article, wrapper].filter(Boolean))) observer?.observe(node);
  host.addEventListener('resize', schedule);
  update();
  return { destroy() { destroyed = true; if (frame !== null) host.cancelAnimationFrame(frame); observer?.disconnect(); host.removeEventListener('resize', schedule); } };
}
