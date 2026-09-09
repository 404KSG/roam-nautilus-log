import cljsFile from "./component.cljs";

const RENDER_PAGE = "roam/render";
const TEMPLATE_MARKER = "[[roam/templates]]";
const CURRENT_TEMPLATE_NAME = `Nautilus Log ${TEMPLATE_MARKER}`;
const RETIRED_TEMPLATE_NAME = "Nautilus Log · Previous template";
const LEGACY_TEMPLATE_NAMES = new Set([
  `Nautilus Flow ${TEMPLATE_MARKER}`,
  `Nautilus Enhanced ${TEMPLATE_MARKER}`,
]);
const TEMPLATE_GENERATION_PRIORITY = new Map([
  [CURRENT_TEMPLATE_NAME, 30],
  [`Nautilus Flow ${TEMPLATE_MARKER}`, 20],
  [`Nautilus Enhanced ${TEMPLATE_MARKER}`, 10],
]);
const CURRENT_CODE_BLOCK_UID = "roam-render-Nautilus-Log-cljs";
const LEGACY_CODE_BLOCK_UIDS = [
  "roam-render-Nautilus-Flow-cljs",
  "roam-render-Nautilus-cljs",
];
const LEGACY_RENDER_STRING_CORES = LEGACY_CODE_BLOCK_UIDS.map(
  (uid) => `{{[[roam/render]]:((${uid}))`,
);

const SUPPRESSED_RENDER_CONTEXT_SELECTOR = [
  ".rm-zoom-path",
  ".rm-breadcrumbs",
  '[data-testid="breadcrumbs"]',
  ".parent-path-wrapper",
  ".rm-zoom.zoom-path-view",
  ".rm-zoom-item-content.rm-zoom-collapsed-item",
].join(", ");

const RIGHT_SIDEBAR_RENDER_CONTEXT_SELECTOR = [
  "#roam-right-sidebar-content",
  ".roam-right-sidebar-content",
  '[data-testid="right-sidebar"]',
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

export function isRightSidebarRenderContext(node) {
  try {
    return Boolean(
      node
      && typeof node.closest === "function"
      && node.closest(RIGHT_SIDEBAR_RENDER_CONTEXT_SELECTOR),
    );
  } catch (_error) {
    return false;
  }
}

function api() {
  return typeof window !== "undefined" ? window.roamAlphaAPI : undefined;
}

function blockByUid(uid) {
  const roam = api();
  if (!roam || !uid) return null;
  return roam.data?.pull?.("[*]", [":block/uid", uid]) || null;
}

function queryBlock(uid) {
  const roam = api();
  if (!roam || !uid) return null;
  return roam.q?.(`[:find (pull ?e [:block/uid :block/string :block/order :block/open :block/heading :block/text-align :block/children-view-type]) :where [?e :block/uid "${uid}"]]`)?.[0]?.[0] || null;
}

const CLONE_PROPERTIES = ['open', 'heading', 'text-align', 'children-view-type'];

function cloneProperties(block) {
  const result = {};
  for (const key of CLONE_PROPERTIES) {
    const value = block?.[key] ?? block?.[`:${key}`] ?? block?.[`block/${key}`]
      ?? block?.[`:block/${key}`];
    if (value !== undefined && value !== null) result[key] = value;
  }
  // Roam may omit the false-valued attribute from a Pull; creation has the
  // same false default, so normalize it for a stable verified clone shape.
  if (result.open === undefined) result.open = false;
  return result;
}

function snapshotNode(block, children) {
  if (!block || typeof block.uid !== 'string' || !block.uid || typeof block.string !== 'string') {
    throw new Error('Roam returned unreadable template content.');
  }
  return { uid: block.uid, string: block.string, properties: cloneProperties(block), children };
}

function snapshotTree(root, strict = true) {
  const visit = (block, seen = new Set()) => {
    if (seen.has(block?.uid)) throw new Error('Roam returned a cyclic template tree.');
    const nextSeen = new Set(seen).add(block.uid);
    const children = childBlocks(block.uid, strict).map((child) => visit(child, nextSeen));
    return snapshotNode(block, children);
  };
  return visit(root);
}

function fingerprintTree(node) {
  return JSON.stringify({
    uid: node.uid, string: node.string, properties: node.properties,
    children: node.children.map(fingerprintTree),
  });
}

function getPageUidByPageTitle(title) {
  const roam = api();
  if (!roam?.q) return null;
  return roam.q(
    `[:find (pull ?e [:block/uid]) :where [?e :node/title "${title}"]]`,
  )?.[0]?.[0]?.uid || null;
}

function getBlockContentStringByUID(uid) {
  return queryBlock(uid)?.string || null;
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
  return templateQueryRows(roam.q(`[:find (pull ?child [:block/uid :block/string :block/order :block/open :block/heading :block/text-align :block/children-view-type])
                 :where [?parent :block/uid "${parentUid}"]
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
  return [...new Set([renderStringCore, ...LEGACY_RENDER_STRING_CORES].filter(Boolean))];
}

function parseTemplateSettings(string, renderStringCores) {
  const source = String(string || "");
  const renderStringCore = renderStringCores.find((core) => source.includes(core));
  if (!renderStringCore) return null;

  const coreIndex = source.indexOf(renderStringCore);
  const prefix = source.slice(0, coreIndex).trim();
  const tail = source.slice(coreIndex + renderStringCore.length);
  const closingIndex = tail.lastIndexOf("}}");
  if (closingIndex < 0) return null;

  const tokens = tail.slice(0, closingIndex).trim().match(/"(?:\\.|[^"])*"|\S+/g) || [];
  const settings = { "prefix-str": prefix };
  const numericKeys = ["desc-length", "todo-duration", "workday-start"];
  numericKeys.forEach((key, index) => {
    const value = Number(tokens[index]);
    if (Number.isFinite(value)) settings[key] = value;
  });
  if (tokens.length >= 4) {
    settings["color-1-trigger"] = tokens[3].replace(/^"|"$/g, "");
  }
  const workdayEnd = Number(tokens[4]);
  if (Number.isFinite(workdayEnd)) settings["workday-end"] = workdayEnd;

  return { renderStringCore, settings, unsupported: tokens.length > 5 };
}

function managedTemplateCandidates(renderStringCore, strict = false) {
  const renderStringCores = managedRenderCores(renderStringCore);
  return pageBlocksContaining(TEMPLATE_MARKER, strict)
    .map((template, index) => {
      const knownTemplate = template.string === CURRENT_TEMPLATE_NAME
        || LEGACY_TEMPLATE_NAMES.has(template.string);
      if (!knownTemplate) return null;
      const renderBlock = childBlocks(template.uid, strict).find((child) => (
        renderStringCores.some((core) => child.string?.includes(core))
      ));
      const parsed = renderBlock
        ? parseTemplateSettings(renderBlock.string, renderStringCores)
        : null;
      return { template, renderBlock, parsed, index };
    })
    .filter(Boolean);
}

function templateCandidateScore(candidate, renderStringCore) {
  const prefix = candidate.parsed?.settings?.["prefix-str"];
  const customPrefix = typeof prefix === "string" && prefix !== "[[Nautilus Log]]";
  return (customPrefix ? 1000 : 0)
    + (Object.keys(candidate.parsed?.settings || {}).length > 1 ? 100 : 0)
    + (TEMPLATE_GENERATION_PRIORITY.get(candidate.template.string) || 0)
    + (candidate.parsed?.renderStringCore === renderStringCore ? 5 : 0);
}

function preferredTemplateCandidate(candidates, renderStringCore) {
  return [...candidates].sort((left, right) => (
    templateCandidateScore(right, renderStringCore)
      - templateCandidateScore(left, renderStringCore)
    || String(left.template.uid).localeCompare(String(right.template.uid))
    || left.index - right.index
  ))[0] || null;
}

export function readExistingTemplateState(renderStringCore) {
  const candidate = preferredTemplateCandidate(
    managedTemplateCandidates(renderStringCore),
    renderStringCore,
  );
  if (!candidate?.parsed) return null;
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
  if (candidates.length !== 1) return { kind: 'unsupported', reason: 'multipleTemplates' };
  const candidate = candidates[0];
  const unsupported = (reason) => ({ kind: 'unsupported', reason, templateUid: candidate.template.uid });
  if (!candidate.renderBlock || !candidate.parsed || candidate.parsed.unsupported) {
    return unsupported('unsupportedRenderer');
  }
  const source = candidate.renderBlock.string || '';
  const renderStringCores = managedRenderCores(renderStringCore);
  const coreCount = renderStringCores.reduce((count, core) => count + source.split(core).length - 1, 0);
  if (source.slice(source.lastIndexOf('}}') + 2).trim() || coreCount !== 1) {
    return unsupported('unsupportedRenderer');
  }
  const siblings = childBlocks(candidate.template.uid, true);
  if (siblings.length !== 1 || siblings[0].uid !== candidate.renderBlock.uid) {
    return unsupported('extraTemplateSiblings');
  }
  const root = snapshotTree(candidate.renderBlock, true);
  return {
    kind: 'standard', root, templateUid: candidate.template.uid,
    fingerprint: fingerprintTree(root),
  };
}

export function inspectCanonicalTemplate(renderStringCore) {
  const snapshot = freezeCanonicalTemplate(renderStringCore);
  return snapshot.kind === 'unsupported'
    ? { kind: 'custom', reason: snapshot.reason }
    : { kind: snapshot.kind, reason: snapshot.reason };
}

/** Read a block and all descendants using the same conservative clone shape. */
export function readBlockTree(uid) {
  const root = queryBlock(uid);
  return root ? snapshotTree(root, true) : null;
}

export function templateTreeFingerprint(tree) {
  return tree ? fingerprintTree(tree) : null;
}

async function updateBlockIfChanged(uid, string) {
  const roam = api();
  if (!roam?.updateBlock || !uid || getBlockContentStringByUID(uid) === string) return false;
  await roam.updateBlock({ block: { uid, string } });
  return true;
}

function renderBlockString(renderStringCore, templateString) {
  return templateString || `${renderStringCore}}}`;
}

/**
 * Creates or repairs only the three known Nautilus scaffold generations on
 * roam/render. It never scans or rewrites historical Daily Note blocks.
 */
export async function createRenderBlock(
  renderPageName,
  titleblockUID,
  version,
  codeBlockUID,
  componentName,
  templateString,
  renderStringCore,
) {
  const roam = api();
  if (!roam) return false;
  const renderPageUID = getPageUidByPageTitle(renderPageName) || await createPage(renderPageName);
  if (!renderPageUID) return false;

  const existingTitle = blockByUid(titleblockUID);
  if (!existingTitle) {
    await createBlock(renderPageUID, "last", componentName, titleblockUID, { heading: 3 });
  }

  const children = childBlocks(titleblockUID);
  const templateCandidates = managedTemplateCandidates(renderStringCore);
  const canonicalTemplate = preferredTemplateCandidate(templateCandidates, renderStringCore);
  let templateBlock = canonicalTemplate?.template
    || children.find((child) => child.string === CURRENT_TEMPLATE_NAME);
  if (!templateBlock) {
    const templateBlockUID = roam.util.generateUID();
    await createBlock(titleblockUID, 0, CURRENT_TEMPLATE_NAME, templateBlockUID);
    templateBlock = { uid: templateBlockUID };
  } else {
    await updateBlockIfChanged(templateBlock.uid, CURRENT_TEMPLATE_NAME);
  }

  // Keep old scaffold blocks for audit and rollback, but remove their template
  // marker so Roam exposes exactly one Nautilus Log entry in the template menu.
  await Promise.all(
    templateCandidates
      .filter((candidate) => candidate.template.uid !== templateBlock.uid)
      .map((candidate) => updateBlockIfChanged(
        candidate.template.uid,
        RETIRED_TEMPLATE_NAME,
      )),
  );

  const templateChildren = childBlocks(templateBlock.uid);
  const renderStringCores = managedRenderCores(renderStringCore);
  const renderBlock = templateChildren.find((child) => (
    renderStringCores.some((core) => child.string?.includes(core))
  ));
  if (!renderBlock) {
    const renderBlockUID = roam.util.generateUID();
    await createBlock(templateBlock.uid, 0, renderBlockString(renderStringCore, templateString), renderBlockUID);
  } else {
    await updateBlockIfChanged(renderBlock.uid, renderBlockString(renderStringCore, templateString));
  }

  const blockString = `\`\`\`clojure\n ${cljsFile} \`\`\``;
  if (!blockByUid(codeBlockUID)) {
    const codeHeader = children.find((child) => child.string === "code");
    let codeHeaderUID = codeHeader?.uid;
    if (!codeHeaderUID) {
      codeHeaderUID = roam.util.generateUID();
      await createBlock(titleblockUID, "last", "code", codeHeaderUID, { open: false });
    }
    await createBlock(codeHeaderUID, 0, blockString, codeBlockUID);
  }

  // Keep every already-existing renderer identity current. This preserves old
  // Daily Note blocks without a graph-wide string migration or duplicate data.
  const managedCodeBlockUIDs = [...new Set([
    codeBlockUID,
    CURRENT_CODE_BLOCK_UID,
    ...LEGACY_CODE_BLOCK_UIDS,
  ])];
  await Promise.all(
    managedCodeBlockUIDs
      .filter((uid) => blockByUid(uid))
      .map((uid) => updateBlockIfChanged(uid, blockString)),
  );
  return true;
}

export async function updateTemplateString(renderString, renderStringWithSettings) {
  const roam = api();
  if (!roam?.q) return 0;
  const canonicalTemplate = preferredTemplateCandidate(
    managedTemplateCandidates(renderString),
    renderString,
  );
  const renderBlock = canonicalTemplate?.renderBlock;
  if (!renderBlock || renderBlock.string === renderStringWithSettings) return 0;
  await roam.updateBlock({
    block: { uid: renderBlock.uid, string: renderStringWithSettings },
  });
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
  );
}

export { getBlockContentStringByUID, queryBlock, CLONE_PROPERTIES };
