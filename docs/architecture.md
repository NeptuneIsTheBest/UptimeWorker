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
- Modules import directly from the files that define their dependencies. Add shared capabilities to the appropriate lower layer; avoid cycles caused by forwarding through old paths or reverse dependencies across layers.

[App](../src/web/app/App.tsx) selects pages by URL, and each feature's `routes.ts` registers HTTP endpoints. Public endpoint contracts are documented in the [API reference](api.md); shared types are organized by feature in [shared](../src/shared/).

## Request and check flow

HTTP requests pass through security headers, request-size limits, and Access authentication before reaching feature routes. Only explicitly listed public GET endpoints use caching; admin endpoints and error responses are not cached. Admin pages return SPA assets through the same authentication entry point while preserving the original navigation URL.

The scheduler acquires a D1 lease and reads settings and enabled, due monitors in one `DB.batch`. The query uses `monitors_due`, orders by `next_check_at, id`, and applies the configured batch limit. Immediate tests reuse snapshot reading and probes for one monitor. Failed reads do not run checks or generate samples.

The shared performance module supplies validation, platform baselines, and budget rules to both the scheduler and frontend estimates. Deferred checks retain their due times; internal errors schedule a retry for the next minute without changing status or history. Neither produces a failed sample. A 240-second lease prevents overlapping runs. Defaults and budget calculations are documented under [performance settings](configuration.md#performance-settings-and-capacity-estimates).

Result writes recheck monitor versions, enabled state, and the lease; unique keys prevent duplicate counting. Triggers update statistics and automatic incidents in the sample-write transaction using current rules. Event writes use version checks and private write tokens to keep status, associations, updates, and suppression intervals consistent across concurrent changes.

`worker/features/ordering` validates the complete member set and original versions and positions in a materialized snapshot, then commits the requested order with one atomic UPDATE. Service order is independent of the monitor configuration version, preserving in-flight results. The frontend shares `useReorder` and `SortControls`; `useRemote.suspend` cancels old reads and pauses refreshes during reordering, then merges the saved response and resumes.

Ungrouped's position is stored in the `__ungrouped__` system record in `monitor_groups`; monitor membership remains null. The API returns separate `ungrouped` metadata, and `shared/groups/ordering` merges it with regular groups using the database's ordering rules.

Each run cleans up at most 500 expired detailed checks, 100 expired daily aggregates, and 100 expired suppression records. See [monitor configuration and operating policies](configuration.md) for check frequency, statistical definitions, event rules, and retention periods.

Event association validation uses one JSON parameter with `json_each` to stay within D1's limit of 100 bound parameters. Scheduling normally makes 5 D1 calls across snapshot, result, and cleanup batches; each `DB.batch` counts as one call regardless of its statement count. Capacity planning must also account for CPU, D1 row usage, and cleanup backlog.

## Frontend styles and adding features

The [style entry point](../src/web/styles/index.css) explicitly loads base styles, shared components, layout, feature styles, and accessibility rules. Feature styles live alongside their components, with media queries in the corresponding style file. For overrides across files, check selector specificity and load order, and compare desktop and mobile rendering.

When adding a feature, define the shared contract first, then add Worker routes and data access, frontend components, and relevant feature tests. Cross-feature aggregation belongs in pages or aggregation services; generic HTTP behavior belongs in `http`. Base components should not fetch domain data.

See [development and maintenance](development.md) for database changes and verification commands. Update the API reference when interfaces change, and the configuration or deployment guide when operating procedures change.
