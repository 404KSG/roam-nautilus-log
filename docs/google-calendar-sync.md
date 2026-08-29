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

Google Identity Services' browser token model obtains short-lived access
tokens from a user gesture and calls Calendar REST endpoints through CORS. It
does not require a refresh-token backend, but a Web OAuth Client ID and an
authorized JavaScript origin are still required. Nautilus Log therefore never
reuses another extension's client ID or token broker. The Client ID is supplied
in extension settings; access tokens stay in memory and are never written to
Roam or extension settings.

After the option is enabled and a valid Client ID is entered, Nautilus Log may
preload the official Google Identity Services script so the next explicit click
can open Google's authorization flow reliably. It does not request an access
token or read Calendar data until that click.

## Setup

1. In Google Cloud, enable the Google Calendar API and configure an OAuth consent
   screen for the accounts that will use the extension.
2. Create an OAuth Client ID with application type **Web application**.
3. Add `https://roamresearch.com` to **Authorized JavaScript origins**. A client
   secret is not used by this browser token flow.
4. In **Roam Settings → Nautilus Log**, enable Google Calendar, paste the Client
   ID, and keep `primary` or add comma-separated Calendar IDs.
5. Open the Nautilus chart for the intended Daily Note and click its Calendar
   control. Option/Alt-click is the explicit Google-first refresh.

OAuth projects that are still in Google's testing mode must include the intended
Google accounts as test users. Production consent-screen and verification
requirements remain governed by Google Cloud.

## Sources

- [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Identity Services setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
- [Google Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Google Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Roam Depot extension contract](https://github.com/Roam-Research/roam-depot)
- [Full Calendar reference implementation](https://github.com/fbgallet/roam-extension-calendar)
