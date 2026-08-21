import cljsFile from "./component.cljs";

const RENDER_PAGE = "roam/render";

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
  return roam.q?.(`[:find (pull ?e [:block/uid :block/string :block/order :block/children]) :where [?e :block/uid "${uid}"]]`)?.[0]?.[0] || null;
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

function createPage(title) {
  const roam = api();
  const uid = roam?.util?.generateUID?.();
  if (!roam || !uid) return null;
  roam.data.page.create({ page: { title, uid } });
  return uid;
}

function createBlock(parentUid, order, string, uid, extra = {}) {
  const roam = api();
  if (!roam?.createBlock || !parentUid || !uid) return null;
  return roam.createBlock({
    location: { "parent-uid": parentUid, order },
    block: { string, uid, open: true, ...extra },
  });
}

function childBlocks(parentUid) {
  const roam = api();
  if (!roam?.q || !parentUid) return [];
  return (roam.q(`[:find (pull ?child [:block/uid :block/string :block/order])
                 :where [?parent :block/uid "${parentUid}"]
                        [?parent :block/children ?child]]`) || [])
    .map((row) => row?.[0])
    .filter(Boolean)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function updateBlockIfChanged(uid, string) {
  const roam = api();
  if (!roam?.updateBlock || !uid || getBlockContentStringByUID(uid) === string) return false;
  roam.updateBlock({ block: { uid, string } });
  return true;
}

function renderBlockString(renderStringCore, templateString) {
  return templateString || `${renderStringCore}}}`;
}

/**
 * Creates/repairs only Nautilus Flow's own stable render scaffolding. It never
 * searches the whole graph or rewrites blocks belonging to the old extension.
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
  const renderPageUID = getPageUidByPageTitle(renderPageName) || createPage(renderPageName);
  if (!renderPageUID) return false;

  const existingTitle = blockByUid(titleblockUID);
  if (!existingTitle) {
    createBlock(renderPageUID, "last", componentName, titleblockUID, { heading: 3 });
  }

  const children = childBlocks(titleblockUID);
  let templateBlock = children.find((child) => child.string?.includes("Nautilus Flow [[roam/templates]]"));
  if (!templateBlock) {
    const templateBlockUID = roam.util.generateUID();
    createBlock(titleblockUID, 0, "Nautilus Flow [[roam/templates]]", templateBlockUID);
    templateBlock = { uid: templateBlockUID };
  }

  const templateChildren = childBlocks(templateBlock.uid);
  const renderBlock = templateChildren.find((child) => child.string?.includes(renderStringCore));
  if (!renderBlock) {
    const renderBlockUID = roam.util.generateUID();
    createBlock(templateBlock.uid, 0, renderBlockString(renderStringCore, templateString), renderBlockUID);
  } else {
    updateBlockIfChanged(renderBlock.uid, renderBlockString(renderStringCore, templateString));
  }

  const codeHeader = children.find((child) => child.string === "code");
  let codeHeaderUID = codeHeader?.uid;
  if (!codeHeaderUID) {
    codeHeaderUID = roam.util.generateUID();
    createBlock(titleblockUID, "last", "code", codeHeaderUID, { open: false });
  }

  const blockString = `\`\`\`clojure\n ${cljsFile} \`\`\``;
  if (!blockByUid(codeBlockUID)) {
    createBlock(codeHeaderUID, 0, blockString, codeBlockUID);
  } else {
    updateBlockIfChanged(codeBlockUID, blockString);
  }
  return true;
}

export function updateTemplateString(renderString, renderStringWithSettings) {
  const roam = api();
  if (!roam?.q) return 0;
  const query = `[:find (pull ?node [:block/string :block/uid])
                 :where [?page :node/title "${RENDER_PAGE}"]
                        [?node :block/page ?page]
                        [?node :block/string ?node-string]
                        [(clojure.string/includes? ?node-string "${renderString}")]]`;
  const blocks = (roam.q(query) || []).map((row) => row?.[0]).filter(Boolean);
  let updates = 0;
  blocks.forEach((block) => {
    if (block.string !== renderStringWithSettings) {
      roam.updateBlock({ block: { uid: block.uid, string: renderStringWithSettings } });
      updates += 1;
    }
  });
  return updates;
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

export { getBlockContentStringByUID, queryBlock };
