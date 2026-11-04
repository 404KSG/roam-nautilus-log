import { nativeDeskText, nativeDeskPreviewText, readDeskPreview, buildDeskFullPreview } from './desk-core';

// Native contract inspected in Roam's current route-app.js and site.css:
// rm-desk-page, rm-desk-tile, Blueprint buttons, 240px auto-fill columns,
// 4px masonry rows, and bounded preview depth. This embedded panel uses the
// native full-route budget (twelve blocks including the root). No private
// functions, client bundle or fonts are shipped.
export const DESK_PREVIEW_ROWS = 11;
export const nativeText = nativeDeskText;
export const nativePreviewText = nativeDeskPreviewText;
export const readNativePreview = buildDeskFullPreview;
export const readLegacyNativePreview = readDeskPreview;

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
  const imageStates = new WeakMap();
  const rowRecords = new WeakMap();
  const retireImages = imageParent => {
    const state = imageStates.get(imageParent);
    if (state) { state.active = false; state.notify = null; state.nodes = []; state.sources = []; }
    imageStates.delete(imageParent);
  };
  const clearPreview = (imageParent, parent) => {
    retireImages(imageParent);
    imageParent.replaceChildren(); parent.replaceChildren();
  };
  const reconcileChildren = (parent, nodes) => {
    const retained = new Set(nodes);
    for (const node of [...parent.childNodes]) if (!retained.has(node)) node.remove();
    nodes.forEach((node, index) => {
      if (parent.childNodes[index] !== node) parent.insertBefore(node, parent.childNodes[index] || null);
    });
  };
  const preview = (imageParent, parent, model, onImageChange) => {
    const images = model.images || [];
    let state = imageStates.get(imageParent);
    const sameImages = state && state.sources.length === images.length
      && images.every((image, index) => image.src === state.sources[index]);
    if (sameImages) {
      // Text edits must not restart loading/decoding, including failed slots.
      // Explicit reset or changed image sources allow a retry. Refresh the
      // callback owner so a retained load can finish after a newer text revision.
      state.notify = onImageChange;
      state.nodes.forEach((node, index) => { if (node && node.alt !== images[index].alt) node.alt = images[index].alt; });
    } else {
      retireImages(imageParent);
      imageParent.replaceChildren();
      state = { active: true, sources: images.map(image => image.src), nodes: [], notify: onImageChange };
      imageStates.set(imageParent, state);
      const current = node => state.active && imageParent.contains(node);
      const imageNode = (image, holder) => {
        const node = document.createElement('img'), slot = state.nodes.length;
        node.alt = image.alt; node.loading = 'lazy'; state.nodes.push(node);
        node.addEventListener('load', () => { if (current(node)) state.notify?.(); }, { once: true });
        node.addEventListener('error', () => {
          if (!current(node)) return;
          state.nodes[slot] = null;
          const cell = node.closest('.rm-desk-tile__images-cell');
          (cell || holder).remove();
          if (!holder.querySelector('img')) holder.remove();
          state.notify?.();
        }, { once: true });
        node.src = image.src;
        return node;
      };
      if (images.length === 1) {
        const holder = el('div', 'rm-desk-tile__image');
        holder.append(imageNode(images[0], holder)); imageParent.append(holder);
      } else if (images.length > 1) {
        const holder = el('div', 'rm-desk-tile__images');
        images.slice(0, 3).forEach((image, index) => {
          const cell = el('div', 'rm-desk-tile__images-cell');
          cell.append(imageNode(image, holder));
          if (index === 2 && images.length > 3) cell.append(el('span', 'rm-desk-tile__images-more', `+${images.length - 3}`));
          holder.append(cell);
        });
        imageParent.append(holder);
      }
    }
    const previous = new Map([...parent.children].flatMap(node => {
      const record = rowRecords.get(node); return record ? [[record.key, record]] : [];
    }));
    const nodes = model.rows.map((row, index) => {
      const key = row.uid ? `uid:${row.uid}` : `index:${index}`;
      let record = previous.get(key);
      if (!record) {
        const node = el('div'), marker = el('span'), text = el('span', 'rm-desk-tile__text');
        node.append(marker, text); record = { key, node, marker, text }; rowRecords.set(node, record);
      }
      const lineClass = `rm-desk-tile__row${row.depth === 2 ? ' rm-desk-tile__row--nested' : ''}`;
      const markerClass = row.status ? `rm-desk-tile__check${row.status === 'DONE' ? ' rm-desk-tile__check--done' : ''}` : 'rm-desk-tile__bullet';
      if (record.node.className !== lineClass) record.node.className = lineClass;
      if (record.marker.className !== markerClass) record.marker.className = markerClass;
      if (record.text.textContent !== row.text) record.text.textContent = row.text;
      return record.node;
    });
    for (const [visible, className, text] of [[model.more, 'rm-desk-tile__more', '...'], [model.empty, 'rm-desk-tile__empty', 'Empty note']]) {
      if (visible) nodes.push([...parent.children].find(node => node.classList.contains(className)) || el('div', className, text));
    }
    reconcileChildren(parent, nodes);
  };
  return { el, icon, button, check, preview, clearPreview };
}
