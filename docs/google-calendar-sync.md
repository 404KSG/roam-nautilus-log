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

Nautilus Log owns its Google Web OAuth application. The first Calendar click
opens Google's authorization-code flow with offline access. A small Nautilus
authorization service exchanges the callback code and encrypts the refresh
token at rest. The extension stores only an opaque connection ID and secret in
extension settings.

On a later Roam load, the extension makes one request to restore a short-lived
access token. Calendar REST requests still run directly from the Roam browser;
event data never passes through the authorization service. The extension does
not poll Calendar in the background. Turning Google Calendar off revokes and
deletes the connection when possible.

## Setup

1. Enable **Google Calendar · Optional** in Nautilus Log settings.
2. Open the Nautilus chart for the intended Daily Note and click its Calendar
   control.
3. Choose a Google account and approve the two read-only Calendar permissions.
4. The first sync continues automatically. Later Roam reloads normally restore
   the same connection without another consent flow.
5. Option/Alt-click remains the explicit Google-first refresh for managed
   strings. Turning the setting off disconnects Google Calendar.

The public extension uses Nautilus Log's verified production OAuth application.
No Google Cloud setup, Client ID, secret, Calendar ID, or developer knowledge is
required from a user.

## Sources

- [Google Identity Services code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model)
- [Google OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
- [Google Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Google Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Roam Depot extension contract](https://github.com/Roam-Research/roam-depot)
- [Full Calendar reference implementation](https://github.com/fbgallet/roam-extension-calendar)
