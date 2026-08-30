# Google Calendar events and Google Tasks import boundary

Date: 2026-08-30  
Scope: Google first-party API documentation/help and the current Nautilus Log source. No product source was changed.

## Conclusion

Google Calendar **events** and Google **Tasks** are separate API resources even though Calendar's UI can show both on the same grid. The Calendar `Event` model has no `task` event type; Google documents a separate Tasks API and task-list hierarchy. Therefore `events.list` alone must not be expected to import Google Tasks. This is an inference from Google's documented models, not a claim about Calendar's private UI implementation. ([Calendar Event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), [Google Tasks API](https://developers.google.com/workspace/tasks/reference/rest))

For Nautilus, a timed, busy Calendar event is a fixed commitment. A Google Task is a flexible task unless the API supplies a reliable scheduled interval. The public Tasks API v1 exposes a due **date**, status and completion timestamp, but explicitly discards the due-time component; its documented Task resource exposes neither Calendar's newer start/end-time fields nor recurrence metadata. Nautilus therefore cannot faithfully reconstruct a task's Calendar-grid time or repeating series through Tasks API v1. ([Task resource](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks), [Calendar UI task settings](https://support.google.com/tasks/answer/9901136?co=GENIE.Platform%3DDesktop&hl=en))

## Official data-model comparison

| Item visible in Google Calendar | Official resource | Relevant fields | Safe Nautilus meaning |
|---|---|---|---|
| Timed Calendar event | Calendar `Event` | `start.dateTime`, `end.dateTime`; `transparency=opaque` means Busy | Fixed event; consumes the represented interval |
| All-day Calendar event | Calendar `Event` | `start.date`, `end.date`; the end is exclusive | Date context, not a clock interval; do not invent a full-day slice |
| Google Task shown in Calendar | Tasks `Task`, not a documented Calendar event type | `title`, `notes`, `status`, date-only `due`, `completed`, `position`, `parent`, `webViewLink` | Flexible TODO/DONE; no reliable fixed time from Tasks API v1 |

Calendar documents `birthday`, `default`, `focusTime`, `fromGmail`, `outOfOffice`, and `workingLocation` as the complete `eventType` set; there is no `task` value. It also defines `opaque` as time-blocking/Busy and `transparent` as non-blocking/Available. ([Calendar Event types and transparency](https://developers.google.com/workspace/calendar/api/v3/reference/events))

Calendar's product UI nevertheless supports Tasks: dated tasks appear on Calendar, tasks may have a start/end time, deadlines appear in the all-day section, completed tasks can be shown or hidden, and repeating tasks materialize only a limited number of future instances at a time. These are UI capabilities; they do not add corresponding fields to the documented Tasks API v1 resource. ([Create and manage Tasks in Calendar](https://support.google.com/tasks/answer/9901136?co=GENIE.Platform%3DDesktop&hl=en), [Manage repeating Tasks](https://support.google.com/tasks/answer/12132599?co=GENIE.Platform%3DDesktop&hl=en))

## APIs, endpoints, and scopes

Calendar events use:

- `GET https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events`
- the existing narrow scope `https://www.googleapis.com/auth/calendar.events.readonly`
- `singleEvents=true` to expand recurring Calendar events into individual instances
- `showDeleted=true` when cancelled/deleted instances must reconcile local copies

([Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list))

Google Tasks require a separate service and an additional consented scope:

- `GET https://tasks.googleapis.com/tasks/v1/users/@me/lists` to enumerate task lists
- `GET https://tasks.googleapis.com/tasks/v1/lists/{tasklist}/tasks` to enumerate each list's tasks
- `https://www.googleapis.com/auth/tasks.readonly` for read-only import; Google recommends the narrowest suitable scope

([tasklists.list](https://developers.google.com/workspace/tasks/reference/rest/v1/tasklists/list), [tasks.list](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list), [Tasks OAuth scopes](https://developers.google.com/workspace/tasks/auth))

`tasks.list` defaults are easy to misread: `showCompleted=true`, `showDeleted=false`, and `showHidden=false`; Google says `showHidden=true` is also required to retrieve tasks completed in first-party clients after they were hidden/cleared. It supports `completedMin/Max`, `dueMin/Max`, `updatedMin`, pagination, and optional assigned tasks. ([tasks.list](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list))

## Completion and recurrence contract

### Calendar events

- `status` is `confirmed`, `tentative`, or `cancelled`.
- `recurrence[]` contains RFC 5545 `RRULE`, `EXRULE`, `RDATE`, and `EXDATE` lines on a series resource.
- Expanded instances expose `recurringEventId`; immutable `originalStartTime` identifies the occurrence even when it moves.
- A cancelled recurring exception is guaranteed only `id`, `recurringEventId`, and `originalStartTime`; other cancelled events represent deleted events whose local copies should be removed.

([Calendar Event recurrence and status](https://developers.google.com/workspace/calendar/api/v3/reference/events))

### Google Tasks

- `status` is exactly `needsAction` or `completed`.
- `completed` is an RFC 3339 completion timestamp and is omitted while unfinished.
- `due` records only a date; Google explicitly says the time portion is discarded and cannot be read or written through the API.
- `deleted` marks deletion; `hidden` marks a completed task hidden when the list was last cleared.
- The documented v1 Task representation contains no recurrence/series field. Although Google's UI supports repeating Tasks and creates the next occurrence after completion, an API client cannot reconstruct the rule or safely pre-generate future occurrences from this resource.

([Task resource](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks), [Repeating Tasks help](https://support.google.com/tasks/answer/12132599?co=GENIE.Platform%3DDesktop&hl=en))

Safe import semantics are therefore:

1. `needsAction` maps to a flexible pending task, not a fixed event.
2. `completed` may map to DONE/Review; `completed` is evidence of completion time, not task duration.
3. A dated task can be selected for that Daily Note by its date-only `due`, but Nautilus must not invent a 09:00 start merely because Google's UI uses 09:00 for some notifications.
4. Import only concrete task rows returned by Google; do not synthesize future recurring instances.
5. If deleted/hidden completed tasks are reconciled, preserve the same “Roam edits win” protection used for Calendar-managed blocks.

## What the current Nautilus implementation includes and filters out

The current client calls only Calendar API endpoints. It lists calendars, then calls `events.list` with `timeMin`, `timeMax`, `singleEvents=true`, `showDeleted=true`, and pagination. It has no Tasks service, task-list request, or task request. ([`src/calendar-google.js`](../../src/calendar-google.js#L3), [`src/calendar-google.js`](../../src/calendar-google.js#L54), [`src/calendar-google.js`](../../src/calendar-google.js#L68))

The hosted OAuth flow currently requests only `calendar.events.readonly` and `calendar.calendarlist.readonly`; it does not request `tasks.readonly`. ([`oauth-worker/src/worker.mjs`](../../oauth-worker/src/worker.mjs#L1))

`normalizeGoogleCalendarEvents` applies the following exact rules: ([`src/calendar-core.js`](../../src/calendar-core.js#L87), [`src/calendar-core.js`](../../src/calendar-core.js#L123))

| Incoming Calendar row | Current result |
|---|---|
| Missing `event.id` | Dropped |
| `status=cancelled` | Converted to a cancellation tombstone; not imported as a visible event |
| Any `start.date` or `end.date` | Dropped as all-day |
| `transparency=transparent` | Dropped as free/non-blocking |
| An attendee with `self=true` and `responseStatus=declined` | Dropped |
| Missing/invalid `start.dateTime` or `end.dateTime` | Dropped |
| Otherwise timed and non-transparent | Imported, with title fallback `Busy` |

The current filter does **not** explicitly exclude `tentative`, `focusTime`, `fromGmail`, `outOfOffice`, or `workingLocation`. It also does not check task types because Calendar's documented Event model has no task type. A surviving row is normalized with status `confirmed`, so an incoming tentative event loses that distinction. Cancelled rows remove an untouched generated event, but a locally edited block or one with user-created descendants is retained. ([`src/calendar-core.js`](../../src/calendar-core.js#L123), [`src/calendar-reconcile.js`](../../src/calendar-reconcile.js#L224))

## Boundary for a future Tasks feature

A Google Tasks import should be a separate, explicitly consented layer rather than broadening Calendar-event normalization. Keep Calendar events fixed and Tasks flexible, expose the Tasks API's limitations honestly, and avoid assigning a scheduled interval, recurrence rule, or duration that Google did not return. This preserves Nautilus's core distinction between fixed events and user-estimated flexible work.
