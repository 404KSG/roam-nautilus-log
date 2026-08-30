# Nautilus Log Google Calendar privacy

Last updated: August 30, 2026

Google Calendar integration is optional, disabled by default, read-only, and
activated by the user. Nautilus Log requests only permission to read calendar
lists, calendar events, Google Task lists, and Google Tasks.

## Data flow

- Calendar lists, events, Task lists, and Tasks are requested directly from
  Google by the Nautilus Log extension running inside the user's Roam Research
  client.
- Event and Task titles, descriptions or notes, locations, attendees, links,
  statuses, and times do not pass through the Nautilus authorization service.
- The authorization service exchanges Google OAuth codes and refreshes
  short-lived access tokens. It stores an encrypted Google refresh token, an
  opaque connection identifier, a one-way hash of the connection secret, and
  creation timestamps.
- During Roam Desktop authorization, the service also keeps one encrypted,
  secret-bound handoff result for at most ten minutes so the system browser can
  return the connection to Roam. It contains no Calendar event data and is
  deleted as soon as Roam retrieves it.
- The extension stores the opaque connection ID and secret in Roam extension
  settings. Access tokens remain in memory.
- Imported event or Task blocks and the managed sync mapping remain in the
  user's Roam graph under the user's control.
- When Google exposes the authorized Primary calendar identifier, an imported
  event's `Open` URL may include it as an encoded Google account hint. The
  original Google event link remains authoritative and is used unchanged when
  the hint is unavailable or unsafe.

## Use and sharing

Authorization data is used only to provide the Google Calendar and Tasks sync
requested by the user. Nautilus Log does not sell data, use Calendar or Tasks
data for advertising, train models on that data, or share it with third parties.
Google and the authorization-service hosting provider process the minimum
network data required to provide OAuth and hosting.

## Retention and deletion

An encrypted refresh token is retained until the user disables Google Calendar,
disconnects the integration, revokes Google access, or the connection becomes
invalid. Disabling the feature deletes the Nautilus service connection and asks
Google to revoke it when Google is reachable. Imported Roam blocks are not
deleted automatically because they belong to the user's graph.

Incomplete Roam Desktop authorization sessions expire after ten minutes. Any
unclaimed connection created for an expired session is deleted with it.

## Security

The authorization service restricts browser access to approved Roam origins,
encrypts refresh tokens at rest with AES-GCM, hashes connection secrets, keeps
OAuth client secrets outside the extension bundle, and does not log tokens or
Calendar content. No internet service can be guaranteed perfectly secure;
users may revoke Nautilus Log at any time from their Google Account permissions.

Questions or deletion issues can be reported through the project's public
[GitHub issue tracker](https://github.com/404KSG/roam-nautilus-log/issues).
