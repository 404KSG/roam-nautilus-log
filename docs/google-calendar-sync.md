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
  `{{[[TODO]]}} Title · Google Calendar`; a completed task becomes DONE. With no
  visible duration token, the task inherits the current configured Default Todo
  Duration. A user can add an explicit value such as `30m` to override it.
  Google Tasks exposes no reliable scheduled interval through its public API,
  so Nautilus never presents the fallback as a Google-provided estimate.
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
  equals the last imported snapshot. Roam edits win, including an explicit
  duration override. If the parent provenance suffix was removed, normal sync
  restores only that suffix without replacing the user's edited body or time.
  Untouched legacy imports with a written default duration migrate to the
  quieter implicit form on their next sync.
- Option-click performs an explicit Google-first refresh of managed strings.
  User-created children are never overwritten or deleted. One Google Task keeps
  the same managed block while it changes between pending and completed.
- All-day, transparent/free, declined, and cancelled events are not newly
  imported as commitments. If an imported event explicitly changes to one of
  these states, sync removes its generated tree only when all managed content
  is untouched and it has no user-created descendants. Locally edited or
  extended trees are retained and reported as local changes. A missing item in
  one response is not deletion evidence.

## Write integrity and recovery

Calendar graph writes require a known graph and native Web Locks. A lock covers
all of `google-calendar-sync-state`, not one date, because an event can move
between plans. Google reads stay outside the lock. Writes recheck the frozen
host, graph, connection and clicked Plan before and after every block mutation.
Within one sync turn, repeated `read`/`children` of the same UID may reuse a
snapshot only until JavaScript actually yields. Awaiting a thenable — including
an already-resolved Promise, an async helper return, or `Promise.then` — lets
other microtasks edit the graph, so that snapshot is discarded in `finally` and
the next write-before check is a fresh host read. Missing or throwing queries
are never stored as successful empty trees; returned child arrays are copies.
A no-op field inspection does not `await`, so it does not create a yield. The
final mapping save still runs on an unchanged sync so `lastSeen` and orphan
retention stay correct.
Disconnect/unload cancels queued work and prevents subsequent requests; it cannot
retract a request Roam has already received.

A small write-ahead record in `google-calendar-sync-pending` stores exact
reserved UIDs, before/after managed text and mapping progress. It is saved and
read back before a graph request. Each event's confirmed mapping is saved and
read back before that record is cleared. Retry verifies the recorded UID rather
than matching similar titles or inserting a second tree. Stable event/role UIDs
make a stale settings cache fail closed on a collision. Failed writes never
trigger automatic deletion or a success checkmark. An incomplete response may
include earlier completed changes.

If a pending create UID was edited, moved or occupied and cannot be verified,
or an owner disappears from a still-incomplete tree, its record is parked as a
conflict on that event. It is not claimed, overwritten
or used as a parent for new source blocks. Other events can continue after the
conflict is durably saved and the shared journal is cleared; the affected Plan
still reports incomplete status. Preserve local edits and inspect the exact UID
and intended parent. Restoring the recorded topology/text permits read-only
verification on retry; never clear a journal simply to force another copy.
If an already-active owned block disappears after an interrupted update or
move, read-only recovery preserves its prior mapping as a local deletion.
Normal sync does not recreate it; only an explicit force refresh can restore
that known UID on the clicked date. This does not leave a global WAL blocker.
A record from a previous connection is retained for identity review rather than
silently adopted by a new account. Malformed records, foreign-graph records, and
older journals that omit `graphScope` remain a safe stop. The implementation
never infers a graph name from a composite scope string. Disconnect does not
delete imported blocks or their recovery data.

Version 1 mappings (`version: 1` plus an `events` object) migrate in place to
version 2 on the next successful sync. UIDs and last-synced strings are kept.
A missing or blank `google-calendar-sync-state` is a legitimate first-run empty
mapping. Truncated JSON, arrays, unknown versions, or entries that are not
objects fail closed and leave the original settings value untouched: there is
no automatic rewrite to `{ events: {} }` and no silent backup overwrite. Copy
the settings blob before a manual repair if a recoverable snapshot is needed.
The pending journal is a new key; its absence is normal for first-run and for
v1 mappings that never started a write. Extension settings default that key to
an empty string, which the journal parser treats as `null` (no record). Filling
missing settings does not overwrite a WAL that is already present. Unreadable
journals stay fail-closed for inspection; this version does not bulk-migrate or
rewrite every old malformed blob. These guarantees apply to cooperating
instances of this version in one browser storage partition. They are not a
distributed lock across devices or a guarantee of immediate Roam replication.
Update all participating clients before relying on the new recovery protocol.
Calendar mapping uses the `calendar-mapping` lock; Plan Tidy uses `outline`.
The two can overlap on one Plan. In-flight host writes still cannot be retracted
without CAS. Adapter `read`/`children` counts are not Roam `pull`/`q` time, and
runtime `assertActive` Plan identity reads are extra host pulls outside the
reconciler reuse count.

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

## Google read bounds

Calendar and Tasks list requests share a small in-process concurrency cap and
keep the caller's input order. `calendarList` and task-list metadata may be
reused for a short TTL only when the client has a trusted connection id; the
opaque connection secret and access token are never used as cache identity.
Failed, partial, 401, disconnect, and destroy paths do not keep metadata. If no
stable connection id is available, caching stays off.

Each `paginate()` call has its own page and item budget: one calendar event
stream, one `calendarList` or task-list metadata list, one active Tasks stream,
or one dated Tasks lifecycle stream. Reaching that per-stream budget fails the
read as incomplete. It is not a whole-sync total cap, so several collections can
each approach the per-stream limit. Those incomplete reads surface a distinct
error and never become a successful partial sync: runtime does not call the
reconciler, so there are no graph writes. Ordinary Google Tasks permission or
availability failures still degrade to `tasksUnavailable` while calendar events
can import. Budget, cancel, and repeated-token failures are not swallowed that
way.

Active Tasks remain ungated by `dueMin`/`dueMax` so Calendar-scheduled tasks are
not dropped; dated completed/deleted rows still use the day bounds. Cancel and
destroy refuse new fetches, including work still queued behind the limiter.
In-flight responses after cancel cannot succeed. A later legitimate read after
an ordinary cancel uses a fresh operation controller; destroy stays terminal.
A cancelled read keeps the generation and abort controller captured at start, so
it cannot resume by borrowing a later read's controller. Metadata is cached only
under the connection identity observed when that fetch began; a connection
change while a list is in flight does not store the old result under the new
key, and missing or first-authorize connections still read without caching.
Read-only Google scopes, the OAuth callback, and authorization flow are
unchanged.

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

The Draft preview uses an isolated Preview credential store. The public build
uses the production Nautilus Log OAuth service and persistent offline consent.
No Google Cloud setup, Client ID, secret, Calendar ID, or developer knowledge is
required from a user.

## Sources

- [Google Identity Services code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model)
- [Google OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
- [Google Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Google Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Google Tasks authorization scopes](https://developers.google.com/workspace/tasks/auth)
- [Google Tasks tasks.list](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list)
- [Roam Depot extension contract](https://github.com/Roam-Research/roam-depot)
- [Full Calendar reference implementation](https://github.com/fbgallet/roam-extension-calendar)
