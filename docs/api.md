# API reference

[English](api.md) | [简体中文](zh-CN/api.md)

[Back to README](../README.md)

## Endpoints

| Method               | Path                            | Description                                                                            |
| -------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| GET                  | `/api/status`                   | Site information, groups, current status, daily uptime, and open and historical events |
| GET                  | `/api/monitors/:id/history`     | Public service data, checks from the last 24 hours, and associated events              |
| GET                  | `/api/events/:id`               | A single event with its complete update history, for a standalone detail page          |
| GET                  | `/api/admin/monitors`           | Complete monitor configurations, groups, and identity                                  |
| POST                 | `/api/admin/monitors`           | Create a monitor                                                                       |
| PATCH                | `/api/admin/monitors/:id`       | Update configuration; requires the current `version`                                   |
| DELETE               | `/api/admin/monitors/:id`       | Delete a monitor and its history                                                       |
| POST                 | `/api/admin/monitors/:id/test`  | Test only the saved target without writing statistics                                  |
| GET                  | `/api/admin/settings`           | Global settings, version, and token configuration status                               |
| PATCH                | `/api/admin/settings`           | Update global settings; requires the current `version`                                 |
| GET / POST           | `/api/admin/groups`             | List / create groups                                                                   |
| PUT                  | `/api/admin/groups/order`       | Save the order of all groups atomically                                                |
| PUT                  | `/api/admin/monitors/order`     | Save the order of all services in a specified group atomically                         |
| PATCH / DELETE       | `/api/admin/groups/:id`         | Update / delete a group; requires `version`                                            |
| GET / POST           | `/api/admin/events`             | List events with pagination / publish an event                                         |
| POST                 | `/api/admin/events/bulk-delete` | Atomically delete selected events; each item requires `id` and `version`               |
| GET / PATCH / DELETE | `/api/admin/events/:id`         | Read / edit / delete an event; writes require `version`                                |
| POST                 | `/api/admin/events/:id/updates` | Append an update, optionally completing a manual event; requires `version`             |

## Access and errors

Admin endpoints authenticate through [Cloudflare Access](deployment.md#3-configure-cloudflare-access). Write requests must include a same-origin `Origin` and `Content-Type: application/json`. Monitor deletion and connection tests may send `{}`; group or event deletion requires `version`.

Errors use `{ "code": "stable_error_code", "params": {} }`. `code` is language-independent; `params` is omitted when empty. The interface translates known codes into the selected language and shows a generic request error for unknown codes. For example, an invalid check interval returns `{ "code": "monitor_interval_invalid", "params": { "min": 1, "max": 60 } }`. Text-length errors identify `field` as `event_title`, `event_body`, `progress_title`, `progress_body`, or `group_name`. See [error code definitions](../src/shared/error-messages.ts). Unknown endpoints return JSON `404`; public endpoints omit target addresses, monitor configurations, JWTs, and raw exceptions.

## Global settings

GET / PATCH return the fields below. PATCH requires the current `version`; omitted fields retain their existing values. Invalid settings return `400`. Version conflicts return `409`; read the latest settings before submitting again.

| Field                      | Rules                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `version`                  | Current settings version; required for PATCH.                                           |
| `performance`              | Performance settings object; omitted nested fields retain their values. See below.      |
| `pageRefreshSeconds`       | Defaults to 30; accepts integer seconds from 5–3600, or 0 to disable automatic refresh. |
| `autoIncidentAfterMinutes` | Defaults to 5; accepts integer minutes from 0–1440. 0 disables new automatic incidents. |
| `wafBypassEnabled`         | Boolean; a token must be configured before enabling.                                    |
| `wafBypassTokenConfigured` | Read-only; indicates whether a token is configured.                                     |

Refresh intervals, automatic incident thresholds, and numeric `performance` fields require integers within their allowed ranges; strings, fractions, null, and out-of-range values return `400`. Example PATCH: `{"version": 1, "pageRefreshSeconds": 15, "autoIncidentAfterMinutes": 10}`.

Performance settings share the global settings `version` and are omitted from public endpoints. The plan accepts only the strings listed below.

| Nested field        | Default  | Rules                                                                                                |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `workersPlan`       | `"free"` | `"free"` / `"paid"`; determines application budgets without changing the subscription.               |
| `concurrency`       | 4        | 1–6.                                                                                                 |
| `maxChecksPerRun`   | 10       | 1–500 candidates per run.                                                                            |
| `timeBudgetSeconds` | 50       | 40–180 seconds; starting a check requires reserving its full timeout plus 5 seconds to save results. |

For example, `{"version": 1, "performance": {"concurrency": 6, "maxChecksPerRun": 30}}` changes only concurrency and batch size, retaining the plan, time budget, and other global settings. See [scheduling and capacity model](architecture.md#scheduling-and-capacity-model) for estimation rules.

`wafBypassToken` is write-only. Omitting it or passing an empty string retains the existing token; its raw value is never returned. Token format and delivery are described under [WAF credentials](#waf-credentials).

The top-level responses from `GET /api/status`, `GET /api/monitors/:id/history`, `GET /api/events/:id`, and `GET /api/admin/monitors` all include `pageRefreshSeconds`. Public endpoints are cached for `min(pageRefreshSeconds, 60)` seconds, or 60 seconds when automatic refresh is disabled. Changes take effect after existing cache entries expire naturally. Admin endpoints and failed responses are not cached. `generatedAt` is the time the server generated the data. See [automatic page refresh](configuration.md#automatic-page-refresh) for interface behavior and [event lifecycle](architecture.md#event-lifecycle) for event rules.

## Groups and events

Groups contain `id`, `name`, read-only `sortOrder`, and `version`. POST / PATCH accept a unique `name` of 1–80 characters; PATCH also requires `version`. New groups are appended after the existing regular groups; if Ungrouped was last, it remains last. Renaming preserves the group’s position. Use `PUT /api/admin/groups/order` to change the order. Deleting a group sets its monitors’ `groupId` to null and appends them to Ungrouped in their previous relative order.

A monitor's `groupId` must reference an existing regular group. It defaults to null when omitted on creation; PATCH preserves it when omitted and removes the monitor from its group when set to null. Changing only the name or group increments the management version while preserving the current status, check schedule, and continuous failure timer. `GET /api/admin/groups` and `GET /api/admin/monitors` return regular `groups` plus `ungrouped: {id: "__ungrouped__", sortOrder, version}`. `GET /api/status` returns the corresponding public information without versions. The system item participates only in ordering: PATCH / DELETE return `400 group_readonly`, and using its ID as a monitor's `groupId` returns `400 group_invalid`. Ungrouped monitors continue to use null.

Admin monitor responses include a read-only `sortOrder`. It is not part of the check configuration, and regular monitor POST / PATCH requests do not accept it as an ordering instruction. New services and services moved to another group are appended to the end of the destination group. Both admin and public lists follow group order, then service order within each group; Ungrouped uses its saved group position. Regular groups with equal order values are ordered consistently by creation time and ID, with Ungrouped following regular groups at the same order value.

An ordering request's `items` must be the complete, nonempty list in the desired order. Each item is `{id, expectedVersion, expectedSortOrder}`, using the version and order from the latest admin list response, not the desired position. `PUT /api/admin/groups/order` accepts `{items}`, which must include every regular group and `__ungrouped__`, including empty groups, and returns `{groups, ungrouped}`. `PUT /api/admin/monitors/order` accepts `{groupId, items}`; `groupId` is required, with null indicating Ungrouped. It returns `{groupId, monitors}` containing all services in that group. A successful request saves contiguous, zero-based positions in array order.

Both ordering endpoints have a 256 KiB request body limit. Missing or invalid parameters, duplicate IDs, and empty lists return `400`. A mismatch in the complete member set, group membership, original versions, or original order values returns `409 order_conflict`. Ordering is atomic, with no partial writes. Service ordering preserves monitor `version`; group ordering increments versions for changed positions. Use the returned snapshot after saving, or read again after a conflict before resubmitting.

Creating or editing a manual event requires the complete configuration: `title` (1–120 characters), `body` (1–4000 characters of plain text), `type` (`incident` / `maintenance`), and `monitorIds` (at least one existing monitor, deduplicated, with no fixed count limit; the request body remains limited to 16 KiB). Maintenance requires `startsAt` and `endsAt` in UTC milliseconds, with the end later than the start. For incidents, both fields are normalized to null. Editing also requires `version`. Names of deleted monitors are retained; `monitorIds` may be empty when such historical associations exist.

Event responses contain `id`, `title`, `body`, `type`, `startsAt`, `endsAt`, `source` (`manual` / `automatic`), `status` (`open` / `resolved` / `stopped`), `startedAt`, `endedAt`, `createdAt`, `updatedAt`, `monitors`, and `updates`:

- `monitors` is an array of `{id, name}`. For deleted monitors, id is null and name retains the saved snapshot.
- Each item in `updates` contains `id`, `title`, `body`, `source`, `status`, and `createdAt`, sorted by ascending `createdAt`, then ascending `id`. Every `title` is a fixed English stage. Automatic recovery and stopped-tracking records use `Resolved` and `Stopped`, respectively. An update that only adds a note has a null status.
- Scheduled, in-progress, and past-scheduled-end maintenance states are derived from the `open` status and scheduled times. Reaching the scheduled end does not automatically change the event to `resolved`.

Example update: `{"version": 1, "title": "Completed", "body": "Maintenance is complete"}`. After trimming whitespace, `title` must be one of the fixed stages allowed for the current event, with case-sensitive matching. `body` must contain 1–4000 characters of plain text.

| Event state                       | Allowed `title` values                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| Open maintenance                  | `Scheduled`, `Updated`, `In Progress`, `Completed`                 |
| Open manual incident              | `Investigating`, `Identified`, `Monitoring`, `Updated`, `Resolved` |
| Open automatic incident           | `Investigating`, `Identified`, `Monitoring`, `Updated`             |
| Additional note on a closed event | `Updated`                                                          |

`Completed` completes maintenance; `Resolved` resolves a manual incident. The update, event status, and suppression window change atomically. Other stages only record notes, without changing scheduled maintenance states or check results. `Stopped` identifies system records for stopped tracking and is not accepted in manual submissions.

The update `title` is required. Missing, null, blank, free-form, or unavailable stages return `400` without writes.

Automatic incidents cannot be edited or manually resolved, and cannot be deleted while open. Stale versions and disallowed edit or deletion attempts return `409`; read the latest data before proceeding.

`POST /api/admin/events/bulk-delete` accepts `{"items": [{"id": "event-id", "version": 1}]}` and returns `{"ok": true, "deletedCount": 1}`. The nonempty list must contain unique, nonblank IDs of at most 100 characters and positive safe-integer versions. Invalid selections return `400`; the request body is limited to 256 KiB (`413` when exceeded), with no fixed item-count limit. Every event must exist, match its submitted version, and be deletable. If any item fails these checks, the entire batch returns `409 event_bulk_delete_conflict` without changes. Database failures roll back the entire batch.

Bulk deletion permanently removes the selected events, associations, and updates. As with single-event deletion, future suppression windows are removed, active windows end at deletion time, and past suppression intervals remain available to automatic incident tracking. The admin interface selects only events on the current page, clears selection on pagination, and requests confirmation with event titles and a count. Refreshes retain only visible, eligible selections with unchanged versions; an open confirmation keeps its original selection and versions. Success returns to the latest page; a conflict clears selection and refreshes the current page for a new selection.

`GET /api/admin/events` returns `{events, nextCursor, pageRefreshSeconds}`. Every page includes all `open` events plus up to 20 `resolved` / `stopped` events, sorted by descending `updatedAt`, then descending `id`. Pagination applies only to closed events: URL-encode a nonempty `nextCursor` and send it as `?cursor=` to fetch the next history page. Open events are included on every page and do not count toward its 20-event history limit. Admin events include `version`; public events exclude management versions, identity, and monitor targets.

`/api/status` always returns `groups`, `ungrouped`, and `events`; `/api/monitors/:id/history` returns `checks` and only associated `events`. The `groups` and `events` arrays are present even when empty, and monitor responses always include `groupId` (null for Ungrouped). Public `events` include all `open` events plus the 20 most recent `resolved` / `stopped` events, sorted by descending `updatedAt`, then descending `id`. Open events are not subject to the history limit. Automatic event messages use only monitor names and generic check descriptions.

`GET /api/events/:id` requires no sign-in and returns `{siteName, event, generatedAt, pageRefreshSeconds}` with the same public event fields and all updates. Reading by ID is not restricted by the 20-event history limit. Missing or deleted events return `404`; failed responses are not cached.

## Monitor configuration

Monitor POST / PATCH requests have a 256 KiB JSON body limit; other API requests are limited to 16 KiB except for the ordering endpoints described above. `intervalMinutes` accepts integer minutes from 1–60, defaults to 1 when omitted on POST, and preserves its value when omitted on PATCH. Fractions, out-of-range values, strings, and null return `400`.

Creating an HTTP monitor requires explicit `method`, `wafBypassEnabled`, `requestHeaders`, `requestBody`, and `responseCheck` fields. Use `{}` for no custom headers and `null` for no request body or response validation. The admin form initializes these options to GET, false, `{}`, null, and null. PATCH preserves omitted fields; null clears the request body or response validation. There is no fixed limit on the total number of services. `name` is trimmed to 1–80 characters, `timeoutSeconds` is an integer from 1–30, and `enabled` is a boolean. HTTP URLs accept at most 2048 characters and must use HTTP or HTTPS with a public host and no embedded credentials. Expected status codes are inclusive integers from 100–599, with minimum no greater than maximum.

### HTTP request and response rules

`requestHeaders` is a string-to-string object, up to 8 KiB measured as UTF-8 `name: value` lines including CRLF. Names must be valid HTTP header tokens and unique ignoring case; stored names are lowercase and values are trimmed. Values accept tabs and HTTP header characters, without line breaks. Reserved names include the WAF header, Host, Content-Length, and hop-by-hop transport headers; see [validation](../src/shared/monitors/validation.ts) for the complete list. Credentials such as Authorization and Cookie are returned only through admin endpoints.

`requestBody` is null or `{format: "text" | "json", content: string}`, up to 16 KiB of UTF-8 content. JSON syntax is validated while preserving the original text. GET and HEAD require null. Other supported methods can send a body, with a default Content-Type of `text/plain;charset=UTF-8` or `application/json`; an explicit header takes precedence.

`responseCheck` is null or `{includes: string[], excludes: string[], ignoreCase: boolean}`. Each array accepts at most 20 entries; keywords are trimmed, blank entries removed, and duplicates collapsed. Each retained keyword is at most 256 characters with no line breaks. Empty lists normalize to null. Every included keyword must appear and every excluded keyword must be absent from the UTF-8-decoded response text. Matching uses literal text, with optional case folding, rather than HTML, JSON fields, or regular expressions. HEAD requires no effective response check.

Both status-code and keyword checks must pass. Keyword checking reads up to 1 MiB of response data; a larger body fails with `response_too_large`. Response bodies are not persisted or logged. A `cf-mitigated: challenge` header always fails with `cloudflare_challenge`.

Up to three redirects are followed, with public-address validation at every hop. 301/302 convert POST to GET; 303 converts non-GET/HEAD methods to GET. These conversions remove the body and related content headers. 307/308 preserve method and body. A change in scheme, hostname, or port removes all custom headers permanently for the remaining chain. If a body still needs forwarding across origins, the check fails with `unsafe_redirect`; use the final check URL. Scheduled failures are not automatically retried within the same check.

### WAF credentials

`wafBypassToken` accepts 32–256 letters, digits, underscores, or hyphens. The UI generator uses 32 random bytes. The global switch, individual HTTP monitor switch, and token must all be configured for credentials to be sent. Changes apply to new immediate tests and the next scheduler snapshot. Disabling the global switch preserves the token and individual monitor settings.

`X-UptimeWorker-WAF-Bypass` is sent only to HTTPS URLs with the current monitor's exact hostname, re-evaluated at each redirect. Hostnames are case-normalized, stripped of a trailing dot, and normalized for internationalized domains; matching excludes subdomains and wildcards but does not restrict the port. An HTTP target sends the token only after redirecting to HTTPS on the same hostname. A redirect back to that hostname over HTTPS can send the token again. TCP and IP-address targets cannot enable WAF bypass.

The rule template deduplicates domains from all WAF-enabled monitors, including paused ones. That list configures Cloudflare rules; each probe independently uses its own monitor's hostname. Example:

```text
(http.host in {"example.com" "api.example.com"}) and
(http.request.method in {"GET" "HEAD" "POST" "PUT" "PATCH" "DELETE" "OPTIONS"}) and
(any(http.request.headers["x-uptimeworker-waf-bypass"][*] eq "<YOUR_TOKEN>"))
```

Saved tokens are not returned in API responses or written to logs or history. After reloading settings, the template uses `<YOUR_TOKEN>`. See the [setup guide](configuration.md#cloudflare-waf-bypass) for configuring the Skip action.

### Probe results

Connection tests and history use `{checkedAt, ok, latencyMs, httpStatus, errorCode}`. `checkedAt` is UTC milliseconds, `latencyMs` is elapsed milliseconds, and `httpStatus` is null for TCP or when no HTTP response was received. A target failure produces `ok: false` with one of these `errorCode` values; this is separate from API validation and authentication errors.

| Error code             | Meaning                                      |
| ---------------------- | -------------------------------------------- |
| `timeout`              | The configured timeout elapsed               |
| `network`              | Connection or response reading failed        |
| `unexpected_status`    | HTTP status is outside the expected range    |
| `redirect_limit`       | More than three redirects                    |
| `blocked_target`       | The address or TCP destination is restricted |
| `cloudflare_challenge` | Cloudflare returned a challenge              |
| `content_mismatch`     | Keyword requirements failed                  |
| `response_too_large`   | Keyword validation exceeded 1 MiB            |
| `unsafe_redirect`      | A body would be sent across origins          |

### Basic HTTP monitor

```json
{
  "name": "Main website",
  "type": "http",
  "url": "https://example.com/health",
  "method": "GET",
  "wafBypassEnabled": false,
  "requestHeaders": {},
  "requestBody": null,
  "responseCheck": null,
  "expectedStatusMin": 200,
  "expectedStatusMax": 299,
  "intervalMinutes": 1,
  "timeoutSeconds": 10,
  "enabled": true
}
```

### Advanced HTTP monitor

This example combines a request body, credentials, and response validation. Configure the target site using the [WAF setup guide](configuration.md#cloudflare-waf-bypass).

```json
{
  "name": "API health check",
  "type": "http",
  "url": "https://api.example.com/health",
  "method": "POST",
  "wafBypassEnabled": true,
  "requestHeaders": { "Authorization": "Bearer <API_TOKEN>" },
  "requestBody": { "format": "json", "content": "{\"check\":true}" },
  "responseCheck": { "includes": ["healthy"], "excludes": ["error"], "ignoreCase": true },
  "expectedStatusMin": 200,
  "expectedStatusMax": 299,
  "intervalMinutes": 1,
  "timeoutSeconds": 10,
  "enabled": true
}
```

### TCP monitor

TCP uses `type: "tcp"`, `hostname`, and `port` in place of HTTP-specific fields; other common fields are the same. Supply a public hostname or IPv4/IPv6 address without a scheme or path, and a separate integer port from 1–65535 except 25. Cloudflare also blocks connections to its own IPs. TCP probes establish a connection without TLS or application-protocol validation. See [TCP socket restrictions](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/). See [monitor types](../src/shared/monitors/types.ts), [public status and history responses](../src/shared/status/types.ts), [event types](../src/shared/events/types.ts), and [settings types](../src/shared/settings/types.ts) for the complete contracts.
