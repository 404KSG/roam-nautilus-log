/* Pure, conservative policy for Nautilus-owned completion timestamps. */
const { doneMarkerString } = require('./timing-core');
// A real completion-shaped field may be quoted/code-formatted, but ordinary
// words, URLs' UID-like segments, and block references must not disable it.
const TOKEN_RE = /(?:^|[^A-Za-z0-9_-])d\d{1,2}(?::\d{1,2})?(?=$|[^A-Za-z0-9_-])/i;
const REF_OR_URL_RE = /\(\([A-Za-z0-9_-]{6,}\)\)|https?:\/\/[^\s)]+/gi;
function hasCompletionField(string) {
  // Reference UIDs and URL paths are data identifiers, not completion fields.
  return TOKEN_RE.test(String(string || '').replace(REF_OR_URL_RE, '').replace(/(^|\s)d\d+%(?=\s|$)/gi, '$1'));
}
const OWNED_TAIL_RE = / d([01]\d|2[0-3]):([0-5]\d)$/;
const STATUS_RE = /\{\{\[\[(TODO|DONE)\]\]\}\}|\{\{(TODO|DONE)\}\}/i;
const UID_RE = /^[A-Za-z0-9_-]{6,128}$/;
const NATIVE_ID_RE = /^block-input-([A-Za-z0-9_:-]+)-([A-Za-z0-9_-]{9})$/;
const RECEIPT_VERSION = 1;
const MAX_RECEIPTS = 64;
const MAX_RECEIPT_BYTES = 32 * 1024;

function status(string) {
  const match = STATUS_RE.exec(typeof string === 'string' ? string : '');
  return match ? (match[1] || match[2]).toUpperCase() : null;
}

function nativeUid(id) {
  return NATIVE_ID_RE.exec(String(id || ''))?.[2] || null;
}

function oneStatus(string) {
  return typeof string === 'string' && (string.match(new RegExp(STATUS_RE.source, 'gi')) || []).length === 1;
}

function normalizedStatus(string) {
  return String(string).replace(STATUS_RE, '{{STATE}}');
}

function todoMarkerString(before) {
  if (typeof before !== 'string') throw new TypeError('A block string is required.');
  return before.replace(STATUS_RE, '{{[[TODO]]}}');
}

function tokenFor(date) {
  const instant = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('A valid completion instant is required.');
  return `d${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`;
}

function tailToken(string) {
  const match = OWNED_TAIL_RE.exec(typeof string === 'string' ? string : '');
  return match ? match[0].slice(1) : null;
}

function normalizedReceiptBody(string) {
  const withoutTail = String(string ?? '').replace(OWNED_TAIL_RE, '');
  return normalizedStatus(withoutTail);
}

const bytes = value => new TextEncoder().encode(value).length;
const scopedText = (value, max = 512, empty = false) => typeof value === 'string' && value.length <= max
  && (empty || value.trim().length > 0) && !/[\u0000-\u001f]/.test(value);

function parseReceipts(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: { v: RECEIPT_VERSION, items: [] } };
  let parsed;
  try {
    const encoded = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof encoded !== 'string' || bytes(encoded) > MAX_RECEIPT_BYTES) return { ok: false, value: null };
    parsed = JSON.parse(encoded);
  } catch (_error) { return { ok: false, value: null }; }
  if (!parsed || parsed.v !== RECEIPT_VERSION || !Array.isArray(parsed.items) || parsed.items.length > MAX_RECEIPTS
    || Object.keys(parsed).some((key) => key !== 'v' && key !== 'items')) return { ok: false, value: null };
  const seen = new Set();
  for (const item of parsed.items) {
    if (!item || Object.keys(item).some((key) => !['v', 'alg', 'graph', 'graphType', 'userUid', 'uid', 'token', 'bodyHash', 'at'].includes(key))
      || item.v !== RECEIPT_VERSION || item.alg !== 'sha256'
      || !scopedText(item.graph) || !scopedText(item.graphType, 64, true)
      || !scopedText(item.userUid, 256) || typeof item.uid !== 'string' || !UID_RE.test(item.uid)
      || typeof item.token !== 'string' || !/^(?:d(?:[01]\d|2[0-3]):[0-5]\d)$/.test(item.token)
      || typeof item.bodyHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.bodyHash)
      || !Number.isSafeInteger(item.at) || item.at < 0 || item.at > 8640000000000000) return { ok: false, value: null };
    const key = `${item.graph}\u0000${item.graphType}\u0000${item.userUid}\u0000${item.uid}`;
    if (seen.has(key)) return { ok: false, value: null };
    seen.add(key);
  }
  return { ok: true, value: { v: RECEIPT_VERSION, items: parsed.items.slice() } };
}

function receiptFor(receipts, uid, context = null) {
  return receipts?.items?.find((item) => item.uid === uid && (!context || (item.graph === context.graph
    && item.graphType === context.graphType && item.userUid === context.userUid))) || null;
}

function receiptMatches(receipt, context, uid, string, bodyHash) {
  if (!receipt || receipt.v !== RECEIPT_VERSION || receipt.alg !== 'sha256') return false;
  if (!context || receipt.graph !== context.graph || receipt.graphType !== context.graphType
    || receipt.userUid !== context.userUid || !context.userUid || receipt.uid !== uid) return false;
  return tailToken(string) === receipt.token && receipt.bodyHash === bodyHash;
}

function completionMutation(before, token, { allowOwnedTail = false } = {}) {
  if (!/^d(?:[01]\d|2[0-3]):[0-5]\d$/.test(token)) throw new TypeError('Invalid completion token.');
  const afterDone = status(before) === 'DONE' ? before : doneMarkerString(before);
  if (!oneStatus(afterDone)) return { kind: 'preserve', string: afterDone };
  const existing = tailToken(afterDone);
  // Any visible completion-shaped text is foreign unless it is the one exact
  // tail field that the caller has already verified as ours.
  if (hasCompletionField(afterDone) && !(allowOwnedTail && existing)) return { kind: 'preserve', string: afterDone };
  if (/\s$/.test(afterDone.replace(OWNED_TAIL_RE, ''))) return { kind: 'preserve', string: afterDone };
  const base = existing && allowOwnedTail ? afterDone.replace(OWNED_TAIL_RE, '') : afterDone;
  return { kind: 'stamp', string: `${base} ${token}` };
}

function nativeTransition(before, after) {
  if (!oneStatus(before) || !oneStatus(after) || normalizedStatus(before) !== normalizedStatus(after)) return null;
  if (status(before) === 'TODO' && status(after) === 'DONE') return 'complete';
  if (status(before) === 'DONE' && status(after) === 'TODO') return 'reopen';
  return null;
}

function withReceipt(receipts, receipt) {
  const prior = (receipts?.items || []).filter((item) => !(item.uid === receipt.uid && item.graph === receipt.graph
    && item.graphType === receipt.graphType && item.userUid === receipt.userUid));
  // Recency is operation order, not wall-clock order (the system clock can move).
  const items = [receipt, ...prior].slice(0, MAX_RECEIPTS);
  const value = { v: RECEIPT_VERSION, items };
  return parseReceipts(value).ok ? value : null;
}

function withoutReceipt(receipts, uid, context = null) {
  return { v: RECEIPT_VERSION, items: (receipts?.items || []).filter((item) => !(item.uid === uid && (!context
    || (item.graph === context.graph && item.graphType === context.graphType && item.userUid === context.userUid)))) };
}

module.exports = {
  MAX_RECEIPTS,
  MAX_RECEIPT_BYTES,
  RECEIPT_VERSION,
  completionMutation,
  doneMarkerString,
  hasCompletionField,
  nativeUid,
  oneStatus,
  normalizedStatus,
  nativeTransition,
  normalizedReceiptBody,
  parseReceipts,
  receiptFor,
  receiptMatches,
  status,
  tailToken,
  tokenFor,
  todoMarkerString,
  withReceipt,
  withoutReceipt,
};
