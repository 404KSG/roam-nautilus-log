# Google Calendar connection UI

## Outcome

Google Calendar is presented as a connection, not as an unexplained feature
toggle. A new user can tell whether Nautilus Log is disconnected, connecting,
connected, disconnecting, or needs another attempt without knowing anything
about Google Cloud or OAuth.

## Interaction

- Disconnected settings show a native **Connect Google Calendar** action and
  explain that access is read-only and uses the Primary calendar by default.
- Connect opens Google's account and consent flow immediately. Success rebuilds
  the settings row as **Connected · Read-only · Primary calendar**.
- Connected settings show **Disconnect**. Disconnect revokes and deletes the
  stored connection before returning to the disconnected state.
- The Nautilus Calendar control appears only while a usable connection exists.
  Its single job is to sync the clicked Nautilus date; it is no longer a hidden
  setup entry point.
- Cancellation or failure keeps the previous safe state and shows a short,
  actionable settings description. Detailed diagnostics remain in the console.

## Linear-style principles

The state is visible, actions use verbs, and progressive disclosure removes
irrelevant controls. There is no separate boolean switch whose visual state can
disagree with authorization state. Connection existence is the source of truth;
the legacy enabled setting remains only as an internal compatibility gate.

The settings surface uses Roam's native button row and typography. It does not
add a modal, account dashboard, badge system, or background status poll.

## Performance and privacy

- Disconnected startup performs no Google or authorization-service request.
- Connect, disconnect, and explicit Calendar sync are the only network entry
  points.
- The first public version uses the Primary calendar. Existing hidden calendar
  selections remain compatible; a named multi-calendar picker can be added
  later without changing the connection model.
- Users never enter a Client ID, secret, redirect URI, or Calendar ID. Calendar
  event data continues to travel directly between Google and the Roam client.

## Verification

- Panel tests cover disconnected, busy, connected, and failure copy.
- Runtime tests cover successful connect, cancelled connect, disconnect, and
  the legacy enabled-setting transition.
- Renderer tests require both enabled and connected state before exposing the
  Calendar control.
- The full extension and OAuth Worker suite must pass before the Draft PR is
  updated.
