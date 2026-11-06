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
    if (state) {
      state.active = false; state.notify = null; state.generation = (state.generation || 0) + 1;
      for (const record of state.records || []) record.retired = true;
      state.records = [];
    }
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
    const visibleImages = images.slice(0, 3);
    const imageMode = visibleImages.length > 1 ? 'multi' : visibleImages.length === 1 ? 'single' : 'empty';
    let state = imageStates.get(imageParent);
    // One record is one displayed occurrence. Match the visible three by source,
    // FIFO so duplicate URLs keep distinct nodes. A hidden or replaced occurrence
    // is a new lifetime; text, alt, and hidden-tail edits are not.
    const owned = () => state;
    const detachRecord = record => {
      record.retired = true;
      const node = record.node; record.node = null;
      // Search detaches a cached tile without retiring its preview. Remove the
      // old node from that subtree too, before the card can re-enter the grid.
      if (!node) return;
      const cell = node.closest('.rm-desk-tile__images-cell');
      (cell || node).remove();
    };
    const createRecord = image => {
      const node = document.createElement('img');
      const record = { src: image.src, node, failed: false, retired: false, generation: owned().generation };
      node.alt = image.alt; node.loading = 'lazy';
      // The tile owns native drag feedback and its private reorder payload.
      // Keep images clickable without starting a separate browser image drag.
      node.draggable = false;
      const current = () => !record.retired && record.generation === owned().generation && owned().active;
      node.addEventListener('load', () => { if (current()) owned().notify?.(); }, { once: true });
      node.addEventListener('error', () => {
        if (!current()) return;
        record.failed = true; record.node = null;
        const cell = node.closest('.rm-desk-tile__images-cell');
        const holder = node.closest('.rm-desk-tile__image, .rm-desk-tile__images');
        (cell || holder || node).remove();
        if (holder?.isConnected && !holder.querySelector('img')) holder.remove();
        owned().notify?.();
      }, { once: true });
      node.src = image.src;
      return record;
    };
    const placeVisible = () => {
      const live = state.records.filter(record => record.node && !record.failed);
      const existingHolder = [...imageParent.children].find(node => node.classList.contains(state.mode === 'single' ? 'rm-desk-tile__image' : 'rm-desk-tile__images'));
      if (!live.length) { existingHolder?.remove(); return; }
      const holder = existingHolder || el('div', state.mode === 'single' ? 'rm-desk-tile__image' : 'rm-desk-tile__images');
      if (!holder.parentElement) imageParent.append(holder);
      if (state.mode === 'single') {
        reconcileChildren(holder, [live[0].node]);
        return;
      }
      const cells = live.map(record => {
        const cell = record.node.closest('.rm-desk-tile__images-cell') || el('div', 'rm-desk-tile__images-cell');
        if (record.node.parentElement !== cell) cell.append(record.node);
        return cell;
      });
      const retained = new Set(cells);
      for (const child of [...holder.children]) if (!retained.has(child)) child.remove();
      cells.forEach((cell, index) => { if (holder.children[index] !== cell) holder.insertBefore(cell, holder.children[index] || null); });
      const third = state.records[2];
      const thirdCell = third?.node && !third.failed ? third.node.closest('.rm-desk-tile__images-cell') : null;
      const badgeText = images.length > 3 && thirdCell ? `+${images.length - 3}` : '';
      const badge = holder.querySelector('.rm-desk-tile__images-more');
      if (!badgeText) badge?.remove();
      else {
        const node = badge || el('span', 'rm-desk-tile__images-more', badgeText);
        if (node.textContent !== badgeText) node.textContent = badgeText;
        if (node.parentElement !== thirdCell) thirdCell.append(node);
      }
    };
    const matchVisible = () => {
      const queues = new Map();
      for (const record of state.records) {
        if (record.retired) continue;
        const queue = queues.get(record.src); if (queue) queue.push(record); else queues.set(record.src, [record]);
      }
      const next = visibleImages.map(image => {
        const queue = queues.get(image.src);
        const record = queue?.shift();
        if (!record) return createRecord(image);
        if (record.node && record.node.alt !== image.alt) record.node.alt = image.alt;
        return record;
      });
      const kept = new Set(next);
      for (const record of state.records) if (!kept.has(record)) detachRecord(record);
      state.records = next;
      placeVisible();
    };
    if (state?.mode === imageMode && imageMode !== 'empty') {
      state.notify = onImageChange;
      matchVisible();
    } else {
      retireImages(imageParent);
      imageParent.replaceChildren();
      if (imageMode !== 'empty') {
        state = { active: true, generation: 1, mode: imageMode, records: [], notify: onImageChange };
        imageStates.set(imageParent, state);
        state.records = visibleImages.map(image => createRecord(image));
        placeVisible();
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
