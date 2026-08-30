# Google Calendar sync design

Nautilus Log treats Google Calendar as a read-only source of fixed events. A
sync always targets the date and Primary Plan represented by the clicked
Nautilus component. It never creates Daily Notes or future plans.

## Product contract

- Google access is opt-in and disabled by default.
- The extension requests only `calendar.events.readonly` and
  `calendar.calendarlist.readonly`.
- A timed, busy event becomes a direct child of the Primary Plan using
  `HH:MM–HH:MM Title`, so the existing scheduler remains authoritative.
- One compact managed child records the calendar source and useful links.
  Location and a shortened plain-text description are added only when present.
- Normal sync updates a managed block only while its current string still
  equals the last imported snapshot. Roam edits win silently.
- Option-click performs an explicit Google-first refresh of managed strings.
  User-created children are never overwritten or deleted.
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
access token. Calendar REST requests still run directly from the Roam browser;
event data never passes through the authorization service. The extension does
not poll Calendar in the background. Turning Google Calendar off revokes and
deletes the connection when possible. Temporary Google failures retain the
connection; only revoked or invalid credentials require consent again.

## Setup

1. Open Nautilus Log settings. The Google Calendar row clearly reports **Not
   connected**.
2. Click **Connect**, choose a Google account, and approve the two read-only
   Calendar permissions.
3. The row changes to **Connected · Read-only · Primary calendar** and the
   Calendar control appears in the Nautilus chart.
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
- [Roam Depot extension contract](https://github.com/Roam-Research/roam-depot)
- [Full Calendar reference implementation](https://github.com/fbgallet/roam-extension-calendar)
