const { REVISION, RELEASED_RENDERER_SOURCES, rendererSourceRevision } = require('./renderer-contract');

/** Approve an exact published predecessor, never arbitrary graph code. The
 * caller still owns graph scope, ancestry, editor, receipt and write checks. */
async function prepareRendererSourceChange({ before, expected, hash,
  revision = REVISION, releasedSources = RELEASED_RENDERER_SOURCES } = {}) {
  if (!Number.isSafeInteger(revision) || revision < 1 || typeof expected !== 'string'
    || rendererSourceRevision(expected) !== revision || typeof hash !== 'function') {
    throw Error('The bundled renderer source contract is invalid.');
  }
  if (before === expected) return { changed: false, string: expected };
  const previous = rendererSourceRevision(before);
  if (!previous || previous >= revision) {
    throw Error('Only a verified older renderer source can be upgraded; custom or newer code was preserved.');
  }
  const candidates = releasedSources.filter(source => source.revision === previous);
  if (!candidates.length || !candidates.some(source => /^[a-f0-9]{64}$/.test(source.sha256))) {
    throw Error('This renderer source is not a registered published predecessor.');
  }
  const actual = await hash(before);
  if (!candidates.some(source => source.sha256 === actual)) {
    throw Error('The older renderer source differs from its published hash. Existing code was preserved.');
  }
  return { changed: true, string: expected };
}

module.exports = { prepareRendererSourceChange };
