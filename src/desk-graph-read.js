// Strict public-pull projection shared by read-only previews and guarded removal.
// Shallow membership never materializes descendant strings before admission.
const NODE_PATTERN = '[:block/uid :block/string :node/title :block/order :block/open :block/heading :block/text-align :block/children-view-type {:block/page [:block/uid :node/title]} {:block/_children [:block/uid]} {:block/children [:block/uid :block/order]}]';
const UID_RE = /^[A-Za-z0-9_-]{1,255}$/;
class DeskGraphReadError extends Error {
  constructor(message = 'Unreadable graph projection.') { super(message); this.code = 'desk-graph-unavailable'; }
}
const fail = message => { throw new DeskGraphReadError(message); };
const own = (o, key) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, key);
const present = (o, key) => own(o, key) || own(o, `:${key}`);
function attr(o, key) {
  if (own(o, key) && own(o, `:${key}`) && JSON.stringify(o[key]) !== JSON.stringify(o[`:${key}`])) fail('Conflicting attributes.');
  return own(o, key) ? o[key] : o?.[`:${key}`];
}
const validUid = value => typeof value === 'string' && UID_RE.test(value);
const bytes = value => new TextEncoder().encode(value).length;
function membership(value, maximum = 1024) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) fail('Invalid or excessive child membership.');
  const seen = new Set(), orders = new Set();
  const rows = value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail();
    const uid = attr(row, 'block/uid'), order = attr(row, 'block/order');
    if (!validUid(uid) || seen.has(uid) || !Number.isSafeInteger(order) || order < 0 || orders.has(order)) fail('Invalid child order or UID.');
    seen.add(uid); orders.add(order); return { uid, order };
  }).sort((a, b) => a.order - b.order);
  if (rows.some((row, index) => row.order !== index)) fail('Incomplete child order.');
  return rows;
}
function normalizeEntity(raw, uid, maxChildren = 1024) {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || attr(raw, 'block/uid') !== uid || !validUid(uid)) fail();
  const isBlock = present(raw, 'block/string'), isPage = present(raw, 'node/title');
  if (isBlock === isPage) fail('Ambiguous entity kind.');
  const text = attr(raw, isBlock ? 'block/string' : 'node/title');
  if (typeof text !== 'string' || isPage && !text) fail();
  const order = attr(raw, 'block/order');
  if (isBlock && (!Number.isSafeInteger(order) || order < 0)) fail('Invalid block order.');
  const properties = {};
  for (const field of ['open', 'heading', 'text-align', 'children-view-type']) {
    if (!present(raw, `block/${field}`)) continue;
    const v = attr(raw, `block/${field}`);
    if (field === 'open' ? typeof v !== 'boolean'
      : field === 'heading' ? !Number.isInteger(v) || v < 0 || v > 3
        : field === 'text-align' ? !['left', 'center', 'right', 'justify'].includes(v)
          : !['bullet', 'numbered', 'document'].includes(v)) fail(`Invalid ${field}.`);
    properties[field] = v;
  }
  let page = null;
  if (present(raw, 'block/page')) {
    const p = attr(raw, 'block/page');
    if (!p || typeof p !== 'object' || Array.isArray(p) || !validUid(attr(p, 'block/uid'))) fail('Invalid page identity.');
    page = { uid: attr(p, 'block/uid') };
    if (present(p, 'node/title')) { if (typeof attr(p, 'node/title') !== 'string') fail(); page.title = attr(p, 'node/title'); }
  }
  let parents = null;
  if (present(raw, 'block/_children')) {
    const p = attr(raw, 'block/_children');
    if (!Array.isArray(p) || p.length > 1) fail('Invalid parent membership.');
    parents = p.map(item => { const id = attr(item, 'block/uid'); if (!validUid(id) || id === uid) fail(); return id; });
  }
  if (present(raw, 'block/children') && attr(raw, 'block/children') === undefined) fail('Unreadable child membership.');
  const children = membership(attr(raw, 'block/children'), maxChildren);
  if (children.some(child => child.uid === uid)) fail('Self-referencing child membership.');
  return { uid, kind: isPage ? 'page' : 'block', string: isBlock ? text : undefined, title: isPage ? text : undefined,
    order: isBlock ? order : undefined, properties, open: properties.open, parents, page,
    children };
}
function createDeskGraphReader(api, options = {}) {
  const limits = { nodes: 1024, children: 1024, membership: 4096, bytes: 2 * 1024 * 1024, watches: 4096, ...options };
  if (typeof api?.data?.pull !== 'function') fail('Public data.pull is required.');
  const cache = new Map(), watches = new Map();
  let totalBytes = 0, edges = 0;
  const watch = (uid, fields) => {
    if (!validUid(uid)) fail();
    if (!watches.has(uid)) { if (watches.size >= limits.watches) fail('Preview watch limit exceeded.'); watches.set(uid, new Set()); }
    for (const field of fields) watches.get(uid).add(field);
  };
  const read = uid => {
    options.assertContext?.();
    if (cache.has(uid)) return cache.get(uid);
    if (!validUid(uid) || cache.size >= limits.nodes) fail('Graph read limit exceeded.');
    watch(uid, ['block/string', 'block/open', 'block/children', 'node/title']);
    const raw = api.data.pull(NODE_PATTERN, [':block/uid', uid]);
    options.assertContext?.();
    const node = normalizeEntity(raw, uid, limits.children);
    if (node) {
      totalBytes += bytes(node.string ?? node.title); edges += node.children.length;
      if (totalBytes > limits.bytes || edges > limits.membership) fail('Graph resource limit exceeded.');
      if (node.kind === 'page') watches.set(uid, new Set(['node/title', 'block/children']));
      else watches.get(uid).delete('node/title');
    }
    cache.set(uid, node); return node;
  };
  return { read, watch, cache, pattern: NODE_PATTERN,
    watchTargets: () => [...watches].map(([uid, fields]) => ({ uid, fields: [...fields] })),
    get counts() { return { nodes: cache.size, bytes: totalBytes, membership: edges, watches: watches.size }; } };
}
module.exports = { NODE_PATTERN, DeskGraphReadError, attr, present, validUid, bytes, membership, normalizeEntity, createDeskGraphReader };
