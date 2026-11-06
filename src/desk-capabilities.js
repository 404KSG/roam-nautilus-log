/** Public API capability hints for Desk affordances. Final writes remain guarded and verified. */
export function readDeskCapabilities(api) {
  const block = api?.data?.block;
  const modern = (name) => typeof block?.[name] === 'function';
  return {
    create: modern('create') || typeof api?.createBlock === 'function',
    move: modern('move') || typeof api?.moveBlock === 'function',
    // Import and guarded removal intentionally require their modern public APIs.
    delete: modern('delete'),
    import: typeof api?.data?.pull === 'function' && modern('create'),
  };
}

export const sameDeskCapabilities = (left, right) => ['create', 'move', 'delete', 'import']
  .every(key => Boolean(left?.[key]) === Boolean(right?.[key]));
