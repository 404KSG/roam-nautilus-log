/** Keep Desk in the same local renderer container as the Nautilus chart.
 * It deliberately never reads article/wrapper geometry: those ancestors are
 * wider than a centered chart and caused the previous negative-margin escape. */
export function createDeskWidth({ root, container, host = window, onResize = () => {} }) {
  let frame = null;
  let destroyed = false;
  const update = () => {
    frame = null;
    if (destroyed || !container.isConnected) return;
    root.style.width = '100%';
    root.style.maxWidth = '100%';
    root.style.inlineSize = '100%';
    root.style.maxInlineSize = '100%';
    root.style.marginLeft = '0px';
    root.style.marginRight = '0px';
    root.style.marginInline = '0px';
    onResize();
  };
  const schedule = () => { if (!destroyed && frame === null) frame = host.requestAnimationFrame(update); };
  host.addEventListener('resize', schedule);
  update();
  return { destroy() { destroyed = true; if (frame !== null) host.cancelAnimationFrame(frame); host.removeEventListener('resize', schedule); } };
}
