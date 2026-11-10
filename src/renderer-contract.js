/* One renderer-family contract shared by discovery, mutation and migration. */
const REVISION = 3;
// One permanent graph entry. The historical "r2" spelling is an opaque UID,
// not a request to create a new block when the source revision advances.
const CODE_UID = 'roam-render-Nautilus-Log-r2-cljs';
const RELEASED_RENDERER_SOURCES = Object.freeze([
  Object.freeze({ revision: 2, sha256: '5abc676245d7078959f19e804a65a355c3323d5e9af4fc1c067c70f3c57af81e' }),
  Object.freeze({ revision: 3, sha256: '814183741f32624e327592cc6c70cdf808ad3d04c10ce7494f6375105a393be5' }),
]);
const NAMESPACE = `nautilus-log-r${REVISION}`;
const BRIDGE_KEY = `nautilusLogR${REVISION}`;
const LEGACY_UIDS = Object.freeze(['roam-render-Nautilus-Log-cljs', 'roam-render-Nautilus-Flow-cljs', 'roam-render-Nautilus-cljs']);
const UID_RE = /^roam-render-Nautilus(?:-Log(?:-r(\d+))?|-Flow)?-cljs$/;
const INVOCATION_RE = /\{\{\s*\[\[roam\/render\]\]\s*:\s*\(\(([A-Za-z0-9_-]+)\)\)/g;

function rendererIdentity(uid) {
  if (typeof uid !== 'string') return { kind: 'unsupported', uid: null, revision: null };
  const match = UID_RE.exec(uid);
  if (!match) return { kind: 'unsupported', uid: null, revision: null };
  const revision = uid === CODE_UID ? REVISION : match[1] ? Number(match[1]) : 1;
  const kind = uid === CODE_UID ? 'current' : LEGACY_UIDS.includes(uid) ? 'legacy'
    : Number.isSafeInteger(revision) && revision > REVISION ? 'newer' : 'unsupported';
  return { kind, uid, revision };
}

function maskCode(string) {
  // Keep offsets in UTF-16 code units, including prefixes containing emoji.
  const result = string.split('');
  let index = 0;
  while (index < string.length) {
    if (string[index] !== '`') { index++; continue; }
    let size = 1;
    while (string[index + size] === '`') size++;
    const marker = '`'.repeat(size), close = string.indexOf(marker, index + size);
    const end = close < 0 ? string.length : close + size;
    for (let i = index; i < end; i++) result[i] = ' ';
    index = end;
  }
  return result.join('');
}

function rendererInvocations(value) {
  if (typeof value !== 'string') return [];
  const masked = maskCode(value), result = [];
  for (const match of masked.matchAll(INVOCATION_RE)) {
    const start = match.index, argsStart = start + match[0].length;
    let quoted = false, escaped = false, end = -1;
    for (let i = argsStart; i < value.length - 1; i++) {
      const char = value[i];
      if (escaped) { escaped = false; continue; }
      if (quoted && char === '\\') { escaped = true; continue; }
      if (char === '"') quoted = !quoted;
      if (!quoted && char === '}' && value[i + 1] === '}') { end = i + 2; break; }
    }
    const rawArgs = end < 0 ? null : value.slice(argsStart, end - 2).trim();
    const tokens = rawArgs === null ? [] : rawArgs.match(/"(?:\\.|[^"\\])*"|[^\s]+/g) || [];
    let args = null;
    if (rawArgs !== null && tokens.length <= 5) {
      try {
        args = tokens.map((token, i) => {
          if (i === 3) {
            if (!/^"(?:\\.|[^"\\])*"$/.test(token)) throw Error('Nonliteral color argument');
            return JSON.parse(token);
          }
          if (!/^[+-]?\d+(?:\.\d+)?$/.test(token)) throw Error('Nonliteral numeric argument');
          const number = Number(token); if (!Number.isFinite(number)) throw Error('Invalid numeric argument');
          return number;
        });
      } catch (_) { args = null; }
    }
    const uidOffset = match[0].lastIndexOf(match[1]);
    result.push({ start, end, uidStart: start + uidOffset, uidEnd: start + uidOffset + match[1].length,
      uid: match[1], identity: rendererIdentity(match[1]), args, supportedArgs: args !== null });
  }
  return result;
}

function inspectRenderer(value) {
  const invocations = rendererInvocations(value);
  const known = invocations.filter(item => item.identity.uid);
  if (known.length === 0) return { recognized: false, kind: 'unsupported', invocation: null };
  if (invocations.length !== 1 || known.length !== 1) return { recognized: true, kind: 'ambiguous', invocation: null };
  const invocation = known[0];
  return { recognized: true, kind: invocation.identity.kind, invocation,
    mutable: invocation.supportedArgs && ['current', 'legacy'].includes(invocation.identity.kind) };
}

function migrateRendererReference(string) {
  const info = inspectRenderer(string);
  if (info.kind === 'current' && info.mutable) return { changed: false, string };
  if (info.kind !== 'legacy' || !info.mutable) throw Error('The renderer reference is ambiguous, newer, or unsupported.');
  const { uidStart, uidEnd } = info.invocation;
  return { changed: true, string: string.slice(0, uidStart) + CODE_UID + string.slice(uidEnd) };
}

function rendererSourceRevision(string) {
  if (typeof string !== 'string') return null;
  const match = /^```clojure\s*\n\s*;; nautilus-renderer ([1-9]\d*)\s*\n/.exec(string);
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}

function inspectRendererSource(string, expected) {
  if (string === null || string === undefined) return { state: 'absent' };
  if (typeof string !== 'string') return { state: 'unreadable' };
  const revision = rendererSourceRevision(string);
  if (revision > REVISION) return { state: 'newer', revision };
  if (revision === REVISION && string === expected) return { state: 'current', revision };
  if (revision < REVISION && RELEASED_RENDERER_SOURCES.some(source => source.revision === revision)) {
    // A candidate only. The installer must verify its published hash and
    // source ownership before any in-place upgrade can be issued.
    return { state: 'older', revision };
  }
  return { state: 'mismatch', revision };
}

module.exports = { REVISION, CODE_UID, NAMESPACE, BRIDGE_KEY, LEGACY_UIDS,
  RELEASED_RENDERER_SOURCES, rendererSourceRevision,
  rendererIdentity, rendererInvocations, inspectRenderer, migrateRendererReference, inspectRendererSource, maskCode };
