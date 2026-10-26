import { nativeDeskText, readDeskPreview } from './desk-core';

// Native contract inspected in Roam's current route-app.js and site.css:
// rm-desk-page, rm-desk-tile, Blueprint buttons, 240px auto-fill columns,
// 4px masonry rows, and eleven preview rows at depth <= 2. No native private
// functions are called and no Roam client bundle or font definitions are shipped.
export const nativeText = nativeDeskText;
export const readNativePreview = readDeskPreview;

export function nativeElements(document) {
  const el = (tag, classes = '', text) => {
    const node = document.createElement(tag);
    node.className = classes;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const icon = (name) => {
    const node = el('span', `bp3-icon bp3-icon-${name}`);
    node.setAttribute('aria-hidden', 'true');
    // Reuse an installed native SVG when present; otherwise the host's
    // Blueprint icon font supplies the same glyph. Copy geometry only, never
    // arbitrary SVG markup, event attributes, or private Roam implementation.
    const nativePath = document.querySelector(`.bp3-icon-${name} svg[data-icon="${name}"][viewBox="0 0 16 16"] path`);
    if (nativePath) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-icon', name);
      svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('viewBox', '0 0 16 16');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', nativePath.getAttribute('d') || '');
      path.setAttribute('fill-rule', nativePath.getAttribute('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero');
      svg.append(path); node.append(svg);
    }
    return node;
  };
  const button = (label, glyph, action, extra = '') => {
    const node = el('button', `bp3-button bp3-minimal bp3-small ${extra}`.trim());
    node.type = 'button';
    node.title = label;
    node.setAttribute('aria-label', label);
    if (glyph) node.append(icon(glyph));
    node.addEventListener('click', (event) => { event.stopPropagation(); action(event); });
    return node;
  };
  const check = (status) => el('span', `rm-desk-tile__check${status === 'DONE' ? ' rm-desk-tile__check--done' : ''}`);
  const preview = (parent, model) => {
    parent.replaceChildren();
    for (const row of model.rows) {
      const line = el('div', `rm-desk-tile__row${row.depth === 2 ? ' rm-desk-tile__row--nested' : ''}`);
      line.append(row.status ? check(row.status) : el('span', 'rm-desk-tile__bullet'), el('span', 'rm-desk-tile__text', row.text));
      parent.append(line);
    }
    if (model.more) parent.append(el('div', 'rm-desk-tile__more', '...'));
  };
  return { el, icon, button, check, preview };
}
