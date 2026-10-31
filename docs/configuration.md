# Monitor configuration and operating policies

[English](configuration.md) | [简体中文](zh-CN/configuration.md)

[Back to README](../README.md)

## Basic configuration

- Supports HTTP/HTTPS and TCP port monitors. Targets must have public addresses.
- New monitors run every 1 minute by default. Intervals accept integer minutes from 1–60; timeouts range from 1–30 seconds.
- HTTP supports GET / HEAD / POST / PUT / PATCH / DELETE / OPTIONS and validates the configured expected status codes. TCP only checks whether a connection can be established.
- The admin console supports creating, editing, deleting, pausing, resuming, and immediately testing monitors. Immediate tests use the saved configuration and do not change history or current status.
- There is no fixed limit on the total number of services. Actual check capacity depends on performance settings and platform resource limits. See the [API reference](api.md#monitor-configuration) for configuration fields and request examples.

## Automatic page refresh

Set the interval under **Monitor management → Global settings → Automatic page refresh**. It applies to all public and admin pages for all visitors. The default is 30 seconds; choose off, 15 / 30 / 60 seconds, or a custom integer from 5–3600 seconds.

Page refreshes preserve filters and unsaved input and do not change monitor check intervals. When automatic refresh is off, use **Refresh now** to update the page. Other pages receive changed settings on their next data fetch; public changes also depend on [cache expiration](api.md#global-settings). **Updated** shows the last successful page refresh; **Last checked** shows the actual monitor check time.

## Server groups and events

Use **Manage groups** to create, rename, reorder, or delete groups. Assign each monitor to at most one group in the monitor editor. The home page and admin console share the same display order. **Ungrouped** can be reordered but cannot be renamed or deleted. The home page supports filtering by group, name, and status.

Drag a group or service handle, or use **Move up** / **Move down**, to reorder; changes save automatically. Services can only be reordered within their group. New services and services moved through the editor are appended to the destination group. Deleting a group moves its services to the end of Ungrouped in their existing order. If a save conflicts with another change, refresh and retry.

Click a group heading to collapse or expand it. The browser remembers this preference separately for the public page and admin console.

On the admin **Events** tab, enter a plain-text title and description, associate monitors, and publish an incident or scheduled maintenance. Manual events can be edited, deleted, updated, and completed manually. Automatic incidents accept notes, resolve after a successful check, and can be deleted after closing. See the [API reference](api.md#groups-and-events) for field limits.

The home page shows all open events and the 20 most recent closed events; monitor details show only associated events. The admin event list has 20 entries per page. Click an event title or **View timeline** to view and share its full history. Editing an event's description updates its initial publication record; edit audit history is not retained.

To add an update, select a **Progress stage** and enter a description. **Completed** or **Resolved** also closes the corresponding manual event and suppression window; other stages record progress only. Automatic incidents recover through checks. Closed events accept **Updated** notes but cannot be reopened.

The home page's overall status covers all services regardless of filters: a fetch failure shows **Status unavailable**; unresolved incidents, failed checks, or stale data show **Some services need attention**; otherwise, maintenance that has started and remains unconfirmed shows **Maintenance in progress**. Future maintenance and closed events do not affect this status. Monitor status, operational counts, and uptime come from check results.

Enter maintenance times in the browser's time zone and confirm completion manually, even after the scheduled end. During `[start time, end time)`, checks and uptime statistics continue while new automatic incidents are suppressed. Suppression does not apply before publication. Early completion ends that window's suppression; overlapping active windows continue to suppress incidents.

Set the threshold under **Global settings → Automatic outage incidents**. It defaults to **5 minutes** and accepts integer minutes from 1–1440. Set it to 0 to disable publication of new automatic incidents; existing incidents still resolve on a successful check.

- Timing starts with the first failed check. A later failed check publishes an incident once the threshold is reached, with only one incident per continuous outage. For example, a 10-minute interval and a 5-minute threshold can publish at the second failed check at the earliest.
- The first successful check clears an unpublished failure timer, or adds a recovery update to a published incident and marks it resolved, recording the sampled period from first failure to recovery. A new outage starts a new timer.
- Maintenance windows and associated open manual incidents suppress new automatic incidents. After suppression ends, timing restarts with the first failed check, including when maintenance falls entirely between two checks. Manual incidents must be resolved manually.
- Pausing, changing check parameters, or a data gap longer than two check intervals resets the unpublished failure timer. Changing only the name or group preserves it. Unknown or stale states and immediate tests do not trigger incidents; pausing or changing configuration does not resolve a published incident.

Events are retained indefinitely. Deleting a monitor preserves events and the monitor's saved name; open automatic incidents stop tracking and receive an explanatory update.

## Advanced HTTP configuration

When creating or editing a monitor, expand **Advanced settings**:

- **Custom request headers**: supports Authorization, Cookie, custom API keys, and other headers, up to 8 KiB in total. Values are returned only through admin endpoints. Names are case-insensitive and cannot be duplicated; values cannot contain line breaks. WAF credentials, Host, Content-Length, and hop-by-hop headers cannot be overridden.
- **Request body**: POST / PUT / PATCH / DELETE / OPTIONS can send text or JSON, up to 16 KiB measured in UTF-8 bytes. JSON syntax is validated, but the original text is preserved. Default content types are `text/plain;charset=UTF-8` and `application/json`, respectively; a custom Content-Type takes precedence. GET / HEAD do not send a body.
- **Response validation**: every keyword in **Must contain** must appear, and every keyword in **Must not contain** must be absent. Enter one keyword per line, up to 20 per list and 256 characters each. Matching is case-sensitive unless **Ignore case** is selected. It checks the raw UTF-8-decoded response text without parsing HTML, JSON fields, or regular expressions. Leave both lists empty to validate only the status code. HEAD does not support keyword validation.
- **Results and limits**: both the status code and keywords must pass. Cloudflare challenge pages always fail. Keyword validation reads at most 1 MiB of the response body; larger responses return `response_too_large`, and mismatches return `content_mismatch`. Response bodies are not written to check history or logs.

Up to three redirects are followed, with public-address validation at each hop. 301/302 convert POST to GET, and 303 converts non-GET/HEAD requests to GET, removing the body and related headers. 307/308 preserve the method and body. A cross-origin redirect, meaning a change in scheme, hostname, or port, removes all custom headers; they are not restored on later redirects. If forwarding the body is still required, the check returns `unsafe_redirect`; configure the final URL directly.

All methods run repeatedly at the monitor's configured interval, without automatic retries on failure.

## Cloudflare WAF bypass

This feature requires permission to manage Cloudflare WAF on the target site. Configure the shared token and master switch under **Monitor management → Global settings**, then turn on **Enable WAF bypass** for each HTTP monitor; it is off by default. Checks carry the credentials only when both the global and individual switches are on and a token is configured. Saving does not require redeployment.

The rule template collects, normalizes, and deduplicates domains from monitors with WAF bypass enabled, including paused monitors. Its domain list is used only to configure Cloudflare rules; each monitor's own configuration determines where its credentials may be sent.

The `X-UptimeWorker-WAF-Bypass` header is sent only to **HTTPS URLs whose full hostname matches the current monitor's hostname**, with the condition checked again at each redirect. The token is not sent across domains or when downgrading to HTTP; it may be sent again after redirecting back to HTTPS on the original hostname. An HTTP target carries the token only after redirecting to HTTPS on the same hostname. Matching ignores case, removes a trailing dot, and normalizes internationalized domain names. It does not restrict ports and does not match wildcards or subdomains. TCP monitors and IP addresses do not support this feature. For cross-domain targets, configure the final check URL directly.

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

### Token and rule maintenance

After saving, the interface and API show only whether a token is configured. They never return its raw value or write it to logs or check history. Leaving the token blank or disabling the master switch retains the saved token; disabling the master switch also preserves individual monitor settings. When changing the token or monitor domains, update the target site's rules as well. After reloading settings, the rule template displays a placeholder for the token.

A response with `cf-mitigated: challenge` causes the check to return `cloudflare_challenge`; review the bypass rules. See [challenge response detection](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/).

## Checks, statistics, and retention

- Each minute, checks run in due-time order within batch, request, and time budgets. Deferred checks are prioritized in later runs and are not recorded as failures. Overlapping runs are skipped and missed runs are not replayed. Load, slow requests, and platform delays may lengthen actual intervals.
- HTTP response time includes redirects and final response processing. The body is read only when keywords are configured, and reading time counts toward both the timeout and response time.
- TCP response time measures connection establishment only. No database query, TLS handshake, or application protocol validation is performed. A successful connection does not guarantee that the application works.
- TCP cannot connect to private networks, localhost, Cloudflare IPs, or port 25. Domains proxied by Cloudflare are unsuitable for raw TCP checks; use HTTP checks for HTTP services. See the [official restrictions](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/).
- Cloudflare determines where checks run; they are not probes pinned to a city or multiple regions. Location and network round-trip time affect response times.
- Before the first check, the status is **Awaiting checks**; disabled monitors show **Paused**. After two configured intervals without a new result, the status becomes **Stale data**. Platform or database failures do not generate successful samples.
- Uptime = successful checks / completed checks. Missing samples and paused periods are excluded. The 30-day period covers the most recent 30 UTC calendar days, including today. Uptime and status history are based on collected samples, not exact outage durations.
- Data timestamps use UTC milliseconds. Daily status bars are aggregated by UTC day, while check times are displayed in the browser's time zone.
- Detailed checks are retained for the last 7 days, and daily aggregates for 90 UTC days including today. Detail pages show all samples from the last 24 hours. Expired data is cleaned in batches; cleanup after a long shutdown may take several runs.
- Editing a monitor preserves history. Changing check parameters resets the current status until the next check; changing only the name or group preserves status. Deleting a monitor deletes its detailed checks and daily aggregates.

## Performance settings and capacity estimates

Use the admin **Performance** tab to adjust scheduler settings. Estimates use the current input; saved changes take effect on the next run. If saving conflicts with another settings change, click **Reload latest settings (discard current edits)**.

| Setting                | Default    | Range          |
| ---------------------- | ---------- | -------------- |
| Workers plan           | Free       | Free / Paid    |
| Probe concurrency      | 4          | 1–6            |
| Maximum checks per run | 10         | 1–500          |
| Time budget per run    | 50 seconds | 40–180 seconds |

Select the plan matching your actual subscription. It changes only application budgets, not the Cloudflare subscription or deployment configuration. There is no limit on the total number of services. The maximum checks per run limits the candidate batch; other budgets also constrain how many checks actually start:

- Each HTTP check reserves 4 subrequests: the initial request and up to 3 redirects. Free permits at most 50 reserved subrequests per run, allowing at most 12 HTTP checks to start. The full budget is reserved even if a target does not redirect. Paid uses the official default quota of 10,000. TCP does not consume the HTTP request budget, but still uses concurrency, batch, and time budgets.
- Before a check starts, enough time must remain for its full timeout plus 5 seconds to save results. Network waiting consumes wall-clock time, not CPU time. Database delays may push the complete run beyond this budget. Runs lasting longer than a minute may cause later Cron invocations to be skipped because of the lease.

Estimates include only enabled services. The theoretical daily check count is `Σ(1440 / intervalMinutes)`; theoretical HTTP requests range from 1–4 times the HTTP check count, excluding TCP. Seven days of detailed samples equal seven times the daily check count. These estimates assume checks complete on schedule and exclude manual tests.

The peak simulation assumes all enabled services are due simultaneously, each takes its full timeout, and configuration reads add no latency. It shows starts, deferrals, and duration under the configured budgets. The duration upper bound is `ceil(candidate count / concurrency) × maximum timeout`, with a warning at 80% of the budget. Multiple batches at peak do not imply a sustained backlog, but average demand above the batch size cannot sustain the target frequency.

The lower bound for base D1 writes counts three writes per check sample: the detailed check, daily aggregate, and service status. It excludes indexes, automatic incidents, cleanup, and other requests. Free uses a daily account quota; Paid uses a monthly included allowance with overage charges. The panel projects Paid write warnings over 30 days. This lower bound is not actual billable usage.

Estimates use a platform baseline verified on 2026-10-29. For the per-minute Cron schedule, Free/Paid CPU limits are 10 milliseconds/30 seconds; the wall-clock limit is 15 minutes, and memory is limited to 128 MB per isolate. Measure actual CPU, memory, D1 usage, and account totals: other applications, traffic, billing periods, and custom deployment limits also affect capacity. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Resource usage and operational monitoring

For example, 10 monitors with 1-minute intervals produce 14,400 scheduled checks per day if all run on schedule. A default batch of 10 HTTP checks reserves at most 40 outbound requests per run. Outbound check requests are not the same as Worker invocations.

Inspect Worker CPU and D1 Row Metrics in the Cloudflare dashboard. The `scheduled_run` log records the number of checks as `checked`, stored samples as `stored`, database reads and writes as `rowsRead` / `rowsWritten`, and total duration as `elapsedMs`. Total duration is measured separately from CPU time.

Resource usage varies with check frequency, traffic, cache locations, database indexes, triggers, and cleanup operations. Account usage includes other applications on the same account; see [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) for quotas and pricing. Before changing performance settings, review the [request and check flow](architecture.md#request-and-check-flow).
