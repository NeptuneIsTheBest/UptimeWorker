<a id="api-参考"></a>

# API reference

[English](api.md) | [简体中文](zh-CN/api.md)

[Back to README](../README.md)

<a id="接口列表"></a>

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
| GET / PATCH / DELETE | `/api/admin/events/:id`         | Read / edit / delete an event; writes require `version`                                |
| POST                 | `/api/admin/events/:id/updates` | Append an update, optionally completing a manual event; requires `version`             |

<a id="访问与错误"></a>

## Access and errors

Admin endpoints authenticate through [Cloudflare Access](deployment.md#2-create-an-access-application). Write requests must include a same-origin `Origin` and `Content-Type: application/json`. Monitor deletion and connection tests may send `{}`; group or event deletion requires `version`.

Errors use `{ "error": "description", "code": "stable_error_code", "params": {} }`. `code` is language-independent; `params` is omitted when empty. `error` retains the Chinese message for legacy clients and unknown-code fallbacks. For example, an invalid check interval returns `{ "error": "检测间隔需为 1–60 分钟的整数", "code": "monitor_interval_invalid", "params": { "min": 1, "max": 60 } }`, meaning the interval must be an integer from 1 to 60 minutes. Text-length errors identify `field` as `event_title`, `event_body`, `progress_title`, `progress_body`, or `group_name`. See [error code definitions](../src/shared/error-messages.ts). Unknown endpoints return JSON `404`; public endpoints omit target addresses, monitor configurations, JWTs, and raw exceptions.

<a id="全局设置"></a>

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

For example, `{"version": 1, "performance": {"concurrency": 6, "maxChecksPerRun": 30}}` changes only concurrency and batch size, retaining the plan, time budget, and other global settings. See [performance settings and capacity estimates](configuration.md#performance-settings-and-capacity-estimates) for estimation rules.

`wafBypassToken` is write-only. Omitting it or passing an empty string retains the existing token; its raw value is never returned. Legacy `wafBypassDomains` and `wafBypassAutoDomains` fields are ignored, are not returned, and do not affect bypass decisions.

The top-level responses from `GET /api/status`, `GET /api/monitors/:id/history`, `GET /api/events/:id`, and `GET /api/admin/monitors` all include `pageRefreshSeconds`. Public endpoints are cached for `min(pageRefreshSeconds, 60)` seconds, or 60 seconds when automatic refresh is disabled. Changes take effect after existing cache entries expire naturally. Admin endpoints and failed responses are not cached. `generatedAt` is the time the server generated the data. See [automatic page refresh](configuration.md#automatic-page-refresh) for interface behavior and [server groups and events](configuration.md#server-groups-and-events) for event rules.

<a id="分组与事件"></a>

## Groups and events

Groups contain `id`, `name`, `sortOrder`, and `version`. POST / PATCH accept a unique `name` of 1–80 characters and an optional integer `sortOrder` from 0–1000000. PATCH also requires `version`. Creating a group without an order appends it after the existing regular groups; if Ungrouped was last, it remains last. Omitting the order during editing preserves its existing value, supporting numeric ordering from older clients. If appending would exceed the numeric range, the existing order is first normalized and the versions of affected groups are updated. Deleting a group sets its monitors' `groupId` to null and appends them to Ungrouped in their previous relative order.

A monitor's `groupId` must reference an existing regular group. It defaults to null when omitted on creation; PATCH preserves it when omitted and removes the monitor from its group when set to null. Changing only the name or group increments the management version while preserving the current status, check schedule, and continuous failure timer. `GET /api/admin/groups` and `GET /api/admin/monitors` return regular `groups` plus `ungrouped: {id: "__ungrouped__", sortOrder, version}`. `GET /api/status` returns the corresponding public information without versions. The system item participates only in ordering: PATCH / DELETE return `400 group_readonly`, and using its ID as a monitor's `groupId` returns `400 group_invalid`. Ungrouped monitors continue to use null.

Admin monitor responses include a read-only `sortOrder`. It is not part of the check configuration, and regular monitor POST / PATCH requests do not accept it as an ordering instruction. New services and services moved to another group are appended to the end of the destination group. Both admin and public lists follow group order, then service order within each group; Ungrouped uses its saved group position. Regular groups with equal order values are ordered consistently by creation time and ID, with Ungrouped following regular groups at the same order value.

An ordering request's `items` must be the complete, nonempty list in the desired order. Each item is `{id, expectedVersion, expectedSortOrder}`, using the version and order from the latest admin list response, not the desired position. `PUT /api/admin/groups/order` accepts `{items}`, which must include every regular group and `__ungrouped__`, including empty groups, and returns `{groups, ungrouped}`. Older requests omitting the system item return `409 order_conflict`. `PUT /api/admin/monitors/order` accepts `{groupId, items}`; `groupId` is required, with null indicating Ungrouped. It returns `{groupId, monitors}` containing all services in that group. A successful request saves contiguous, zero-based positions in array order.

Both ordering endpoints have a 256 KiB request body limit. Missing or invalid parameters, duplicate IDs, and empty lists return `400`. A mismatch in the complete member set, group membership, original versions, or original order values returns `409 order_conflict`. Ordering is atomic, with no partial writes. Service ordering preserves monitor `version`; group ordering increments versions for changed positions. Use the returned snapshot after saving, or read again after a conflict before resubmitting.

Creating or editing a manual event requires the complete configuration: `title` (1–120 characters), `body` (1–4000 characters of plain text), `type` (`incident` / `maintenance`), and `monitorIds` (at least one existing monitor, deduplicated, with no fixed count limit; the request body remains limited to 16 KiB). Maintenance requires `startsAt` and `endsAt` in UTC milliseconds, with the end later than the start. For incidents, both fields are normalized to null. Editing also requires `version`. Names of deleted monitors are retained; `monitorIds` may be empty when such historical associations exist.

Event responses contain `id`, `title`, `body`, `type`, `startsAt`, `endsAt`, `source` (`manual` / `automatic`), `status` (`open` / `resolved` / `stopped`), `startedAt`, `endedAt`, `createdAt`, `updatedAt`, `monitors`, and `updates`:

- `monitors` is an array of `{id, name}`. For deleted monitors, id is null and name retains the saved snapshot.
- Each item in `updates` contains `id`, `title`, `body`, `source`, `status`, and `createdAt`, sorted by ascending `createdAt`, then ascending `id`. Newly written `title` values use fixed English stages. Older records may still contain free-form titles or null, and automatic updates may have no title. An update that only adds a note has a null status.
- Scheduled, in-progress, and past-scheduled-end maintenance states are derived from the `open` status and scheduled times. Reaching the scheduled end does not automatically change the event to `resolved`.

Example update: `{"version": 1, "title": "Completed", "body": "Maintenance is complete"}`. After trimming whitespace, `title` must be one of the fixed stages allowed for the current event, with case-sensitive matching. `body` must contain 1–4000 characters of plain text.

| Event state                       | Allowed `title` values                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| Open maintenance                  | `Scheduled`, `Updated`, `In Progress`, `Completed`                 |
| Open manual incident              | `Investigating`, `Identified`, `Monitoring`, `Updated`, `Resolved` |
| Open automatic incident           | `Investigating`, `Identified`, `Monitoring`, `Updated`             |
| Additional note on a closed event | `Updated`                                                          |

`Completed` completes maintenance; `Resolved` resolves a manual incident. The update, event status, and suppression window change atomically. Other stages only record notes, without changing scheduled maintenance states or check results. `Stopped` identifies system records for stopped tracking and is not accepted in manual submissions.

For legacy clients, an omitted, null, or whitespace-only `title` defaults to `Updated`; with `resolve: true`, it becomes `Completed` or `Resolved` according to the event type and completes the event. An explicit `resolve` must agree with the stage's completion behavior. New free-form titles, unavailable stages, and conflicting parameters return `400` without writes. Older free-form titles remain readable.

Automatic incidents cannot be edited or manually resolved, and cannot be deleted while open. Stale versions and legacy `resolve: true` requests attempting to complete automatic or already closed events return `409`; read the latest data before proceeding.

`GET /api/admin/events` returns `{events, nextCursor, pageRefreshSeconds}`, with 20 events per page. URL-encode a nonempty `nextCursor` and send it as `?cursor=` to fetch the next page. Admin events include `version`; public events exclude management versions, identity, and monitor targets.

`/api/status` returns `groups` and `events`; `/api/monitors/:id/history` returns `checks` and only associated `events`. Public `events` include all `open` events plus the 20 most recent `resolved` / `stopped` events, sorted by descending `updatedAt`, then descending `id`. Open events are not subject to the history limit. Automatic event messages use only monitor names and generic check descriptions.

`GET /api/events/:id` requires no sign-in and returns `{siteName, event, generatedAt, pageRefreshSeconds}` with the same public event fields and all updates. Reading by ID is not restricted by the 20-event history limit. Missing or deleted events return `404`; failed responses are not cached.

<a id="监控配置"></a>

## Monitor configuration

Monitor POST / PATCH requests have a 256 KiB JSON body limit; other API requests are limited to 16 KiB except for the ordering endpoints described above. `intervalMinutes` accepts integer minutes from 1–60, defaults to 1 when omitted on POST, and preserves its value when omitted on PATCH. Fractions, out-of-range values, strings, and null return `400`.

When creating an HTTP monitor, `method` defaults to GET, `wafBypassEnabled` to false, `requestHeaders` to `{}`, and `requestBody` and `responseCheck` to null. PATCH preserves omitted fields; null clears the request body or response validation. There is no fixed limit on the total number of services. `GET /api/admin/monitors` no longer returns `limit`, and creation no longer returns `monitor_limit`. See [basic configuration](configuration.md#basic-configuration) for timeouts and check behavior.

<a id="基本-http-监控"></a>

### Basic HTTP monitor

```json
{
  "name": "Main website",
  "type": "http",
  "url": "https://example.com/health",
  "method": "GET",
  "expectedStatusMin": 200,
  "expectedStatusMax": 299,
  "intervalMinutes": 1,
  "timeoutSeconds": 10,
  "enabled": true
}
```

<a id="高级-http-监控"></a>

### Advanced HTTP monitor

See [advanced HTTP configuration](configuration.md#advanced-http-configuration) for request parameters, size limits, and redirect rules, and [Cloudflare WAF bypass](configuration.md#cloudflare-waf-bypass) for bypass setup. This example creates a monitor with a request body and response validation:

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

<a id="tcp-监控"></a>

### TCP monitor

TCP uses `type: "tcp"`, `hostname`, and `port` in place of HTTP-specific fields; other common fields are the same. See [monitor types](../src/shared/monitors/types.ts), [public status and history responses](../src/shared/status/types.ts), [event types](../src/shared/events/types.ts), and [settings types](../src/shared/settings/types.ts) for the complete contracts.
