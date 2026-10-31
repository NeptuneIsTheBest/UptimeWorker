# Architecture and code organization

[English](architecture.md) | [简体中文](zh-CN/architecture.md)

[Back to README](../README.md) · [Development and maintenance](development.md)

UptimeWorker serves the API, scheduled checks, and frontend static assets from a single Cloudflare Worker. D1 stores monitor configurations, check history, and events. Code is organized first by runtime layer, then by feature.

## Directories and responsibilities

```text
src/
  shared/                 Pure types, constants, and validation shared by frontend and backend
    monitors/             Monitor configuration, check results, limits, and address validation
    groups/               Group types and validation
    ordering.ts           Ordering snapshot types and validation
    events/               Event types, progress stages, and validation
    settings/             Global settings, refresh rules, and WAF rule templates
    status/               Public status and monitor history response types
    errors.ts             Configuration validation errors
    validation.ts         Object, text, and version validation
  web/
    app/                  Page selection, site layout, and admin page composition
    features/             monitors, groups, events, settings, status
    components/           Icons, dialogs, loading, error, and refresh feedback
    hooks/                Data refresh and page clocks
    lib/                  API requests and display formatting
    styles/               Style entry point, base, layout, shared components, and accessibility rules
  worker/
    index.ts              Worker fetch / scheduled entry points
    app.ts                Application composition, route registration, and the static admin page
    http/                 Access authentication, request limits, caching, and error responses
    features/             monitors, groups, events, settings, status
    lib/                  UTC date utilities
    types.ts              Environment bindings and request context
    errors.ts             Concurrent write conflict errors
tests/
  features/               Unit and D1 integration tests organized by feature
  platform/               Authentication, API boundary, migration, and deployment tests
  performance/            Repeatable aggregation timings and D1 row-usage checks
  support/                D1 fixtures, test data, and the API client
  e2e/                    Browser tests organized by feature, with shared fixtures
```

[scripts](../scripts/) contains build checks, deployment configuration, and browser test server scripts. [migrations](../migrations/) contains D1 migrations applied in numerical order.

| Feature  | Frontend responsibilities                                                   | Worker responsibilities                                                             |
| -------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| monitors | Monitor editor, management list, details, status badges, and history charts | Monitor CRUD, HTTP/TCP probes, check snapshots, and scheduling                      |
| groups   | Group management                                                            | Group reads and writes, version checks, and membership validation                   |
| events   | Event and update editors, lists, and timelines                              | Event reads and writes, pagination, monitor associations, and suppression intervals |
| settings | Global settings, token input, and rule templates                            | Settings reads and writes, public refresh interval, and internal check credentials  |
| status   | Home page summary, grouped display, and filtering                           | Aggregation for public status, monitor history, and event detail endpoints          |

## Dependency and interface boundaries

- `shared` uses pure TypeScript and Web standards, with no dependency on React, Hono, D1, or runtime-specific modules. Domain types and constants live in their feature directories; aggregate response types reference those feature types.
- The frontend's `app` composes features, which use shared components, hooks, and the request client. The status page combines monitor cards and event lists. Page refresh state is managed separately from form state so refreshes preserve unsaved input.
- The Worker's `app` registers HTTP middleware and feature routes. Routes handle requests, validation, and responses; repositories handle database access. Public aggregation lives in `status`. Monitor check snapshots can use queries and decoding provided by the settings module.
- Modules import directly from the files that define their dependencies. Add shared capabilities to the appropriate lower layer; keep dependency directions consistent and avoid cycles.

[App](../src/web/app/App.tsx) selects pages by URL, and each feature's `routes.ts` registers HTTP endpoints. Public endpoint contracts are documented in the [API reference](api.md); shared types are organized by feature in [shared](../src/shared/).

## Request and check flow

HTTP requests pass through security headers, request-size limits, and Access authentication before reaching feature routes. Only explicitly listed public GET endpoints use caching; admin endpoints and error responses are not cached. Admin pages return SPA assets through the same authentication entry point while preserving the original navigation URL.

Public monitor queries select display fields without loading probe configuration. Status aggregation groups daily rows by monitor once and shares one 90-day UTC date sequence across all monitors. Public events combine all open events with the latest 20 closed events through partial indexes; monitor-specific queries start with indexed associations. Parents, associations, and full progress are read in one transactional batch and grouped once for assembly.

The scheduler acquires a D1 lease and reads settings and enabled, due monitors in one `DB.batch`. The query uses `monitors_due`, orders by `next_check_at, id`, and applies the configured batch limit. Immediate tests reuse snapshot reading and probes for one monitor. Failed reads do not run checks or generate samples.

The shared performance module supplies validation, platform baselines, and budget rules to both the scheduler and frontend estimates. Deferred checks retain their due times; internal errors schedule a retry for the next minute without changing status or history. Neither produces a failed sample. A 240-second lease prevents overlapping runs. Budget calculations are documented in the [capacity model](#scheduling-and-capacity-model).

Result writes recheck monitor versions, enabled state, and the lease. Detailed checks use a `(monitor_id, scheduled_at)` primary key in a `WITHOUT ROWID` table, avoiding a separate unique index while preventing duplicate counting. Time indexes support history reads and bounded cleanup by the same composite key. Triggers update statistics and automatic incidents in the sample-write transaction using current rules. Event writes use version checks and private write tokens to keep status, associations, updates, and suppression intervals consistent across concurrent changes.

`worker/features/ordering` validates the complete member set and original versions and positions in a materialized snapshot, then commits the requested order with one atomic UPDATE. Service order is independent of the monitor configuration version, preserving in-flight results. The frontend shares `useReorder` and `SortControls`; `useRemote.suspend` cancels old reads and pauses refreshes during reordering, then merges the saved response and resumes.

Ungrouped's position is stored in the `__ungrouped__` system record in `monitor_groups`; monitor membership remains null. The API returns separate `ungrouped` metadata, and `shared/groups/ordering` merges it with regular groups using the database's ordering rules.

Each run cleans up at most 500 expired detailed checks, 100 expired daily aggregates, and 100 expired suppression records. Retention periods and aggregation rules are described under [statistics and retention](#statistics-and-retention).

Event association validation uses one JSON parameter with `json_each` to stay within D1's limit of 100 bound parameters. A successful scheduler run with results normally makes 4 D1 calls: lease acquisition, snapshot, results, and cleanup/completion. Completion releases the lease; only unfinished runs need the fallback release. Each `DB.batch` counts as one call regardless of its statement count. Call counts do not measure D1 row usage: capacity planning must also account for indexes, triggers, CPU, and cleanup backlog.

The frontend reuses locale-specific formatters, memoizes monitor history and data-only summaries, and indexes monitor groups for display. Mounted components share clocks at one-second and 15-second cadences. Hidden pages stop those timers and correct the display immediately when visible again; API refreshes follow the global page-refresh setting, with cache lifetimes defined in the [API reference](api.md#global-settings).

## Scheduling and capacity model

Cron runs every minute. Within the candidate batch, checks start in due-time order subject to concurrency, HTTP request, and wall-time budgets. Deferred monitors retain their due times for the next run. Overlapping runs and already completed minute slots are skipped; missed slots are not replayed. Internal probe errors defer that monitor until the next minute without producing a sample. The total number of monitors has no fixed cap.

The scheduler and estimator share `createProbeBudget`. Each HTTP check reserves four subrequests for its initial request and up to three redirects, even when no redirect occurs. Free uses 50 subrequests per run, admitting at most 12 HTTP checks; Paid uses 10,000. TCP consumes no HTTP request budget. Before starting a check, the remaining wall-time budget must cover its full timeout plus five seconds for result storage. Database delays can extend the overall run; a run exceeding one minute can overlap the next Cron trigger, which then skips because of the lease.

The estimator includes enabled monitors and assumes they complete on schedule:

| Metric                      | Calculation                                                  |
| --------------------------- | ------------------------------------------------------------ |
| Daily checks                | `Σ(1440 / intervalMinutes)`                                  |
| Average checks per minute   | Daily checks / 1440                                          |
| HTTP requests per day       | 1–4 times daily HTTP checks; excludes TCP                    |
| Seven-day samples           | Daily checks × 7                                             |
| Minimum base writes per day | Daily checks × 3: check row, daily aggregate, monitor status |

Manual tests are outside this model. Base writes exclude indexes, event transitions, cleanup, and other API traffic. The D1 warning compares this lower bound with 80% of the Free daily allowance or a 30-day projection against the Paid monthly included allowance. Use actual account metrics for billing and capacity decisions.

The peak simulation makes all enabled monitors due at time zero, orders equal due times by ID, assumes each check exhausts its timeout, and assigns each admitted check to the earliest available concurrency lane. Configuration reads add no simulated latency. The candidate duration upper bound is `ceil(candidate count / concurrency) × maximum timeout`. Capacity indicators show near-limit at 80–100%, and over-budget above 100%. Peak deferrals can span several runs; average demand above the per-minute batch limit means the target frequency cannot be sustained.

### Platform reference

| Resource                                 | Workers Free  | Workers Paid              |
| ---------------------------------------- | ------------- | ------------------------- |
| HTTP subrequests per invocation, default | 50            | 10,000                    |
| CPU per minute-scheduled Cron invocation | 10 ms         | 30 seconds                |
| D1 queries per Worker invocation         | 50            | 1,000                     |
| D1 rows read                             | 5 million/day | 25 billion/month included |
| D1 rows written                          | 100,000/day   | 50 million/month included |

Cron wall time is capped at 15 minutes; memory is 128 MB per isolate, and up to six outgoing connections can wait for establishment or response headers at once. Network waits consume wall time rather than CPU. Paid usage beyond included D1 allowances is billed separately. Account totals include other applications. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) for platform limits and billing rules.

Only subrequest and D1 write budgets are stored in `PLATFORM_LIMITS`, since those values participate in application calculations. CPU, memory, and query limits are platform constraints measured through [operational monitoring](development.md#operational-monitoring). Scheduling defaults and available inputs are in [monitor configuration](configuration.md#performance-settings-and-capacity-estimates).

## Statistics and retention

- A monitor's 30-day uptime is successful checks divided by completed checks across the most recent 30 UTC days, including today. The overall percentage sums those counts across all monitors before dividing. Missing samples and paused periods contribute no checks; durations are not time-weighted. Maintenance checks still count.
- Overall status and metrics cover all services, independently of display filters. A data-fetch error takes priority, followed by open incidents, down services or stale data, then started maintenance that remains open. Future maintenance and closed events do not affect overall status. Healthy counts use check status; average latency uses the latest non-null latency of services currently up.
- A monitor is unknown before its first check, paused when disabled, and stale after more than two configured intervals without a new result. The browser updates staleness between API refreshes. Infrastructure failures create neither success nor failure samples.
- HTTP latency includes redirects and final response handling. Keyword checks read the body within the same timeout and latency measurement. TCP latency measures connection establishment, without TLS, database queries, or application-protocol validation. Cloudflare selects the execution location; there are no fixed-city or multi-region probes.
- Timestamps are UTC milliseconds; daily bars use UTC dates and displayed check times use the browser time zone. Detailed samples are retained for seven days and daily aggregates for 90 UTC days including today. Detail responses contain all samples from the last 24 hours. Bounded cleanup can take several runs after downtime.
- Editing preserves history. Changes to probe parameters reset the current status, schedule, and unpublished outage timer; name or group changes preserve them. Deleting a monitor cascades to its checks and daily aggregates while preserving event records.

## Event lifecycle

The first failed scheduled check starts an outage timer. A later failed check publishes one automatic incident after the configured threshold. With a ten-minute interval and five-minute threshold, publication can first occur on the second failed check. The first successful check clears an unpublished timer or resolves an open automatic incident with a recovery update. Setting the threshold to zero stops new publications while existing incidents can still recover.

Maintenance suppresses new automatic incidents during `[startsAt, endsAt)`, from publication onward. Checks and uptime statistics continue. Early completion ends that suppression window; overlapping active windows still apply. An open manual incident also suppresses automatic incidents for its monitors. After suppression ends, counting restarts with the first failed check, including when an entire maintenance window falls between two checks.

Pausing, changing probe parameters, or a gap longer than two check intervals resets unpublished failure timing. Stale or unknown states and immediate tests do not publish incidents. Pausing or editing does not resolve an already published incident. Deleting its monitor adds an automatic `Stopped` update and stops tracking.

Manual maintenance stays open after its planned end until a `Completed` update; a manual incident closes with `Resolved`. Completion and suppression changes are atomic. Closed events accept `Updated` notes and remain closed. Editing a manual event updates its initial timeline entry without an edit audit trail. Events are retained indefinitely.

Automatic titles store the monitor's name at publication with the fixed ` 服务异常` suffix. The frontend uses that saved name even after a monitor is renamed. Automatic bodies are localized by stage: initial `Investigating`, recovery `Resolved`, and tracking termination `Stopped`. Administrator-authored updates have `source: manual` and display their original text. The API's fields and stage values are described in [groups and events](api.md#groups-and-events).

## Frontend styles and adding features

The [style entry point](../src/web/styles/index.css) explicitly loads base styles, shared components, layout, feature styles, and accessibility rules. Feature styles live alongside their components, with media queries in the corresponding style file. For overrides across files, check selector specificity and load order, and compare desktop and mobile rendering.

When adding a feature, define the shared contract first, then add Worker routes and data access, frontend components, and relevant feature tests. Cross-feature aggregation belongs in pages or aggregation services; generic HTTP behavior belongs in `http`. Base components should not fetch domain data.

See [development and maintenance](development.md) for database changes and verification commands. Update the API reference when interfaces change, and the configuration or deployment guide when operating procedures change.
