const CREATE_PLAN_LABEL = 'Nautilus Log: Create or open today’s plan';

export function createTodayPlanCommands({
  extensionAPI,
  todayPlan,
  notify,
} = {}) {
  let initialized = false;

  const run = async () => {
    try {
      return await todayPlan.ensureToday({ locateMode: 'main' });
    } catch (error) {
      console.error('[Nautilus Log] today-plan command failed', error);
      notify?.(error?.message || 'Nautilus Log could not create or open today’s plan.');
      return undefined;
    }
  };

  const initialize = () => {
    if (initialized) return false;
    const palette = extensionAPI?.ui?.commandPalette;
    if (!palette?.addCommand || !palette?.removeCommand) return false;
    initialized = true;
    palette.addCommand({ label: CREATE_PLAN_LABEL, callback: run });
    return true;
  };

  const destroy = () => {
    if (!initialized) return;
    initialized = false;
    const palette = extensionAPI?.ui?.commandPalette;
    try { palette?.removeCommand?.({ label: CREATE_PLAN_LABEL }); } catch (_error) { /* already removed */ }
  };

  return { initialize, destroy, run };
}

export { CREATE_PLAN_LABEL };
