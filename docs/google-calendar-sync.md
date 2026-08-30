# Google Calendar sync design

Nautilus Log treats timed Google Calendar events as fixed commitments and dated
Google Tasks as flexible work. A sync always targets the date and Primary Plan
represented by the clicked Nautilus component. It never creates Daily Notes or
future plans.

## Product contract

- Google access is opt-in and disabled by default.
- The extension requests only `calendar.events.readonly`,
  `calendar.calendarlist.readonly`, and `tasks.readonly`.
- A timed, busy event becomes a direct child of the Primary Plan using
  `HH:MM–HH:MM Title · Google Calendar`, so the existing scheduler remains
  authoritative.
- A dated pending Google Task becomes
  `{{[[TODO]]}} Title 15m · Google Calendar`; a completed task becomes DONE.
  The estimate uses the configured Default Todo Duration. Google Tasks exposes
  no reliable scheduled interval through its public API, so Nautilus never
  invents one.
- The quiet `· Google Calendar` suffix remains visible in the Roam outline as
  provenance but is removed from chart labels.
- One compact managed child records the calendar source and useful links.
  Calendar location, Calendar description, and Google Task notes are added only
  when present.
- The imported `Open` action is derived from Google's exact `event.htmlLink`.
  When Google exposes the authorized Primary calendar identifier, Nautilus adds
  it only as an encoded account hint; unavailable or unsafe hints leave the
  original link unchanged.
- Normal sync updates a managed block only while its current string still
  equals the last imported snapshot. Roam edits win silently.
- Option-click performs an explicit Google-first refresh of managed strings.
  User-created children are never overwritten or deleted. One Google Task keeps
  the same managed block while it changes between pending and completed.
- All-day, transparent/free, declined, and cancelled events do not consume
  Nautilus capacity. Cancellation removes an untouched generated event only
  when it has no user-created descendants.

## Authentication boundary

Nautilus Log owns its Google Web OAuth application. The **Connect Google
Calendar** settings action opens the hosted Nautilus authorization flow. In a
browser, the callback returns directly to the initiating Roam window. In Roam
Desktop, the real Google authorization URL opens in the system browser and Roam
retrieves the result through a ten-minute, secret-bound handoff session. The
service encrypts both refresh tokens and temporary Desktop handoff results at
rest. The extension stores only the resulting opaque connection ID and secret
in extension settings.

On a later Roam load, the extension makes one request to restore a short-lived
access token. Calendar and Tasks REST requests still run directly from the Roam
browser; item data never passes through the authorization service. The extension
does not poll Google in the background. Turning Google Calendar off revokes and
deletes the connection when possible. Temporary Google failures retain the
connection; only revoked or invalid credentials require consent again.

## Setup

1. Open Nautilus Log settings. The Google Calendar row clearly reports **Not
   connected**.
2. Click **Connect**, choose a Google account, and approve the read-only
   Calendar and Tasks permissions.
3. The row changes to **Connected · Read-only · Primary calendar + Google
   Tasks** and the Calendar control appears in the Nautilus chart.
4. Click that control to sync the chart's Daily Note date. Later Roam reloads
   normally restore the same connection without another consent flow.
5. Option/Alt-click remains the explicit Google-first refresh for managed
   strings. Use **Disconnect** in settings to revoke and delete the connection.

The Draft preview uses an isolated preview OAuth service; the public release
will use Nautilus Log's verified production OAuth application. No Google Cloud
setup, Client ID, secret, Calendar ID, or developer knowledge is required from
a user.

## Sources

- [Google Identity Services code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model)
- [Google OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
- [Google Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Google Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Google Tasks authorization scopes](https://developers.google.com/workspace/tasks/auth)
- [Google Tasks tasks.list](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list)
- [Roam Depot extension contract](https://github.com/Roam-Research/roam-depot)
- [Full Calendar reference implementation](https://github.com/fbgallet/roam-extension-calendar)
