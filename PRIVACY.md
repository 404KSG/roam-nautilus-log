# Nautilus Log Google Calendar privacy

Last updated: August 30, 2026

Google Calendar integration is optional, disabled by default, read-only, and
activated by the user. Nautilus Log requests only permission to read calendar
lists and calendar events.

## Data flow

- Calendar lists and events are requested directly from Google by the Nautilus
  Log extension running inside the user's Roam Research client.
- Event titles, descriptions, locations, attendees, links, and times do not pass
  through the Nautilus authorization service.
- The authorization service exchanges Google OAuth codes and refreshes
  short-lived access tokens. It stores an encrypted Google refresh token, an
  opaque connection identifier, a one-way hash of the connection secret, and
  creation timestamps.
- Short-lived OAuth sessions expire after ten minutes.
- The extension stores the opaque connection ID and secret in Roam extension
  settings. Access tokens remain in memory.
- Imported event blocks and the managed sync mapping remain in the user's Roam
  graph under the user's control.

## Use and sharing

Authorization data is used only to provide the Google Calendar sync requested
by the user. Nautilus Log does not sell data, use Calendar data for advertising,
train models on Calendar data, or share Calendar data with third parties. Google
and the authorization-service hosting provider process the minimum network data
required to provide OAuth and hosting.

## Retention and deletion

An encrypted refresh token is retained until the user disables Google Calendar,
disconnects the integration, revokes Google access, or the connection becomes
invalid. Disabling the feature deletes the Nautilus service connection and asks
Google to revoke it when Google is reachable. Imported Roam blocks are not
deleted automatically because they belong to the user's graph.

## Security

The authorization service restricts browser access to approved Roam origins,
encrypts refresh tokens at rest with AES-GCM, hashes connection secrets, keeps
OAuth client secrets outside the extension bundle, and does not log tokens or
Calendar content. No internet service can be guaranteed perfectly secure;
users may revoke Nautilus Log at any time from their Google Account permissions.

Questions or deletion issues can be reported through the project's public
[GitHub issue tracker](https://github.com/404KSG/roam-nautilus-log/issues).
