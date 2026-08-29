const MAX_DESCRIPTION_LENGTH = 600;

function compactWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return named[normalized] ?? match;
  });
}

export function calendarDescriptionText(value, limit = MAX_DESCRIPTION_LENGTH) {
  const text = decodeHtmlEntities(
    String(value ?? '')
      .replace(/<(?:br|\/p|\/div|\/li)>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  );
  const compact = compactWhitespace(text);
  const maximum = Math.max(0, Number(limit) || MAX_DESCRIPTION_LENGTH);
  if (compact.length <= maximum) return compact;
  return `${compact.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.href.replace(/\)/g, '%29');
  } catch (_error) {
    return '';
  }
}

function firstConferenceUrl(event) {
  const direct = safeHttpUrl(event?.hangoutLink);
  if (direct) return direct;
  const entries = event?.conferenceData?.entryPoints;
  if (!Array.isArray(entries)) return '';
  const video = entries.find((entry) => entry?.entryPointType === 'video');
  return safeHttpUrl(video?.uri || entries[0]?.uri);
}

function localTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function declinedBySelf(event) {
  return Array.isArray(event?.attendees)
    && event.attendees.some((attendee) => (
      attendee?.self === true && attendee?.responseStatus === 'declined'
    ));
}

function recurringIdentity(event) {
  if (!event?.recurringEventId) return '';
  return event?.originalStartTime?.dateTime || event?.originalStartTime?.date || '';
}

export function googleCalendarEventKey(calendarId, event = {}) {
  const pieces = [String(calendarId || 'primary'), String(event?.id || '')];
  const recurring = recurringIdentity(event);
  if (recurring) pieces.push(recurring);
  return pieces.join(':');
}

function sourceString(calendar, event) {
  const segments = [
    'Google Calendar',
    compactWhitespace(calendar?.summary || calendar?.id || 'Calendar'),
  ];
  const joinUrl = firstConferenceUrl(event);
  const openUrl = safeHttpUrl(event?.htmlLink);
  if (joinUrl) segments.push(`[Join](${joinUrl})`);
  if (openUrl) segments.push(`[Open](${openUrl})`);
  return segments.join(' · ');
}

/**
 * Convert Google Calendar API event resources into the compact Roam contract
 * consumed by Nautilus. All-day, transparent, and self-declined rows are not
 * fixed commitments, so they are intentionally excluded from the day plan.
 */
export function normalizeGoogleCalendarEvents({ calendar = {}, events = [] } = {}) {
  const calendarId = String(calendar?.id || 'primary');
  return (Array.isArray(events) ? events : []).flatMap((event) => {
    const key = googleCalendarEventKey(calendarId, event);
    if (!event?.id) return [];
    if (event?.status === 'cancelled') {
      return [{ key, calendarId, eventId: event.id, status: 'cancelled' }];
    }
    if (event?.start?.date || event?.end?.date) return [];
    if (event?.transparency === 'transparent' || declinedBySelf(event)) return [];
    const start = localTime(event?.start?.dateTime);
    const end = localTime(event?.end?.dateTime);
    if (!start || !end) return [];

    const title = compactWhitespace(event?.summary) || 'Busy';
    const location = compactWhitespace(event?.location);
    const description = calendarDescriptionText(event?.description);
    return [{
      key,
      calendarId,
      eventId: event.id,
      status: 'confirmed',
      parentString: `${start}–${end} ${title}`,
      sourceString: sourceString(calendar, event),
      detailStrings: [location, description].filter(Boolean),
      details: { location, description },
      updated: event?.updated || '',
    }];
  });
}

/**
 * Decide whether a Google-owned string can be updated without surprising the
 * user. Only an unchanged last import is writable during normal sync. Option
 * refresh deliberately overwrites that managed string, never user siblings.
 */
export function decideCalendarManagedChange({
  lastSynced = '',
  current = '',
  incoming = '',
  force = false,
} = {}) {
  const existing = String(current ?? '');
  const next = String(incoming ?? '');
  if (force === true || existing === String(lastSynced ?? '')) {
    if (existing === next) return { action: 'unchanged', value: existing };
    return { action: next ? 'update' : 'delete', value: next };
  }
  return { action: 'keep-local', value: existing };
}

export { MAX_DESCRIPTION_LENGTH };
