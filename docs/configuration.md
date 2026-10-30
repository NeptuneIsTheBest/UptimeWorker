<a id="监控配置与运行策略"></a>

# Monitor configuration and operating policies

[English](configuration.md) | [简体中文](zh-CN/configuration.md)

[Back to README](../README.md)

<a id="基本配置"></a>

## Basic configuration

- Supports HTTP/HTTPS and TCP port monitors. Targets must have public addresses.
- New monitors run every 1 minute by default. Intervals accept integer minutes from 1–60; timeouts range from 1–30 seconds.
- HTTP supports GET / HEAD / POST / PUT / PATCH / DELETE / OPTIONS and validates the configured expected status codes. TCP only checks whether a connection can be established.
- The admin console supports creating, editing, deleting, pausing, resuming, and immediately testing monitors. Immediate tests use the saved configuration and do not change history or current status.
- There is no fixed limit on the total number of services. Actual check capacity depends on performance settings and platform resource limits. See the [API reference](api.md#monitor-configuration) for configuration fields and request examples.

<a id="页面自动刷新"></a>

## Automatic page refresh

Use **Monitor management → Global settings → Automatic page refresh** to set a shared refresh interval for the status overview, monitor details, event details, and admin pages. It applies to all visitors. The default is 30 seconds; options are off, 15 / 30 / 60 seconds, or a custom integer from 5–3600 seconds.

Refreshing preserves search terms, filters, and unsaved form content without changing monitor check intervals. Each request waits until the previous request finishes, then waits the configured interval. On failure, existing data and the last successful refresh time are retained, with a retry prompt. When automatic refresh is enabled, requests pause while the page is hidden and resume immediately when it returns to the foreground.

Disabling automatic refresh stops timed polling. Data still loads when the page is first opened, when **Refresh now** is clicked, when paging through events, and after admin operations such as saving settings, creating, editing, or deleting monitors or events, and reordering lists. Saved settings apply immediately to the current admin page. Other pages receive them on their next successful data fetch; pages where automatic refresh was already off can be refreshed manually or reopened to fetch the latest settings.

Public pages show admin changes after the cache expires and the page refreshes. Admin endpoints are not cached; see the [API reference](api.md#global-settings) for cache durations. **Updated** shows when the page last fetched data successfully, in the browser's time zone, and advances even on a cache hit. Each monitor's **Last checked** shows the actual check time.

<a id="服务器分组与事件"></a>

## Server groups and events

Use **Manage groups** in the admin console to create, rename, reorder, or delete groups, and assign monitors in the monitor editor. Each monitor belongs to at most one group. The admin console and home page use the same group order and service order within each group. **Ungrouped** can also be reordered and appears in group management even when empty, but cannot be renamed or deleted. The home page supports combined filtering by group, name, and status.

Drag a group or service handle, or use the **Move up** and **Move down** buttons, to change its order. Each change saves automatically. Services can only be reordered within their current group; use the monitor editor to change groups. Mobile and keyboard users can use the move buttons. List refreshes pause while saving. On failure, the previous order is restored and the list is fetched again; if the list has changed, retry after refreshing.

New groups are appended after regular groups; if Ungrouped was last, it stays last. New services and services moved to another group are appended to the destination group. Deleting a group appends its services to Ungrouped in their previous relative order. Ordering does not change check schedules, historical statistics, failure timers, or checks already running. Public pages show the new order after the existing cache expires and the page refreshes; cache entries last at most 60 seconds.

Click a group heading to collapse or expand its monitors, or use Enter / Space on the keyboard. The heading still shows the monitor count, and empty groups are hidden from monitor lists. Groups are expanded by default. The current browser remembers collapsed groups separately for the public page and admin console, preserving them across refreshes, renames, and reordering. If browser storage is unavailable, the preference lasts only for the current page. Collapsing does not affect statistics or automatic refresh. While searching or filtering on the home page, matching groups expand temporarily and cannot be collapsed; clearing the filters restores the previous state. Collapsing is temporarily disabled during admin drag operations and while saving the order.

On the admin **Events** tab, enter a plain-text title and description, associate monitors, and publish an incident or scheduled maintenance. The top of the home page shows all open events; the top of a monitor's detail page shows only open events associated with that monitor. These include scheduled maintenance, maintenance in progress, maintenance past its scheduled end but not yet confirmed complete, and ongoing incidents. Closed events appear in the history section below, limited to 20 entries. Each section is sorted by descending update time, then descending event ID. When an event closes, it moves to history on the next successful refresh. The admin console displays 20 events per page and supports pagination. Manual events can be edited, deleted, updated, and completed manually. Automatic incidents accept additional notes, are resolved by successful checks, and can be deleted after closing.

A single event can be associated with more than 10 services; there is no fixed association count limit. Associations must be valid, and the complete event request remains subject to the 16 KiB body limit.

Event cards show only the latest update's fixed stage, publication time, and a description preview of up to three lines. If there are no updates, they show the event description. Click the event title or **View timeline** to open `/events/:id`; this URL can be opened directly, refreshed, or shared. The detail page shows event information, all updates, and the initial publication record from newest to oldest. Each record includes a relative time, a full timestamp in the browser's time zone, and its complete text. The initial maintenance stage is **Scheduled**; the initial incident stage is **Investigating**. Editing the event description changes the displayed initial publication record; no edit audit history is kept.

The main event title remains manually entered. In **Add event update**, select a stage from **Progress stage**. Stage labels follow the selected interface language, while API values remain fixed English enums such as `Updated`; see the [API reference](api.md#groups-and-events). The options below use English interface labels and follow the event lifecycle, with the general-purpose **Updated** option last and selected by default. The progress description is required plain text:

- Open maintenance: **Scheduled**, **In Progress**, **Completed**, **Updated**.
- Open manual incident: **Investigating**, **Identified**, **Monitoring**, **Resolved**, **Updated**.
- Open automatic incident: **Investigating**, **Identified**, **Monitoring**, **Updated**; successful checks still determine recovery.
- Closed events accept only **Updated** notes and cannot be reopened.

Selecting **Completed** or **Resolved** and saving also closes the corresponding manual event and suppression window, without a separate completion checkbox. Other stages only record progress. Maintenance start and overdue states still follow scheduled times and do not create timeline records automatically. System records for stopped tracking display **Stopped**. Historical free-form titles remain as supplementary text, with the stage inferred from the original status as **Completed**, **Resolved**, **Stopped**, or **Updated**. Admin automatic refreshes and failed submissions preserve the selected stage and unsaved description.

The overall home page status combines incidents, maintenance, and check results across the site, regardless of search terms or filters. A data-fetch failure displays **Status unavailable**. Unresolved manual or automatic incidents, failed checks, or stale data display **Some services need attention**, with the corresponding counts. Otherwise, maintenance that has started but has not been confirmed complete displays **Maintenance in progress**, even after its scheduled end; future maintenance only appears as event cards. Resolved events and events whose tracking has stopped do not affect overall status. Monitor status, operational service counts, and uptime always come from check results. Event changes appear on the home page after fresh data is fetched.

Enter maintenance times in the browser's time zone. The page clock switches to in-progress at the start time and past-scheduled-end at the end time; an administrator must confirm completion. The maintenance window is `[start time, end time)`. Checks and uptime statistics continue during the window, while publication of new automatic incidents is suppressed. Suppression does not apply retroactively to times before publication. Completing maintenance early ends that window's suppression; with overlapping windows, any active window keeps suppression in effect.

Set the threshold under **Global settings → Automatic outage incidents**. It defaults to **5 minutes** and accepts integer minutes from 1–1440. Set it to 0 to disable publication of new automatic incidents; existing incidents still resolve on a successful check.

- Timing starts with the first failed check. A later failed check publishes an incident once the threshold is reached, with only one incident per continuous outage. For example, a 10-minute interval and a 5-minute threshold can publish at the second failed check at the earliest.
- The first successful check clears an unpublished failure timer, or adds a recovery update to a published incident and marks it resolved, recording the sampled period from first failure to recovery. A new outage starts a new timer.
- Maintenance windows and associated open manual incidents suppress new automatic incidents. After suppression ends, timing restarts with the first failed check, including when maintenance falls entirely between two checks. Manual incidents must be resolved manually.
- Pausing, changing check parameters, or a data gap longer than two check intervals resets the unpublished failure timer. Changing only the name or group preserves it. Unknown or stale states and immediate tests do not trigger incidents; pausing or changing configuration does not resolve a published incident.

Events are retained indefinitely. Deleting a monitor preserves events and the monitor's saved name; open automatic incidents stop tracking and receive an explanatory update.

<a id="http-高级配置"></a>

## Advanced HTTP configuration

When creating or editing a monitor, expand **Advanced settings**:

- **Custom request headers**: supports Authorization, Cookie, custom API keys, and other headers, up to 8 KiB in total. Values are returned only through admin endpoints. Names are case-insensitive and cannot be duplicated; values cannot contain line breaks. WAF credentials, Host, Content-Length, and hop-by-hop headers cannot be overridden.
- **Request body**: POST / PUT / PATCH / DELETE / OPTIONS can send text or JSON, up to 16 KiB measured in UTF-8 bytes. JSON syntax is validated, but the original text is preserved. Default content types are `text/plain;charset=UTF-8` and `application/json`, respectively; a custom Content-Type takes precedence. GET / HEAD do not send a body.
- **Response validation**: every keyword in **Must contain** must appear, and every keyword in **Must not contain** must be absent. Enter one keyword per line, up to 20 per list and 256 characters each. Matching is case-sensitive unless **Ignore case** is selected. It checks the raw UTF-8-decoded response text without parsing HTML, JSON fields, or regular expressions. Leave both lists empty to validate only the status code. HEAD does not support keyword validation.
- **Results and limits**: both the status code and keywords must pass. Cloudflare challenge pages always fail. Keyword validation reads at most 1 MiB of the response body; larger responses return `response_too_large`, and mismatches return `content_mismatch`. Response bodies are not written to check history or logs.

Up to three redirects are followed, with public-address validation at each hop. 301/302 convert POST to GET, and 303 converts non-GET/HEAD requests to GET, removing the body and related headers. 307/308 preserve the method and body. A cross-origin redirect, meaning a change in scheme, hostname, or port, removes all custom headers; they are not restored on later redirects. If forwarding the body is still required, the check returns `unsafe_redirect`; configure the final URL directly.

The editor preserves input when switching methods, but saving submits only the body and keyword settings supported by the selected method. All methods run repeatedly at the monitor's configured interval, without automatic retries on failure.

<a id="cloudflare-waf-放行"></a>

## Cloudflare WAF bypass

This feature requires permission to manage Cloudflare WAF on the target site. Configure the shared token and master switch under **Monitor management → Global settings**, then turn on **Enable WAF bypass** for each HTTP monitor; it is off by default. Checks carry the credentials only when both the global and individual switches are on and a token is configured. Saving does not require redeployment.

The rule template collects, normalizes, and deduplicates domains from monitors with WAF bypass enabled, including paused monitors. Its domain list is used only to configure Cloudflare rules; each monitor's own configuration determines where its credentials may be sent.

The `X-UptimeWorker-WAF-Bypass` header is sent only to **HTTPS URLs whose full hostname matches the current monitor's hostname**, with the condition checked again at each redirect. The token is not sent across domains or when downgrading to HTTP; it may be sent again after redirecting back to HTTPS on the original hostname. An HTTP target carries the token only after redirecting to HTTPS on the same hostname. Matching ignores case, removes a trailing dot, and normalizes internationalized domain names. It does not restrict ports and does not match wildcards or subdomains. TCP monitors and IP addresses do not support this feature. For cross-domain targets, configure the final check URL directly.

<a id="配置步骤"></a>

### Setup steps

1. Enable WAF bypass on the HTTP monitor and save it. In Global settings, click **Generate random token** to generate 32 random bytes, or enter a 32–256 character token containing letters, digits, underscores, and hyphens. Copy and store a new token before saving.
2. Expand **Configure a Cloudflare Skip rule** and copy the complete rule. If using the template, replace `<YOUR_TOKEN>` with the same token. Example rule:

   ```text
   (http.host in {"example.com" "api.example.com"}) and
   (http.request.method in {"GET" "HEAD" "POST" "PUT" "PATCH" "DELETE" "OPTIONS"}) and
   (any(http.request.headers["x-uptimeworker-waf-bypass"][*] eq "<YOUR_TOKEN>"))
   ```

3. Under **Security rules** for each target site in Cloudflare, create a custom rule, enter the expression, choose **Skip**, and place it before the relevant blocking rules. Depending on what blocks the request, choose to skip the remaining custom rules, Managed Rules, Rate Limiting, Super Bot Fight Mode, or other supported features. Keep match logging enabled for verification. Standard **Bot Fight Mode cannot be bypassed with Skip**; products such as Browser Integrity Check require selecting their own Skip options. See the [official setup steps](https://developers.cloudflare.com/waf/custom-rules/skip/) and [features that can be skipped](https://developers.cloudflare.com/waf/custom-rules/skip/options/).
4. Save the target site's rule, enable the global master switch, and save settings. Run **Test connection**, then wait for the next scheduled check. Use Cloudflare Security Events to confirm that requests match the bypass rule.

<a id="密钥与规则维护"></a>

### Token and rule maintenance

After saving, the interface and API show only whether a token is configured. They never return its raw value or write it to logs or check history. Leaving the token blank or disabling the master switch retains the saved token; disabling the master switch also preserves individual monitor settings. When changing the token or monitor domains, update the target site's rules as well. After reloading settings, the rule template displays a placeholder for the token. For upgrades from older versions, see [compatibility notes](development.md#compatibility-notes).

A response with `cf-mitigated: challenge` causes the check to return `cloudflare_challenge`; review the bypass rules. See [challenge response detection](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/).

<a id="检测统计与保留策略"></a>

## Checks, statistics, and retention

- Each minute, the scheduler selects monitors by earliest due time, then service ID, and runs checks within batch, request, and time budgets. Deferred monitors stay due and take priority in later runs; they are not recorded as failures. The same minute is not counted twice, overlapping invocations are skipped while the previous run is unfinished, and missed runs are not replayed. Sustained full load, slow requests, or platform delays may lengthen actual intervals.
- HTTP response time includes redirects and final response processing. The body is read only when keywords are configured, and reading time counts toward both the timeout and response time.
- TCP response time measures connection establishment only. No database query, TLS handshake, or application protocol validation is performed. A successful connection does not guarantee that the application works.
- TCP cannot connect to private networks, localhost, Cloudflare IPs, or port 25. Domains proxied by Cloudflare are unsuitable for raw TCP checks; use HTTP checks for HTTP services. See the [official restrictions](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/).
- Cloudflare determines where checks run; they are not probes pinned to a city or multiple regions. Location and network round-trip time affect response times.
- Before the first check, the status is **Awaiting checks**; disabled monitors show **Paused**. After two configured intervals without a new result, the status becomes **Stale data**. Platform or database failures do not generate successful samples.
- Uptime = successful checks / completed checks. Missing samples and paused periods are excluded. The 30-day period covers the most recent 30 UTC calendar days, including today. Uptime and status history are based on collected samples, not exact outage durations.
- Data timestamps use UTC milliseconds. Daily status bars are aggregated by UTC day, while check times are displayed in the browser's time zone.
- Detailed checks are retained for the last 7 days, and daily aggregates for 90 UTC days including today. Detail pages show all samples from the last 24 hours. Expired data is cleaned in batches; cleanup after a long shutdown may take several runs.
- Editing a monitor preserves history. Changing check parameters resets the current status until the next check; changing only the name or group preserves status. Deleting a monitor deletes its detailed checks and daily aggregates.

<a id="性能设置与容量估算"></a>

## Performance settings and capacity estimates

Use the admin **Performance** tab to adjust scheduler settings. Saved changes take effect on the next run. Estimates immediately use unsaved input, and edits survive automatic refreshes of service configurations and tab switches. These settings share a version with global settings. After a conflict, click **Reload latest settings (discard current edits)**.

| Setting                | Default    | Range          |
| ---------------------- | ---------- | -------------- |
| Workers plan           | Free       | Free / Paid    |
| Probe concurrency      | 4          | 1–6            |
| Maximum checks per run | 10         | 1–500          |
| Time budget per run    | 50 seconds | 40–180 seconds |

Select the plan matching your actual subscription. It changes only application budgets, not the Cloudflare subscription or deployment configuration. There is no limit on the total number of services. The maximum checks per run limits the candidate batch; other budgets also constrain how many checks actually start:

- Each HTTP check reserves 4 subrequests: the initial request and up to 3 redirects. Free permits at most 50 reserved subrequests per run, allowing at most 12 HTTP checks to start. The full budget is reserved even if a target does not redirect. Paid uses the official default quota of 10,000. TCP does not consume the HTTP request budget, but still uses concurrency, batch, and time budgets.
- Before a check starts, enough time must remain for its full timeout plus 5 seconds to save results. Network waiting consumes wall-clock time, not CPU time. Database delays may push the complete run beyond this budget. Runs lasting longer than a minute may cause later Cron invocations to be skipped because of the lease.
- Checks that do not start retain their due time. Internal execution errors do not generate samples and schedule a retry for the next minute, preventing a persistent failure from blocking the front of the queue. Existing lease, version, and duplicate-counting safeguards remain in effect.

Estimates include only enabled services. The theoretical daily check count is `Σ(1440 / intervalMinutes)`; theoretical HTTP requests range from 1–4 times the HTTP check count, excluding TCP. Seven days of detailed samples equal seven times the daily check count. These estimates assume checks complete on schedule and exclude manual tests.

The peak simulation assumes all enabled services are due simultaneously, ordered by ID, with every check taking its full timeout and no configuration read latency. It uses the same budget rules as the scheduler and shows the number started, reasons for deferral, and probe duration. The upper bound for candidate duration is `ceil(candidate count / concurrency) × maximum timeout`; usage at or above 80% is marked as near the budget. A peak requiring multiple batches does not necessarily mean a sustained backlog. Average demand per minute above the configured batch size, however, cannot sustain the target frequency.

The lower bound for base D1 writes counts three writes per check sample: the detailed check, daily aggregate, and service status. It excludes indexes, automatic incidents, cleanup, and other requests. Free uses a daily account quota; Paid uses a monthly included allowance with overage charges. The panel projects Paid write warnings over 30 days. This lower bound is not actual billable usage.

The platform baseline was verified on 2026-10-29 and is maintained centrally in the shared performance module; the page does not contact Cloudflare. CPU, total memory, actual D1 reads and writes, and total account usage must be measured. The panel does not guarantee that limits will not be exceeded. For the current per-minute Cron schedule, Free/Paid CPU limits are 10 milliseconds/30 seconds, respectively; the Cron wall-clock limit is 15 minutes, and memory is limited to 128 MB per isolate. Other applications, page requests, actual billing periods, and custom deployment limits also affect capacity. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

<a id="资源用量与运行观测"></a>

## Resource usage and operational monitoring

For example, 10 monitors with 1-minute intervals produce 14,400 scheduled checks per day if all run on schedule. A default batch of 10 HTTP checks reserves at most 40 outbound requests per run. Outbound check requests are not the same as Worker invocations.

Inspect Worker CPU and D1 Row Metrics in the Cloudflare dashboard. The `scheduled_run` log records the number of checks as `checked`, stored samples as `stored`, database reads and writes as `rowsRead` / `rowsWritten`, and total duration as `elapsedMs`. Total duration is measured separately from CPU time.

Resource usage varies with check frequency, traffic, cache locations, database indexes, triggers, and cleanup operations. Account usage includes other applications on the same account; see [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) for quotas and pricing. Before changing performance settings, review the [request and check flow](architecture.md#request-and-check-flow).
