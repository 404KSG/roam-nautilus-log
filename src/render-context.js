// Kept dependency-free so renderer tests and the entry point share exactly the
// same production sidebar ancestry contract.
export const RIGHT_SIDEBAR_RENDER_CONTEXT_SELECTOR = [
  "#roam-right-sidebar-content",
  ".roam-right-sidebar-content",
  '[data-testid="right-sidebar"]',
].join(", ");

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
