<a id="架构与代码组织"></a>

# Architecture and code organization

[English](architecture.md) | [简体中文](zh-CN/architecture.md)

[Back to README](../README.md) · [Development and maintenance](development.md)

UptimeWorker serves the API, scheduled checks, and frontend static assets from a single Cloudflare Worker. D1 stores monitor configurations, check history, and events. Code is organized first by runtime layer, then by feature.

<a id="目录与职责"></a>

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

<a id="依赖与接口边界"></a>

## Dependency and interface boundaries

- `shared` uses pure TypeScript and Web standards, with no dependency on React, Hono, D1, or runtime-specific modules. Domain types and constants live in their feature directories; aggregate response types reference those feature types.
- The frontend's `app` composes features, which use shared components, hooks, and the request client. The status page combines monitor cards and event lists. Page refresh state is managed separately from form state so refreshes preserve unsaved input.
- The Worker's `app` registers HTTP middleware and feature routes. Routes handle requests, validation, and responses; repositories handle database access. Public aggregation lives in `status`. Monitor check snapshots can use queries and decoding provided by the settings module.
- Modules import directly from the files that define their dependencies. Add shared capabilities to the appropriate lower layer; avoid cycles caused by forwarding through old paths or reverse dependencies across layers.

[App](../src/web/app/App.tsx) selects pages by URL, and each feature's `routes.ts` registers HTTP endpoints. Public endpoint contracts are documented in the [API reference](api.md); shared types are organized by feature in [shared](../src/shared/).

<a id="请求与检测流程"></a>

## Request and check flow

HTTP requests pass through security headers, request-size limits, and Access authentication before reaching feature routes. Only explicitly listed public GET endpoints use caching; admin endpoints and error responses are not cached. Admin pages return SPA assets through the same authentication entry point while preserving the original navigation URL.

The scheduler first acquires a D1 lease, then reads global settings and enabled, due monitors in the same `DB.batch`. The query uses the `monitors_due` index, orders by `next_check_at, id`, and limits candidates in SQL using the saved batch size. Immediate connection tests reuse the snapshot-reading and probe implementation but read only the specified ID. If reading fails, no check runs and no sample is generated.

Defaults are 10 candidates per run, concurrency of 4, and a 50-second budget, all adjustable on the Performance tab. The shared performance module provides settings validation, platform baselines, budget admission rules, and estimates based only on configuration. The Worker and frontend share the same batch, HTTP request, and full-timeout reservation rules. Deferred monitors do not receive new due times or failed samples. Internal errors only schedule a retry for the next minute, preserving current status and history so invalid configuration does not block the front of the queue. The 240-second lease still protects against overlapping runs; monitors that are paused or not yet due do not enter the candidate batch.

When probe results are written in a batch, monitor versions, enabled state, and the lease are checked again. Unique keys prevent duplicate counting. Database triggers update statistics and automatic incidents within the sample-write transaction, using the current automatic incident rules. Writes to event status, associations, updates, and suppression intervals use version checks and private write tokens to prevent concurrent operations from modifying another version's child records.

`worker/features/ordering` centralizes display-order persistence. JSON parameters carry the desired order and original versions and positions. The complete member set is validated in a materialized snapshot, then committed atomically with a single UPDATE. Service ordering is independent of the monitor configuration version, so checks already running are not discarded. The frontend shares `useReorder` and `SortControls`. During dragging and saving, `useRemote.suspend` cancels earlier reads and pauses refreshes; after saving, it merges the API response and resumes refreshing.

Ungrouped's display position is stored in the `__ungrouped__` system record in `monitor_groups`, while monitor membership remains null. The API exposes its ordering metadata in a separate `ungrouped` field. On the frontend, `shared/groups/ordering` merges regular groups and the system item using the same ordering rules as the database. Group headings share `GroupHeading`; `useCollapsedGroups` stores separate browser preferences for the public page and admin console. Temporary expansion during filtering does not overwrite those preferences.

Each run cleans up at most 500 expired detailed checks, 100 expired daily aggregates, and 100 expired suppression records. See [monitor configuration and operating policies](configuration.md) for check frequency, statistical definitions, event rules, and retention periods.

There is no fixed limit on the total number of services or the number associated with a single event. Event association validation uses a single JSON parameter with `json_each`, avoiding dynamic ID expansion that could exceed D1's limit of 100 bound parameters. Child-record writes retain transaction and write-token protection. Scheduling normally makes 5 D1 calls, including snapshot, result, and cleanup batches. A `DB.batch` counts as one call toward the per-invocation quota, regardless of the number of statements inside it. When adjusting performance settings, also evaluate CPU, D1 row usage, and cleanup backlog.

<a id="前端样式与新增功能"></a>

## Frontend styles and adding features

The [style entry point](../src/web/styles/index.css) explicitly loads base styles, shared components, layout, feature styles, and accessibility rules. Feature styles live alongside their components, with media queries in the corresponding style file. For overrides across files, check selector specificity and load order, and compare desktop and mobile rendering.

When adding a feature, define the shared contract first, then add Worker routes and data access, frontend components, and relevant feature tests. Cross-feature aggregation belongs in pages or aggregation services; generic HTTP behavior belongs in `http`. Base components should not fetch domain data.

See [development and maintenance](development.md) for database changes, compatibility requirements, and verification commands. Update the API reference when interfaces change, and the configuration or deployment guide when operating procedures change.
