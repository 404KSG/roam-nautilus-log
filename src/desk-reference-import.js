import { graphName } from './graph-context';

export class DeskReferenceImportError extends Error {
  constructor(message, code = 'invalid-drop') {
    super(message);
    this.name = 'DeskReferenceImportError';
    this.code = code;
  }
}

export const ROAM_DROP_TYPES = Object.freeze([
  'roam/block-uid-list-only-parents', 'roam/block-uid-list', 'roam/roam-uri-list',
]);

export const isSafeDeskReferenceUid = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{6,255}$/.test(value);
const lines = (value, limit = 128) => {
  if (typeof value !== 'string' || value.length > 32768) return null;
  const result = [...new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))];
  return result.length <= limit ? result : null;
};
const transferTypes = transfer => {
  try { return Array.from(transfer?.types || []); } catch (_error) { return []; }
};
export const hasRoamDropPayload = transfer => transferTypes(transfer).some(type => ROAM_DROP_TYPES.includes(type));
export const hasDropModifier = event => Boolean(event?.altKey || event?.ctrlKey || event?.metaKey || event?.shiftKey);

function decodePart(value) {
  try { return decodeURIComponent(value); } catch (_error) { throw new DeskReferenceImportError('The native Roam link is malformed. Nothing was added.', 'invalid-uri'); }
}

function parseRoamUri(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new DeskReferenceImportError('The native Roam link is malformed. Nothing was added.', 'invalid-uri');
  let url;
  try { url = new URL(value); } catch (_error) { throw new DeskReferenceImportError('The native Roam link is malformed. Nothing was added.', 'invalid-uri'); }
  const hosted = url.protocol === 'https:' && ['roamresearch.com', 'www.roamresearch.com'].includes(url.hostname);
  if (url.protocol !== 'roam:' && !hosted) throw new DeskReferenceImportError('Only native Roam block drags are accepted.', 'invalid-uri');
  const candidates = [url.hash, `${url.pathname}${url.hash}`, value.slice(value.indexOf(':') + 1)];
  let match = null;
  for (const candidate of candidates) {
    match = /(?:^|#)\/?(app|offline)\/([^/?#]+)\/page\/([^/?#]+)/.exec(candidate);
    if (match) break;
  }
  if (!match) throw new DeskReferenceImportError('The native Roam link is malformed. Nothing was added.', 'invalid-uri');
  const type = match[1] === 'app' ? 'hosted' : 'offline';
  const graphNameValue = decodePart(match[2]);
  const uid = decodePart(match[3]);
  if (!graphNameValue || !isSafeDeskReferenceUid(uid)) throw new DeskReferenceImportError('The native Roam link is malformed. Nothing was added.', 'invalid-uri');
  return { type, graphName: graphNameValue, uid };
}

/** Read drag data while the browser still grants access; never retain DataTransfer. */
export function freezeReferenceDrop(transfer, originContext, expectedSourceUid) {
  if (!transfer || typeof transfer.getData !== 'function') throw new DeskReferenceImportError('Only native Roam block drags are accepted.', 'invalid-payload');
  if (Number(transfer.files?.length) > 0 || transferTypes(transfer).includes('Files')) {
    throw new DeskReferenceImportError('Files cannot be added to Nautilus Desk.', 'files');
  }
  const onlyParents = lines(transfer.getData('roam/block-uid-list-only-parents'));
  const list = lines(transfer.getData('roam/block-uid-list'));
  if (!onlyParents || !list || (!onlyParents.length && !list.length)) {
    throw new DeskReferenceImportError('Only native Roam block drags are accepted.', 'invalid-payload');
  }
  if (onlyParents?.length && list?.length && (onlyParents.length !== 1 || list.length !== 1 || onlyParents[0] !== list[0])) {
    throw new DeskReferenceImportError('The native block payload is ambiguous. Drag one block at a time.', 'multiple-blocks');
  }
  const sourceUid = (onlyParents?.length ? onlyParents : list)?.[0];
  if (!sourceUid || !(onlyParents?.length === 1 || !onlyParents?.length) || !(list?.length === 1 || !list?.length) || !isSafeDeskReferenceUid(sourceUid)) {
    throw new DeskReferenceImportError('Drag one readable block at a time.', 'multiple-blocks');
  }
  if (expectedSourceUid !== sourceUid) throw new DeskReferenceImportError('The drag source changed. Start a new drag.', 'source-changed');
  if (!originContext?.graphName || !originContext?.provider) throw new DeskReferenceImportError('The graph changed. Start a new drag.', 'context-changed');
  const uriLines = lines(transfer.getData('roam/roam-uri-list'));
  if (!uriLines?.length) throw new DeskReferenceImportError('Could not confirm the source graph. Nothing was added.', 'invalid-uri');
  const uris = uriLines.map(parseRoamUri);
  if (uris.some(uri => uri.graphName !== originContext.graphName || (originContext.graphType && uri.type !== originContext.graphType))) {
    throw new DeskReferenceImportError('Cross-graph drops are not supported.', 'cross-graph');
  }
  if (uris.some(uri => uri.uid !== sourceUid)) throw new DeskReferenceImportError('The native Roam link does not match the dragged block.', 'invalid-uri');
  return Object.freeze({ sourceUid, uris: Object.freeze(uris.map(uri => Object.freeze({ ...uri }))) });
}

export function readDeskDropContext(host = globalThis.window) {
  const provider = host?.roamAlphaAPI;
  const name = graphName(host);
  let userUid = null;
  try { userUid = provider?.user?.uid?.() || null; } catch (_error) { userUid = null; }
  const graphType = typeof provider?.graph?.type === 'string' && provider.graph.type ? provider.graph.type : null;
  return { provider, graphName: name, graphType, userUid };
}

export function sameDeskDropContext(origin, current) {
  return Boolean(origin?.provider && current?.provider && origin.provider === current.provider
    && origin.graphName && origin.graphName === current.graphName
    && (!origin.graphType || origin.graphType === current.graphType)
    && (!origin.userUid || origin.userUid === current.userUid));
}

const pick = (entity, ...names) => {
  for (const name of names) if (Object.prototype.hasOwnProperty.call(entity || {}, name)) return entity[name];
  return undefined;
};
const uidOf = value => typeof value === 'string' ? value : pick(value, 'uid', 'block/uid', ':block/uid');
const listOf = value => Array.isArray(value) ? value : typeof value === 'string' ? [value] : value && typeof value[Symbol.iterator] === 'function' ? [...value] : [];

export function normalizeDeskReferenceEntity(entity) {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return null;
  const uid = uidOf(entity);
  const string = pick(entity, 'string', 'block/string', ':block/string');
  const title = pick(entity, 'title', 'node/title', ':node/title');
  const parents = pick(entity, 'parentUids', 'parentUid', 'block/_children', ':block/_children', 'parents');
  const page = pick(entity, 'pageUid', 'block/page', ':block/page', 'page');
  const children = pick(entity, 'children', 'block/children', ':block/children');
  const parentUids = listOf(parents).map(uidOf).filter(Boolean);
  const pageUid = typeof page === 'string' ? page : uidOf(page);
  const childRows = listOf(children).map(child => ({ uid: uidOf(child), order: pick(child, 'order', 'block/order', ':block/order') }));
  return {
    uid, string, title, parentUids, pageUid,
    children: childRows,
    edited: pick(entity, 'edited', 'edit/time', ':edit/time'),
  };
}

export function fingerprintDeskReferenceSource(entity) {
  const value = normalizeDeskReferenceEntity(entity);
  if (!value) return null;
  const children = value.children.map(child => `${child.uid || ''}:${Number.isInteger(child.order) ? child.order : ''}`).sort();
  return JSON.stringify([value.uid, value.string, value.parentUids.slice().sort(), value.pageUid, children, value.edited ?? null]);
}

export async function stableDeskReferenceUid({ graphName: name, graphType = '', planUid, sourceUid, crypto = globalThis.crypto, TextEncoderCtor = globalThis.TextEncoder, btoaImpl = globalThis.btoa } = {}) {
  if (!name || !planUid || !sourceUid || !crypto?.subtle?.digest || typeof TextEncoderCtor !== 'function') {
    throw new DeskReferenceImportError('This browser cannot safely reserve a reference ID.', 'uid-unavailable');
  }
  const input = new TextEncoderCtor().encode(`nautilus-reference-v1\u0000${graphType}\u0000${name}\u0000${planUid}\u0000${sourceUid}`);
  let digest;
  try { digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input)); }
  catch (_error) { throw new DeskReferenceImportError('This browser cannot safely reserve a reference ID.', 'uid-unavailable'); }
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  const encode = typeof btoaImpl === 'function' ? btoaImpl : null;
  if (!encode) throw new DeskReferenceImportError('This browser cannot safely reserve a reference ID.', 'uid-unavailable');
  const uid = encode(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '').slice(0, 9);
  if (!isSafeDeskReferenceUid(uid)) throw new DeskReferenceImportError('Could not reserve a safe reference ID.', 'uid-unavailable');
  return uid;
}

export const canonicalDeskReference = sourceUid => `{{[[TODO]]}} ((${sourceUid}))`;

const referencePullPattern = '[:block/uid :block/string :node/title :edit/time {:block/page [:block/uid :node/title]} {:block/_children [:block/uid]} {:block/children [:block/uid :block/string :block/order {:block/_children [:block/uid]}]}]';
const raw = (entity, ...names) => {
  for (const name of names) if (Object.prototype.hasOwnProperty.call(entity || {}, name)) return entity[name];
  return undefined;
};
const uid = value => typeof value === 'string' ? value : raw(value, 'uid', 'block/uid', ':block/uid');
const strictRows = (value, optional) => {
  if (value === undefined || value === null) return optional ? [] : null;
  return Array.isArray(value) ? value : null;
};
const strictUid = (value) => typeof uid(value) === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(uid(value)) ? uid(value) : null;
const orderedChildren = (rows) => {
  if (!rows.every(Boolean) || new Set(rows.map(row => row.uid)).size !== rows.length
    || new Set(rows.map(row => row.order)).size !== rows.length) return null;
  // Cardinality-many pull results have no guaranteed enumeration order.
  const ordered = [...rows].sort((a, b) => a.order - b.order);
  return ordered.every((row, index) => row.order === index) ? ordered : null;
};
const strictChildren = (value, parentUid) => {
  const rows = strictRows(value, true);
  if (!rows) return null;
  const normalized = rows.map((child) => {
    if (!child || typeof child !== 'object' || Array.isArray(child)) return null;
    const childUid = strictUid(child);
    const order = raw(child, 'order', 'block/order', ':block/order');
    const parents = strictRows(raw(child, 'block/_children', ':block/_children'), false);
    return childUid && Number.isInteger(order) && order >= 0
      && parents?.length === 1 && strictUid(parents[0]) === parentUid ? { uid: childUid, order } : null;
  });
  return orderedChildren(normalized);
};

/** The import path uses only the current public data.pull/data.block.create seam. */
export function createModernReferenceAdapter(api) {
  const pull = api?.data?.pull;
  const create = api?.data?.block?.create;
  if (typeof pull !== 'function' || typeof create !== 'function') {
    throw new DeskReferenceImportError('Modern Roam data.pull and data.block.create are required for reference imports.', 'api-unavailable');
  }
  return {
    api,
    pull(uidValue) { return pull.call(api.data, referencePullPattern, [':block/uid', uidValue]); },
    create({ uid: blockUid, parentUid, order, string, open }) {
      return create.call(api.data.block, {
        location: { 'parent-uid': parentUid, order },
        block: { uid: blockUid, string, open },
      });
    },
  };
}

/** Strictly preserve all pulled direct children; unlike readChildren this never filters malformed rows. */
export function readStrictReferenceOutline(adapter, planUid) {
  const root = adapter.pull(planUid);
  if (!root || typeof root !== 'object' || Array.isArray(root)
    || strictUid(root) !== planUid
    || typeof raw(root, 'string', 'block/string', ':block/string') !== 'string'
    || !isNautilusRenderer(raw(root, 'string', 'block/string', ':block/string'))) {
    throw new DeskReferenceImportError('The Nautilus plan is no longer a readable renderer root.', 'invalid-plan');
  }
  const children = strictRows(raw(root, 'children', 'block/children', ':block/children'), true);
  if (!children) throw new DeskReferenceImportError('The plan outline is unreadable.', 'invalid-outline');
  const rows = children.map((child) => {
    if (!child || typeof child !== 'object' || Array.isArray(child)) return null;
    const childUid = strictUid(child);
    const string = raw(child, 'string', 'block/string', ':block/string');
    const order = raw(child, 'order', 'block/order', ':block/order');
    const parents = strictRows(raw(child, 'parentUids', 'parentUid', 'block/_children', ':block/_children', 'parents'), false);
    const parentUids = parents?.map(strictUid);
    if (!childUid || typeof string !== 'string' || !Number.isInteger(order) || order < 0
      || !parentUids || parentUids.length !== 1 || parentUids[0] !== planUid) return null;
    return { uid: childUid, string, order };
  });
  const ordered = orderedChildren(rows);
  if (!ordered) throw new DeskReferenceImportError('The plan outline is incomplete or malformed.', 'invalid-outline');
  return ordered;
}

export function readStrictReferenceEntity(adapter, uidValue) {
  const entity = adapter.pull(uidValue);
  if (entity === null || entity === undefined) return null;
  const invalid = () => { throw new DeskReferenceImportError('The block metadata is incomplete or malformed. Nothing else was changed.', 'invalid-entity'); };
  // Only a null pull means absent. Malformed occupancy must not permit a create
  // at that UID, even if the occupied block cannot be used as a reference.
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return invalid();
  const entityUid = strictUid(entity);
  const string = raw(entity, 'string', 'block/string', ':block/string');
  const title = raw(entity, 'title', 'node/title', ':node/title');
  const parents = strictRows(raw(entity, 'parentUids', 'parentUid', 'block/_children', ':block/_children', 'parents'), false);
  const parentUids = parents?.map(strictUid);
  const page = raw(entity, 'pageUid', 'block/page', ':block/page', 'page');
  const pageUid = strictUid(page);
  const children = strictChildren(raw(entity, 'children', 'block/children', ':block/children'), entityUid);
  if (entityUid !== uidValue || typeof string !== 'string' || (title !== undefined && typeof title !== 'string')
    || !parentUids || parentUids.length !== 1 || !parentUids[0] || !pageUid || !children) return invalid();
  return { uid: entityUid, string, title, parentUids, pageUid, children, edited: raw(entity, 'edited', 'edit/time', ':edit/time') };
}

const rendererName = /\{\{\s*(?:\[\[\s*)?([a-z][a-z0-9_/-]*)(?:\s*\]\])?\s*(?::|\}\})/gi;
export function isUnsupportedReferenceSource(string) {
  if (typeof string !== 'string') return true;
  for (const match of string.matchAll(rendererName)) {
    const name = match[1].toLowerCase();
    if (name !== 'todo' && name !== 'done') return true;
  }
  return false;
}

const isNautilusRenderer = string => /\{\{\s*\[\[roam\/render\]\]\s*:\s*\(\(roam-render-Nautilus(?:-Log|-Flow)?-cljs\)\)/i.test(string);
