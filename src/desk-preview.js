const { createDeskGraphReader, validUid, bytes, membership } = require('./desk-graph-read');
const { CARRIER_SOURCE, deskCarrierUid, deskCodeSegments } = require('./desk-carrier');
const DESK_PREVIEW_ROWS = 11;
const LIMITS = Object.freeze({ nodes: 1024, children: 1024, membership: 4096, watches: 4096,
  referenceDepth: 64, references: 128, expansions: 1024, bytes: 2 * 1024 * 1024, images: 256 });
function previewError(message = 'Preview unavailable.') { return Object.assign(new Error(message.startsWith('Preview unavailable') ? message : `Preview unavailable: ${message}`), { code: 'preview-unavailable' }); }
const fail = message => { throw previewError(message); };
function safeDeskImageUrl(value, origin = globalThis.window?.location?.origin) {
  const text = String(value || '').trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol === 'http:' || url.protocol === 'https:') return text;
    if (url.protocol === 'blob:' && origin !== undefined && url.origin === origin) return text;
  } catch (_error) { /* not an image URL */ }
  return null;
}
function ledger(limits = {}) { return { limits: { ...LIMITS, ...limits }, references: new Set(), cache: new Map(), expansions: 0, sourceBytes: 0, outputBytes: 0, images: 0 }; }
function charge(state, key, amount, maximum) { state[key] += amount; if (state[key] > maximum) fail(`Preview ${key} limit exceeded.`); }
function parseDeskPreviewText(string, options = {}) {
  const state = options.ledger || ledger(options.limits), resolving = options.resolving || [];
  if (typeof string !== 'string') fail();
  if (resolving.length > state.limits.referenceDepth) fail('Preview reference depth exceeded.');
  charge(state, 'sourceBytes', bytes(string), state.limits.bytes);
  charge(state, 'expansions', 1, state.limits.expansions);
  let status = null; const images = [];
  const append = (parts, text) => { charge(state, 'outputBytes', bytes(text), state.limits.bytes); parts.push(text); };
  const parse = (prose) => {
    const parts = [];
    const token = new RegExp(`${CARRIER_SOURCE}|\\{\\{\\s*(?:embed-path|embed|\\[\\[\\s*(?:embed-path|embed)\\s*\\]\\])\\s*:[^{}]*\\}\\}|\\{\\{(?:(?:TODO|DONE)|\\[\\[(?:TODO|DONE)\\]\\])\\}\\}|!\\[[^\\]]*\\]\\([^)]*\\)|\\[[^\\]]*\\]\\(\\(\\([\\w-]{6,}\\)\\)\\)|\\[[^\\]]*\\]\\(\\[\\[[^\\]]+\\]\\]\\)|\\(\\([\\w-]{6,}\\)\\)|\\[[^\\]]*\\]\\([^)]+\\)|#?\\[\\[[^\\]]+\\]\\]`, 'g');
    let cursor = 0, match;
    while ((match = token.exec(prose))) {
      append(parts, prose.slice(cursor, match.index).replace(/\s+/g, ' ')); cursor = token.lastIndex;
      const source = match[0];
      const carrier = deskCarrierUid(source);
      if (carrier) {
        state.references.add(carrier); options.references?.add(carrier);
        if (state.references.size > state.limits.references) fail('Preview reference count exceeded.');
        if (resolving.includes(carrier) || typeof options.readString !== 'function') { append(parts, source); continue; }
        if (!state.cache.has(carrier)) {
          let value; try { value = options.readString(carrier); } catch (error) { throw previewError(error.message); }
          if (value != null && typeof value !== 'string') fail('Malformed referenced text.');
          state.cache.set(carrier, value ?? null);
        }
        const value = state.cache.get(carrier); if (value === null) continue;
        const parsed = parseDeskPreviewText(value, { ...options, ledger: state, resolving: [...resolving, carrier] });
        if (!status) status = parsed.status;
        append(parts, parsed.text); images.push(...parsed.images); continue;
      }
      if (/^\{\{\s*(?:embed-path|embed|\[\[\s*(?:embed-path|embed)\s*\]\])\s*:/i.test(source)) { append(parts, source); continue; }
      const task = /^\{\{(?:(TODO|DONE)|\[\[(TODO|DONE)\]\])\}\}$/.exec(source);
      if (task) { if (!status) status = task[1] || task[2]; continue; }
      const image = /^!\[([^\]]*)\]\(([^\s)]+)(?:\s+['"][^)]*['"])?\)$/.exec(source);
      if (image) {
        charge(state, 'images', 1, state.limits.images);
        const src = safeDeskImageUrl(image[2], options.origin); if (src) images.push({ src, alt: image[1] }); continue;
      }
      const alias = /^\[([^\]]*)\]\((?:\(\([\w-]{6,}\)\)|\[\[[^\]]+\]\])\)$/.exec(source);
      if (alias) { append(parts, alias[1]); continue; }
      const ref = /^\(\(([\w-]{6,})\)\)$/.exec(source);
      if (ref) {
        const uid = ref[1]; state.references.add(uid); options.references?.add(uid);
        if (state.references.size > state.limits.references) fail('Preview reference count exceeded.');
        if (resolving.includes(uid) || typeof options.readString !== 'function') { append(parts, source); continue; }
        if (resolving.length >= state.limits.referenceDepth) fail('Preview reference depth exceeded.');
        if (!state.cache.has(uid)) {
          let value; try { value = options.readString(uid); } catch (error) { throw previewError(error.message); }
          if (value != null && typeof value !== 'string') fail('Malformed referenced text.');
          state.cache.set(uid, value ?? null);
        }
        const value = state.cache.get(uid); if (value === null) continue;
        const parsed = parseDeskPreviewText(value, { ...options, ledger: state, resolving: [...resolving, uid] });
        if (!status) status = parsed.status;
        append(parts, parsed.text); images.push(...parsed.images); continue;
      }
      const link = /^\[([^\]]*)\]\([^)]+\)$/.exec(source);
      if (link) {
        const parsed = parseDeskPreviewText(link[1], { ...options, ledger: state, resolving: [...resolving, '@label'] });
        if (!status) status = parsed.status; images.push(...parsed.images); append(parts, parsed.text); continue;
      }
      const page = /^(#?)\[\[([^\]]+)\]\]$/.exec(source);
      append(parts, page ? page[1] + page[2] : source);
    }
    append(parts, prose.slice(cursor).replace(/\s+/g, ' ')); return parts.join('');
  };
  const text = deskCodeSegments(string, parse, code => { charge(state, 'outputBytes', bytes(code), state.limits.bytes); return code; }).trim();
  return { status, text, images, referenceUids: [...state.references] };
}
const nativeDeskPreviewText = (string, options) => { const { status, text } = parseDeskPreviewText(String(string || ''), options); return { status, text }; };
const nativeDeskText = nativeDeskPreviewText;
const plainDeskText = string => nativeDeskPreviewText(string).text;
const deskImages = (string, options) => parseDeskPreviewText(String(string || ''), options).images;
function pureDeskReferenceUid(string) {
  if (typeof string !== 'string' || string.includes('`')) return null;
  const token = '\\{\\{(?:TODO|\\[\\[TODO\\]\\])\\}\\}';
  const match = new RegExp(`^\\s*(?:(${token})\\s*)?\\(\\(([A-Za-z0-9_-]{6,255})\\)\\)\\s*(?:(${token}))?\\s*$`).exec(string);
  return match && !(match[1] && match[3]) ? match[2] : null;
}
function pureDeskEmbedUid(string) { return deskCarrierUid(string); }
function deskEmbedPreviewUid(string) {
  if (typeof string !== 'string' || string.includes('`')) return null;
  const token = '\\{\\{(?:(?:TODO|DONE)|\\[\\[(?:TODO|DONE)\\]\\])\\}\\}';
  const withoutState = string.replace(new RegExp(token, 'gi'), ' ')
    .replace(/(?:^|\s)(?:\d+h(?:\d+(?:min|m))?|\d+(?:min|m))(?=\s|$)/gi, ' ')
    .replace(/(?:^|\s)\d{1,2}:\d{2}-\d{1,2}:\d{2}(?=\s|$)/g, ' ')
    .replace(/(?:^|\s)d\d{1,2}(?::\d{1,2})?(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
  return deskCarrierUid(withoutState);
}
function imageOnlyDeskRow(string) {
  // Native ANb classifies the raw row, independently of URL/token acceptance.
  return /^\s*(?:!\[[^\]]*\]\([^)]*\)\s*)+$/.test(string);
}
function stableImages(images) { const seen = new Set(); return images.filter(image => !seen.has(image.src) && seen.add(image.src)); }
function pruneDeskPreviewRows(rows) {
  const kept = []; let nextDepth = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!row.text && !row.status && row.images.length && nextDepth <= row.depth) continue;
    const result = { status: row.status, text: row.text, depth: row.depth };
    Object.defineProperty(result, 'uid', { value: row.uid, enumerable: false }); kept.unshift(result); nextDepth = row.depth;
  }
  return kept;
}
function createModernDeskPreviewAdapter(api, options = {}) {
  let reader = createDeskGraphReader(api, options.limits);
  return { read: uid => reader.read(uid), watch: (uid, fields) => reader.watch(uid, fields),
    watchTargets: () => reader.watchTargets(), clear() { reader = createDeskGraphReader(api, options.limits); },
    origin: options.origin ?? globalThis.window?.location?.origin, limits: options.limits, get pattern() { return reader.pattern; }, get counts() { return reader.counts; } };
}
function buildDeskFullPreview({ uid, adapter, rootString, search = false, limit = DESK_PREVIEW_ROWS } = {}) {
  try {
    if (!adapter || !Number.isInteger(limit) || limit < 0 || limit > DESK_PREVIEW_ROWS) fail();
    const rootNode = adapter.read(uid); if (!rootNode || rootNode.kind !== 'block') fail();
    if (rootString !== undefined && rootString !== rootNode.string) fail('Preview root changed; refresh.');
    const state = ledger(adapter.limits);
    const parse = text => parseDeskPreviewText(text, { ledger: state, origin: adapter.origin, readString: id => {
      const node = adapter.read(id); return node ? node.string ?? node.title : null;
    } });
    const root = parse(rootNode.string);
    const referenceUid = !rootNode.children.length ? pureDeskReferenceUid(rootNode.string) : null;
    const sourceUid = deskEmbedPreviewUid(rootNode.string) || referenceUid;
    const source = sourceUid ? adapter.read(sourceUid) : null;
    if (sourceUid && !source) root.text = '(missing)';
    const queue = [];
    const admitMembers = (node, depth) => {
      for (const child of node.children) adapter.watch(child.uid, ['block/order']);
      return node.children.map(child => ({ ...child, parent: node.uid, depth }));
    };
    // Legacy references retain local-child precedence. Native embeds keep both
    // trees visible because local CLOCK/notes must not hide the embedded source.
    const direct = sourceUid && !referenceUid ? [...(source?.children || []), ...rootNode.children] : (sourceUid ? (source?.children || []) : rootNode.children);
    if (sourceUid && source) queue.push(...admitMembers(source, 1));
    if (!sourceUid || !referenceUid) queue.push(...admitMembers(rootNode, 1));
    const visited = new Set([uid, ...(sourceUid ? [sourceUid] : [])]);
    const rendered = [], images = [...root.images]; let counted = 0, exemptions = 0, more = false;
    while (queue.length) {
      if (counted >= limit) { more = true; break; }
      const entry = queue.shift();
      if (visited.has(entry.uid)) fail('Repeated preview topology.'); visited.add(entry.uid);
      const row = adapter.read(entry.uid);
      if (!row || row.kind !== 'block' || row.order !== entry.order) fail('Incomplete preview row.');
      if (row.parents && (row.parents.length !== 1 || row.parents[0] !== entry.parent)) fail('Wrong preview parent.');
      const parsed = parse(row.string); rendered.push({ uid: row.uid, depth: entry.depth, ...parsed }); images.push(...parsed.images);
      if (imageOnlyDeskRow(row.string) && exemptions < 3) exemptions++; else counted++;
      if (row.children.some(child => visited.has(child.uid))) fail('Cyclic preview membership.');
      if (row.children.length) {
        if (entry.depth < 2 && row.open !== false) queue.unshift(...admitMembers(row, 2));
        else more = true;
      }
    }
    const rows = pruneDeskPreviewRows(rendered); let searchText = root.text, searchIncomplete = false;
    if (search) {
      try {
        const parts = [root.text];
        for (const member of direct) {
          const node = adapter.read(member.uid); if (!node || node.kind !== 'block' || node.order !== member.order) fail();
          parts.push(parse(node.string).text);
        }
        searchText = parts.join(' '); if (bytes(searchText) > state.limits.bytes) fail();
      } catch (_error) { searchIncomplete = true; }
    }
    const finalImages = stableImages(images);
    return { root: { status: root.status, text: root.text }, rows, images: finalImages, more,
      empty: !root.status && !root.text && !rows.length && !finalImages.length && !more,
      sourceUid, referenceUids: [...state.references], watchTargets: adapter.watchTargets(),
      searchReady: search, searchText, searchIncomplete };
  } catch (error) {
    const failure = previewError(error.message); failure.watchTargets = adapter?.watchTargets?.() || [{ uid, fields: ['block/string', 'block/open', 'block/children'] }]; throw failure;
  }
}
// Compatibility seam for pure callers/tests. The product uses only the public,
// staged adapter above; no timing-query fallback is used for production previews.
function readDeskPreview(uid, readChildren, limit = DESK_PREVIEW_ROWS, readString, rootString = '') {
  const entries = new Map(), cache = new Map(), watches = new Map();
  const watch = (id, fields) => { if (!watches.has(id)) watches.set(id, new Set()); fields.forEach(f => watches.get(id).add(f)); };
  function list(rows) {
    if (!Array.isArray(rows) || rows.length > LIMITS.children) fail();
    const members = membership(rows.map((row, i) => ({ 'block/uid': row?.uid, 'block/order': row?.order ?? (row?.string === undefined ? i : undefined) })));
    for (const row of rows) { if (row.open !== undefined && typeof row.open !== 'boolean') fail(); entries.set(row.uid, row); }
    return members;
  }
  const adapter = {
    read(id) {
      if (cache.has(id)) return cache.get(id);
      if (cache.size >= LIMITS.nodes || !validUid(id)) fail();
      const entry = entries.get(id);
      const string = id === uid ? rootString : entry?.string ?? readString?.(id) ?? '';
      const node = { uid: id, string, kind: 'block', order: entry?.order ?? 0, open: entry?.open,
        children: list(entry?.children ?? readChildren(id)) };
      watch(id, ['block/string', 'block/open', 'block/children']); cache.set(id, node); return node;
    }, watch, watchTargets: () => [...watches].map(([id, fields]) => ({ uid: id, fields: [...fields] })),
  };
  // Preserve missing/cyclic reference semantics independently of the child seam.
  const originalRead = adapter.read.bind(adapter);
  if (readString) adapter.read = id => {
    if (id !== uid && !entries.has(id) && !cache.has(id)) {
      const text = readString(id);
      if (text == null) { const children = list(readChildren(id)); if (!children.length) { cache.set(id, null); watch(id, ['block/string']); return null; }
        cache.set(id, { uid: id, string: '', kind: 'block', order: 0, children });
      } else if (typeof text !== 'string') fail();
      else entries.set(id, { uid: id, string: text, order: 0 });
    }
    return originalRead(id);
  };
  return buildDeskFullPreview({ uid, adapter, limit, search: true });
}
function readDeskPlan(api, uid) {
  const reader = createDeskGraphReader(api);
  const root = reader.read(uid); if (!root || root.kind !== 'block') fail('Plan unavailable.');
  return { 'block/uid': root.uid, 'block/string': root.string, 'block/children': root.children.map(member => {
    const node = reader.read(member.uid);
    if (!node || node.kind !== 'block' || node.order !== member.order || node.parents && (node.parents.length !== 1 || node.parents[0] !== uid)) fail('Plan membership is malformed.');
    return { 'block/uid': node.uid, 'block/string': node.string, 'block/order': node.order };
  }) };
}
module.exports = { DESK_PREVIEW_ROWS, LIMITS, safeDeskImageUrl, deskCodeSegments, deskImages, plainDeskText, nativeDeskText,
  nativeDeskPreviewText, parseDeskPreviewText, pureDeskReferenceUid, pureDeskEmbedUid, deskEmbedPreviewUid, pruneDeskPreviewRows, readDeskPreview,
  createModernDeskPreviewAdapter, buildDeskFullPreview, readDeskPlan };
