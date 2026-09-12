export const GOOGLE_READ_INCOMPLETE = 'google_read_incomplete';

export const GOOGLE_READ_REASONS = {
  cancelled: 'cancelled',
  repeatedPageToken: 'repeated_page_token',
  pageBudget: 'page_budget',
  itemBudget: 'item_budget',
};

const BLOCKING_REASONS = new Set(Object.values(GOOGLE_READ_REASONS));

function sanitizeContext(context = {}) {
  const safe = {};
  if (Number.isFinite(Number(context.pages))) safe.pages = Number(context.pages);
  if (Number.isFinite(Number(context.items))) safe.items = Number(context.items);
  if (context.calendarId) safe.calendarId = String(context.calendarId);
  if (context.taskListId) safe.taskListId = String(context.taskListId);
  return safe;
}

function defaultMessage(reason, service, context) {
  if (reason === GOOGLE_READ_REASONS.cancelled) return 'Google Calendar sync was cancelled.';
  const where = context.calendarId
    ? ` for calendar ${context.calendarId}`
    : context.taskListId
      ? ` for task list ${context.taskListId}`
      : '';
  if (reason === GOOGLE_READ_REASONS.repeatedPageToken) {
    return `${service} read incomplete: repeated page token${where}.`;
  }
  if (reason === GOOGLE_READ_REASONS.pageBudget) {
    return `${service} read incomplete: page budget reached${where} (${context.pages || 0} pages).`;
  }
  if (reason === GOOGLE_READ_REASONS.itemBudget) {
    return `${service} read incomplete: item budget reached${where} (${context.items || 0} items).`;
  }
  return `${service} read incomplete.`;
}

export function createGoogleReadError({
  reason,
  service = 'Google Calendar',
  message,
  context,
} = {}) {
  const safeContext = sanitizeContext(context);
  const error = new Error(message || defaultMessage(reason, service, safeContext));
  error.code = GOOGLE_READ_INCOMPLETE;
  error.incomplete = true;
  error.reason = reason;
  error.service = service;
  error.context = safeContext;
  return error;
}

export function isBlockingGoogleReadError(error) {
  if (!error) return false;
  if (error.reason && BLOCKING_REASONS.has(error.reason)) return true;
  if (error.code === GOOGLE_READ_INCOMPLETE) return true;
  if (error.name === 'AbortError') return true;
  return /sync was cancelled/i.test(String(error.message || ''));
}

export function refineCalendarRuntimeError(error) {
  if (!error?.incomplete || error.reason) return error;
  const applied = Number(error.applied) || 0;
  if (applied > 0 || error.stage === 'conflict') return error;
  const inner = String(error.message || '').replace(
    /^Calendar sync incomplete; any written blocks were retained\.\s*/i,
    '',
  );
  const next = new Error(`Calendar sync failed with no graph changes. ${inner}`);
  next.incomplete = true;
  next.failedKey = error.failedKey;
  next.stage = error.stage;
  next.applied = error.applied;
  next.summary = error.summary;
  next.cause = error;
  return next;
}
