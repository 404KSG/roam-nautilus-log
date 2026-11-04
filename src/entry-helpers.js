import cljsFile from "./component.cljs";
import { isRightSidebarRenderContext } from "./render-context.js";
import { REVISION as RENDERER_REVISION, CODE_UID as CURRENT_CODE_BLOCK_UID,
  LEGACY_UIDS as LEGACY_CODE_BLOCK_UIDS, rendererIdentity, inspectRenderer,
  inspectRendererSource, maskCode } from './renderer-contract';
export { isRightSidebarRenderContext, RENDERER_REVISION, CURRENT_CODE_BLOCK_UID, LEGACY_CODE_BLOCK_UIDS, rendererIdentity };

const RENDER_PAGE = "roam/render";
const RENDER_TITLE_UID = 'roam-render-Nautilus-Log';
const RENDER_TITLE = 'Nautilus Log';
// Stable scaffold identities, independent of renderer revisions. These existing
// UID strings are opaque identities; retain them when a future code UID changes.
const CODE_HEADER_UID = 'roam-render-Nautilus-Log-r2-cljs-header';
const TEMPLATE_UID = 'nautilus-log-r2-template';
const TEMPLATE_RENDER_UID = 'nautilus-log-r2-template-render';
const TEMPLATE_MARKER = "[[roam/templates]]";
const CURRENT_TEMPLATE_NAME = `Nautilus Log ${TEMPLATE_MARKER}`;
const LEGACY_TEMPLATE_NAMES = new Set([
  `Nautilus Flow ${TEMPLATE_MARKER}`,
  `Nautilus Enhanced ${TEMPLATE_MARKER}`,
]);
const LEGACY_RENDER_STRING_CORES = LEGACY_CODE_BLOCK_UIDS.map(uid => `{{[[roam/render]]:((${uid}))`);
const rendererInvocation = string => inspectRenderer(string).invocation;

const SUPPRESSED_RENDER_CONTEXT_SELECTOR = [
  ".rm-zoom-path",
  ".rm-breadcrumbs",
  '[data-testid="breadcrumbs"]',
  ".parent-path-wrapper",
  ".rm-zoom.zoom-path-view",
  ".rm-zoom-item-content.rm-zoom-collapsed-item",
].join(", ");

export function shouldSuppressRenderContext(node) {
  try {
    return Boolean(
      node
      && typeof node.closest === "function"
      && node.closest(SUPPRESSED_RENDER_CONTEXT_SELECTOR),
    );
  } catch (_error) {
    return false;
  }
}

function api() {
  return typeof window !== "undefined" ? window.roamAlphaAPI : undefined;
}

function blockByUid(uid, strict = false) {
  const roam = api(), pull = roam?.data?.pull || roam?.pull;
  if (typeof pull !== 'function' || !uid) {
    if (strict) throw Error('Roam block inspection is unavailable.');
    return null;
  }
  const value = pull.call(pull === roam.data?.pull ? roam.data : roam, '[*]', [':block/uid', uid]);
  if (value == null) return null;
  const block = normalizeBlock(value);
  if (!block || typeof block !== 'object' || block.uid !== uid || typeof block.string !== 'string') {
    if (strict) throw Error('Roam returned unreadable renderer content.');
    return null;
  }
  return block;
}

let rendererSourceCache;
export const rendererSourceText = () => rendererSourceCache ??= `\`\`\`clojure\n ${cljsFile} \`\`\``;
export function readOwnedRendererSourceText() {
  const { source } = readFixedRendererScaffold();
  return source?.string ?? null;
}
export function readRendererSource() {
  return inspectRendererSource(readOwnedRendererSourceText(), rendererSourceText());
}

// A matching source body alone cannot grant ownership of user structure.
// Partial owned scaffolds are resumable; existing children of missing or
// foreign parents are collisions, never permission to adopt those parents.
function assertScaffoldOwner(block, parentUid, expectedString) {
  if (!block) return;
  if (!parentUid || (expectedString !== undefined && block.string !== expectedString)) {
    throw Error(`Renderer scaffold UID ownership is unverified: ${block.uid}`);
  }
  const matches = childBlocks(parentUid, true).filter(child => child.uid === block.uid);
  if (matches.length !== 1 || matches[0].string !== block.string) {
    throw Error(`Renderer scaffold UID has a different parent or content: ${block.uid}`);
  }
}

function readFixedRendererScaffold() {
  const pageUid = getPageUidByPageTitle(RENDER_PAGE, true);
  const title = blockByUid(RENDER_TITLE_UID, true);
  const header = blockByUid(CODE_HEADER_UID, true);
  const source = blockByUid(CURRENT_CODE_BLOCK_UID, true);
  assertScaffoldOwner(title, pageUid, RENDER_TITLE);
  assertScaffoldOwner(header, title?.uid, 'code');
  assertScaffoldOwner(source, header?.uid);
  return { pageUid, title, header, source };
}

function queryBlock(uid, strict = false) {
  const roam = api();
  if (!roam || !uid) return null;
  const rows = templateQueryRows(roam.q?.(`[:find (pull ?e [*]) :where [?e :block/uid ${JSON.stringify(uid)}]]`), strict);
  if (strict && rows.length > 1) throw new Error('Roam returned duplicate block results.');
  return rows[0]?.[0] || null;
}

const CLONE_PROPERTIES = ['open', 'heading', 'text-align', 'children-view-type'];

// Wildcard Pull detects fields that an allowlist-only Pull would silently lose.
// Native :children/view-type maps to the mutation field children-view-type.
function normalizeBlock(block) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return block;
  const result = {};
  for (const [raw, value] of Object.entries(block)) {
    const native = raw.replace(/^:/, '');
    const key = ['children/view-type', 'view-type'].includes(native)
      ? 'children-view-type' : native.replace(/^block\//, '');
    if (key in result && JSON.stringify(result[key]) !== JSON.stringify(value)) throw new Error(`Conflicting property: ${raw}`);
    result[key] = value;
  }
  return result;
}
// Roam's query serialization can drop non-block keyword namespaces too:
// create/edit attribution becomes time/user, and viewing activity is seen-by.
// These are host-managed metadata, not template formatting to clone.
const READ_METADATA = new Set(['db/id', 'id', 'page', 'parents', 'children', 'refs', '_children', 'parentUid',
  'create/time', 'create/user', 'edit/time', 'edit/user', 'edit/seen-by',
  'time', 'user', 'seen-by', 'uid', 'string', 'order']);
function cloneProperties(block) {
  for (const key of Object.keys(block)) {
    if (!CLONE_PROPERTIES.includes(key) && !READ_METADATA.has(key)) throw new Error(`Cannot preserve property "${key}" on block ${block.uid}.`);
  }
  const result = { open: true, heading: 0, 'text-align': 'left', 'children-view-type': 'bullet' };
  for (const key of CLONE_PROPERTIES) {
    if (block[key] !== undefined && block[key] !== null) result[key] = block[key];
  }
  if (typeof result.open !== 'boolean' || ![0,1,2,3].includes(result.heading)
    || !['left','center','right','justify'].includes(result['text-align'])
    || !['bullet','numbered','document'].includes(result['children-view-type'])) throw new Error(`Invalid presentation properties on block ${block.uid}.`);
  return result;
}
function snapshotTree(root, strict = true) {
  const seen = new Set();
  let textUnits = 0;
  const visit = (block, depth = 0) => {
    if (seen.has(block.uid)) throw new Error(`Duplicate UID or cycle in template: ${block.uid}.`);
    seen.add(block.uid);
    textUnits += block.string.length;
    if (seen.size > 2000 || depth > 64 || textUnits > 1000000) throw new Error('Template exceeds safety bounds (2000 blocks, 64 levels, 1000000 text code units).');
    const children = childBlocks(block.uid, strict);
    if (children.some((child, index) => child.order !== index)) throw new Error(`Invalid child order under ${block.uid}.`);
    return Object.freeze({ uid: block.uid, string: block.string, order: block.order,
      properties: Object.freeze(cloneProperties(block)), children: Object.freeze(children.map(child => visit(child, depth + 1))) });
  };
  return visit(root);
}
function fingerprintTree(node) {
  // Serialize the object once, not recursively escaped JSON strings.
  return JSON.stringify(node);
}

function getPageUidByPageTitle(title, strict = false) {
  const roam = api();
  if (typeof roam?.q !== 'function') {
    if (strict) throw Error('Roam renderer page inspection is unavailable.');
    return null;
  }
  const rows = roam.q(`[:find (pull ?e [:block/uid]) :where [?e :node/title ${JSON.stringify(title)}]]`);
  if (strict && (!Array.isArray(rows) || rows.length > 1 || rows.some(row => !Array.isArray(row) || row.length !== 1
    || typeof normalizeBlock(row[0])?.uid !== 'string' || !normalizeBlock(row[0]).uid))) {
    throw Error('Roam returned unreadable renderer page ownership.');
  }
  return normalizeBlock(rows?.[0]?.[0])?.uid || null;
}

function getBlockContentStringByUID(uid) {
  return queryBlock(uid)?.string ?? null;
}

async function createPage(title) {
  const roam = api();
  const uid = roam?.util?.generateUID?.();
  if (!roam || !uid) return null;
  await roam.data.page.create({ page: { title, uid } });
  return uid;
}

async function createBlock(parentUid, order, string, uid, extra = {}) {
  const roam = api();
  if (!roam?.createBlock || !parentUid || !uid) return null;
  await roam.createBlock({
    location: { "parent-uid": parentUid, order },
    block: { string, uid, open: true, ...extra },
  });
  return uid;
}

function templateQueryRows(rows, strict) {
  if (strict && Array.isArray(rows) && rows.length > 2000) throw new Error('Template query exceeds the 2000-block safety bound.');
  if (Array.isArray(rows)) rows = rows.map(row => Array.isArray(row) ? row.map(normalizeBlock) : row);
  if (strict && (!Array.isArray(rows) || rows.some((row) => (
    !Array.isArray(row) || row.length !== 1
    || typeof row[0]?.uid !== 'string' || !row[0].uid
    || typeof row[0].string !== 'string'
  )))) throw new Error('Roam returned unreadable template content.');
  return rows || [];
}

function childBlocks(parentUid, strict = false) {
  const roam = api();
  if (!roam?.q || !parentUid) return [];
  return templateQueryRows(roam.q(`[:find (pull ?child ${strict ? '[*]' : '[:block/uid :block/string :block/order]'})
                 :where [?parent :block/uid ${JSON.stringify(parentUid)}]
                        [?parent :block/children ?child]]`), strict)
    .map((row) => row?.[0])
    .filter(Boolean)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function pageBlocksContaining(searchString, strict = false) {
  const roam = api();
  if (!roam?.q || !searchString) return [];
  const query = `[:find (pull ?node [:block/string :block/uid :block/order])
                 :where [?page :node/title "${RENDER_PAGE}"]
                        [?node :block/page ?page]
                        [?node :block/string ?node-string]
                        [(clojure.string/includes? ?node-string "${searchString}")]]`;
  return templateQueryRows(roam.q(query), strict).map((row) => row?.[0]).filter(Boolean);
}

function managedRenderCores(renderStringCore) {
  // rN is recognized for discovery and deduplication even when this bundle
  // cannot own it.  Never turn that recognition into permission to rewrite it.
  return [...new Set([renderStringCore, ...LEGACY_RENDER_STRING_CORES].filter(Boolean))];
}

function parseTemplateSettings(string, _renderStringCores) {
  const source = String(string || ''), info = inspectRenderer(source), item = info.invocation;
  if (!item) return null;
  const settings = { 'prefix-str': source.slice(0, item.start).trim() };
  const keys = ['desc-length','todo-duration','workday-start','color-1-trigger','workday-end'];
  (item.args || []).forEach((value, index) => { settings[keys[index]] = value; });
  return { renderStringCore: source.slice(item.start, item.uidEnd + 2), settings,
    unsupported: !item.supportedArgs || !['current','legacy'].includes(info.kind), identity: info.identity || item.identity };
}

function managedTemplateCandidates(renderStringCore, strict = false) {
  const renderStringCores = managedRenderCores(renderStringCore);
  const templates = pageBlocksContaining(TEMPLATE_MARKER, strict);
  const knownName = template => template.string === CURRENT_TEMPLATE_NAME || LEGACY_TEMPLATE_NAMES.has(template.string);
  const owned = new Set();
  if (templates.some(template => !knownName(template))) {
    try {
      const title = blockByUid(RENDER_TITLE_UID, true);
      assertScaffoldOwner(title, getPageUidByPageTitle(RENDER_PAGE, true), RENDER_TITLE);
      if (title) {
        const direct = new Map();
        for (const child of childBlocks(title.uid, true)) {
          // Keep duplicate UID rows ambiguous instead of overwriting them.
          direct.set(child.uid, direct.has(child.uid) ? null : child);
        }
        for (const template of templates) {
          if (knownName(template) || !direct.has(template.uid)) continue;
          const child = direct.get(template.uid);
          if (!child || child.string !== template.string) {
            throw Error('The managed template changed during discovery. No replacement was created.');
          }
          // Location and marker establish the candidate; the renderer/tree
          // checks below still decide whether it may be used or changed.
          if (maskCode(template.string).includes(TEMPLATE_MARKER)) owned.add(template.uid);
        }
      }
    } catch (error) {
      if (strict) throw error;
      // Read-only settings recovery cannot grant ownership after a failed
      // preflight. Strict installation/creation will report that failure.
      owned.clear();
    }
  }
  return templates
    .map((template, index) => {
      const knownTemplate = knownName(template);
      if (!knownTemplate && !owned.has(template.uid)) return null;
      const renderChildren = childBlocks(template.uid, strict).filter(child => inspectRenderer(child.string).recognized);
      const renderBlock = renderChildren.length === 1 ? renderChildren[0] : null;
      const parsed = renderBlock
        ? parseTemplateSettings(renderBlock.string, [
          `{{[[roam/render]]:((${rendererInvocation(renderBlock.string)?.uid}))`,
          ...renderStringCores,
        ])
        : null;
      return { template, renderBlock, parsed, index, knownTemplate };
    })
    .filter(Boolean);
}

// Presentation identity only: do not copy, filter, or rewrite its descendants.
// Use the same strict candidate discovery as template creation and reuse.
export function readManagedTemplateView(renderStringCore) {
  const candidates = managedTemplateCandidates(renderStringCore, true);
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];
  return { templateUid: candidate.template.uid,
    renderUid: candidate.renderBlock && inspectRenderer(candidate.renderBlock.string).kind === 'current'
      ? candidate.renderBlock.uid : null };
}

export function readExistingTemplateState(renderStringCore) {
  const candidates = managedTemplateCandidates(renderStringCore);
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];
  if (!candidate?.parsed || candidate.parsed.unsupported) return null;
  return {
    renderStringCore: candidate.parsed.renderStringCore,
    settings: { ...candidate.parsed.settings },
  };
}

/**
 * Freeze the one managed renderer root and its complete ordinary block tree.
 * A renderer root may have arbitrary normal descendants; only ambiguous roots,
 * top-level siblings, or unreadable/dynamic render strings are refused.
 */
export function freezeCanonicalTemplate(renderStringCore) {
  if (typeof api()?.q !== 'function') {
    throw Object.assign(new Error('Roam template inspection is unavailable.'), { code: 'apiUnavailable' });
  }
  const candidates = managedTemplateCandidates(renderStringCore, true);
  if (candidates.length === 0) return { kind: 'missing' };
  if (candidates.length !== 1) return { kind: 'unsupported', reason: 'Multiple managed templates were found; keep exactly one.', templateUid: getPageUidByPageTitle(RENDER_PAGE) || candidates[0].template.uid };
  const candidate = candidates[0];
  const unsupported = (reason) => ({ kind: 'unsupported', reason, templateUid: candidate.template.uid });
  if (!candidate.renderBlock || !candidate.parsed || candidate.parsed.unsupported) {
    return unsupported('The template needs one supported managed renderer without extra arguments.');
  }
  const source = candidate.renderBlock.string || '';
  const identity = inspectRenderer(source);
  if (identity.kind !== 'current' || !identity.mutable) return unsupported('Upgrade this managed template to the current renderer before creating a plan.');
  if (source.slice(identity.invocation.end).trim()) {
    return unsupported('The template must contain exactly one renderer and no trailing content.');
  }
  const siblings = childBlocks(candidate.template.uid, true);
  if (siblings.length !== 1 || siblings[0].uid !== candidate.renderBlock.uid) {
    return unsupported('Extra top-level template siblings are not supported; put ordinary content under the renderer.');
  }
  if (siblings[0].order !== 0) return unsupported('The renderer has invalid order under its template.');
  let root;
  try { root = snapshotTree(candidate.renderBlock, true); }
  catch (error) { return unsupported(error.message); }
  const scan = (node) => {
    if (node !== root && /\{\{\s*(?:\[\[)?roam\/render/i.test(node.string)) return 'A second renderer in the template is not supported.';
    if (/^\s*:?LOGBOOK:{1,2}\s*$/i.test(node.string) || /^\s*:?CLOCK:{1,2}\s*\[/im.test(node.string)) return 'LOGBOOK/CLOCK history cannot be copied as a fresh plan.';
    for (const child of node.children) { const reason = scan(child); if (reason) return reason; }
    return null;
  };
  const reason = scan(root);
  if (reason) return unsupported(reason);
  return {
    kind: 'standard', root, templateUid: candidate.template.uid,
    fingerprint: fingerprintTree(root),
  };
}

export function inspectCanonicalTemplate(renderStringCore) {
  const snapshot = freezeCanonicalTemplate(renderStringCore);
  return snapshot.kind === 'unsupported'
    ? { kind: 'custom', reason: snapshot.reason, templateUid: snapshot.templateUid }
    : { kind: snapshot.kind, reason: snapshot.reason, templateUid: snapshot.templateUid };
}

/** Read a block and all descendants using the same conservative clone shape. */
export function readBlockTree(uid) {
  const root = queryBlock(uid, true);
  return root ? snapshotTree(root, true) : null;
}

export function templateTreeFingerprint(tree) {
  return tree ? fingerprintTree(tree) : null;
}

function renderBlockString(renderStringCore, templateString) {
  return templateString || `${renderStringCore}}}`;
}

/** Read before installing anything; a newer/custom template is never replaced. */
export function inspectRendererScaffold(renderStringCore) {
  if (typeof api()?.q !== 'function') throw Error('Roam template inspection is unavailable.');
  const code = readRendererSource();
  if (!['absent','current','older'].includes(code.state)) throw Error(code.state === 'newer'
    ? 'This window’s extension is older than the renderer. Update this client.'
    : 'The renderer code differs from this revision. Existing content was preserved.');
  const candidates = managedTemplateCandidates(renderStringCore, true);
  if (candidates.length > 1) throw Error('Multiple managed templates were found. Keep one template before upgrading.');
  const candidate = candidates[0] || null;
  if (candidate) {
    const children = childBlocks(candidate.template.uid, true);
    // Only a known empty seed may be completed. An empty renamed/unknown
    // marker under our title is existing user structure, not a fresh slot.
    if ((children.length || !candidate.knownTemplate) && (children.length !== 1 || !candidate.renderBlock || candidate.parsed?.unsupported
      || !inspectRenderer(candidate.renderBlock.string).mutable
      || candidate.renderBlock.string.slice(rendererInvocation(candidate.renderBlock.string).end).trim())) {
      const renderers = children.filter(child => inspectRenderer(child.string).recognized);
      if (renderers.length > 1) {
        throw Object.assign(new Error(`The managed template has ${renderers.length} renderer blocks. Keep one root; check unused references before removing them, then reload. Contents were preserved.`),
          { code: 'templateMultipleRenderers', templateUid: candidate.template.uid });
      }
      throw Error('The managed template is newer, custom, or ambiguous. Its contents were preserved.');
    }
  }
  // Check reserved slots that this installation would use before creating any
  // missing page/header/source. Unused slots do not claim unrelated blocks.
  if (!candidate && blockByUid(TEMPLATE_UID, true)) throw Error('The new template scaffold UID is already in use.');
  if (!candidate?.renderBlock && blockByUid(TEMPLATE_RENDER_UID, true)) throw Error('The new render-reference scaffold UID is already in use.');
  return { code, candidate };
}

/** Keep one canonical source block, then seed or narrowly migrate the template.
 * Older source bytes require a separately verified forward-upgrade receipt. */
export async function createRenderBlock(
  renderPageName, titleblockUID, version, codeBlockUID, componentName,
  templateString, renderStringCore, options = {},
) {
  const roam = api();
  if (!roam) return false;
  if (codeBlockUID !== CURRENT_CODE_BLOCK_UID || renderPageName !== RENDER_PAGE
    || titleblockUID !== RENDER_TITLE_UID || componentName !== RENDER_TITLE) throw Error('Only the current renderer scaffold may be installed.');
  const initial = inspectRendererScaffold(renderStringCore);
  if (initial.code.state === 'absent' && options.hasPendingSource?.()) {
    throw Error('A canonical source update is unresolved; its missing block was not recreated.');
  }
  let renderPageUID = getPageUidByPageTitle(renderPageName, true);
  const assertScope = () => {
    if (api() !== roam) throw Error('The graph provider changed while installing the renderer.');
    options.assertActive?.();
  };
  const assertActive = () => {
    assertScope();
    inspectRendererScaffold(renderStringCore);
    if (renderPageUID && getPageUidByPageTitle(renderPageName, true) !== renderPageUID) {
      throw Error('Renderer scaffold ownership changed while installing.');
    }
    assertScope();
  };
  const createVerified = async (parentUid, order, string, uid, extra = {}) => {
    assertActive();
    const existing = blockByUid(uid, true);
    if (existing) {
      if (existing.string !== string || !childBlocks(parentUid, true).some(child => child.uid === uid)) throw Error('A renderer scaffold UID is already in use.');
      return uid;
    }
    let error;
    try { await createBlock(parentUid, order, string, uid, extra); } catch (failure) { error = failure; }
    assertActive();
    if (blockByUid(uid, true)?.string !== string || !childBlocks(parentUid, true).some(child => child.uid === uid)) throw error || Error('Renderer scaffold creation could not be confirmed.');
    return uid;
  };
  if (!renderPageUID) { assertActive(); renderPageUID = await createPage(renderPageName); assertActive(); }
  if (!renderPageUID) throw Error('The renderer page could not be confirmed.');
  await createVerified(renderPageUID, 'last', componentName, titleblockUID, { heading: 3 });
  if (initial.code.state === 'absent') {
    await createVerified(titleblockUID, 'last', 'code', CODE_HEADER_UID, { open: false });
    await createVerified(CODE_HEADER_UID, 0, rendererSourceText(), codeBlockUID);
  }
  if (initial.code.state === 'older' || typeof options.ensureSource === 'function') {
    if (typeof options.ensureSource !== 'function') throw Error('A verified canonical source upgrade is required.');
    const expected = readOwnedRendererSourceText();
    const result = await options.ensureSource({ expected, isCurrent: () => {
      assertActive();
      return readOwnedRendererSourceText() !== null;
    } });
    assertActive();
    if (!result?.ok) throw Error('The canonical renderer source update is unconfirmed. No replacement code block was created.');
  }
  assertActive();
  if (readRendererSource().state !== 'current') throw Error('The current renderer source could not be verified.');
  const current = inspectRendererScaffold(renderStringCore);
  if ((current.candidate?.template.uid || null) !== (initial.candidate?.template.uid || null)) throw Error('The managed template changed while installing the renderer.');
  let template = current.candidate?.template;
  if (!template) {
    const uid = TEMPLATE_UID;
    await createVerified(titleblockUID, 0, CURRENT_TEMPLATE_NAME, uid);
    template = { uid };
  }
  const children = childBlocks(template.uid, true);
  if (!children.length) {
    const string = renderBlockString(renderStringCore, templateString);
    if (inspectRenderer(string).kind !== 'current' || !inspectRenderer(string).mutable) throw Error('A supported current renderer template is required.');
    await createVerified(template.uid, 0, string, TEMPLATE_RENDER_UID);
    return true;
  }
  if (children.length !== 1) throw Error('The managed template changed before migration.');
  const render = children[0], identity = inspectRenderer(render.string);
  if (identity.kind === 'current' && identity.mutable) return true;
  if (identity.kind !== 'legacy' || !identity.mutable || typeof options.migrateReference !== 'function') {
    throw Error('The legacy template needs verified renderer migration before use.');
  }
  const isCurrent = () => {
    assertActive();
    const candidates = managedTemplateCandidates(renderStringCore, true);
    return candidates.length === 1 && candidates[0].template.uid === template.uid
      && childBlocks(template.uid, true).length === 1 && candidates[0].renderBlock?.uid === render.uid;
  };
  const result = await options.migrateReference({ uid: render.uid, kind: 'template', expected: render.string, isCurrent });
  assertActive();
  if (!result?.ok || inspectRenderer(blockByUid(render.uid, true)?.string).kind !== 'current') throw Error('The template migration is not confirmed. No second template or plan was created.');
  return true;
}

export async function updateTemplateString(renderString, renderStringWithSettings) {
  const roam = api();
  if (!roam?.q) return 0;
  const canonicalTemplate = inspectRendererScaffold(renderString).candidate;
  const renderBlock = canonicalTemplate?.renderBlock;
  if (!renderBlock || renderBlock.string === renderStringWithSettings) return 0;
  if (inspectRenderer(renderBlock.string).kind !== 'current' || inspectRenderer(renderStringWithSettings).kind !== 'current'
    || !inspectRenderer(renderStringWithSettings).mutable) throw Error('Upgrade and verify the managed template before changing its settings.');
  if (blockByUid(renderBlock.uid, true)?.string !== renderBlock.string) throw Error('The template changed before its settings could be updated.');
  await roam.updateBlock({ block: { uid: renderBlock.uid, string: renderStringWithSettings } });
  if (api() !== roam || blockByUid(renderBlock.uid, true)?.string !== renderStringWithSettings) throw Error('The template settings update could not be confirmed.');
  return 1;
}

/**
 * Compatibility entry point used by the extension. `state=false` is a pure
 * no-op: unloading a Depot extension must not delete or rewrite user blocks.
 */
export function toggleRenderComponent(
  state,
  titleblockUID,
  version,
  renderStringCore,
  disabledReplacementString,
  codeBlockUID,
  componentName,
  templateString,
  options = {},
) {
  if (state !== true) return Promise.resolve(false);
  return createRenderBlock(
    RENDER_PAGE,
    titleblockUID,
    version,
    codeBlockUID,
    componentName,
    templateString,
    renderStringCore,
    options,
  );
}

export { getBlockContentStringByUID, queryBlock, CLONE_PROPERTIES };
