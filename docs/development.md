<a id="开发与维护"></a>

# Development and maintenance

[English](development.md) | [简体中文](zh-CN/development.md)

[Back to README](../README.md)

<a id="本地环境"></a>

## Local environment

See [Local development in the README](../README.md#local-development) for initial installation and startup. Run all commands below from the repository root.

`DEV_ACCESS_BYPASS=true` in [`.dev.vars.example`](../.dev.vars.example) applies only to localhost / loopback addresses in Vite development mode. Production builds remove this branch. Keep the development server accessible only from the local machine.

Development mode bypasses the Worker's public response cache. The local database lives in `.wrangler/state/`. Browser tests use a separate, disposable `.wrangler/e2e-state/`, isolated from development and cloud data.

Local Cron does not run automatically on a schedule. While the development server is running, trigger a run manually:

```sh
curl 'http://127.0.0.1:5173/cdn-cgi/local/scheduled?cron=*+*+*+*+*'
```

Repeated triggers in the same minute, or triggers while the previous run is unfinished, are skipped. After creating or editing a monitor, wait for the next time window or use **Test connection** in the admin console. See [checks, statistics, and retention](configuration.md#checks-statistics-and-retention) for scheduler behavior.

<a id="验证命令"></a>

## Verification commands

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run check` runs type checks, unit / D1 integration tests, and a production build. Build checks cover D1 and Cron configuration and removal of development authentication. Browser tests run separately; GitHub Actions runs both.

Run individual checks as needed:

| Command                                                     | Purpose                                    |
| ----------------------------------------------------------- | ------------------------------------------ |
| `npm run typecheck`                                         | TypeScript type checks                     |
| `npm test`                                                  | Unit and D1 integration tests              |
| `npm run test:watch`                                        | Vitest in watch mode                       |
| `npm run build`                                             | Production build and output checks         |
| `npm test -- tests/platform/api.test.ts`                    | API boundary checks only                   |
| `npm run test:e2e -- tests/e2e/monitors/management.spec.ts` | Run one browser test file independently    |
| `npm run format`                                            | Format the entire repository with Prettier |

For selected files, use `npx prettier --write <file-path>`; replace `--write` with `--check` to check without changing files.

To use a locally installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable path.

<a id="测试职责与隔离"></a>

## Test responsibilities and isolation

| Tests                                                                         | Main responsibilities                                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [monitors](../tests/features/monitors/)                                       | Configuration, HTTP/TCP probes, WAF, scheduling, and statistics               |
| [groups](../tests/features/groups/) / [ordering](../tests/features/ordering/) | Group membership, atomic ordering, conflicts, and preservation of check state |
| [events](../tests/features/events/)                                           | Event lifecycle, stages, suppression, recovery, and transactions              |
| [settings](../tests/features/settings/)                                       | Settings validation, tokens, compatibility, and concurrent saves              |
| [status](../tests/features/status/)                                           | Overall status, maintenance boundaries, and data errors                       |
| [platform](../tests/platform/)                                                | API contracts, authentication, caching, migrations, and deployment            |
| [Browser tests](../tests/e2e/)                                                | Page interactions, refreshes, forms, ordering, and responsive layouts         |

Unit tests use HTTP / socket test doubles and local RSA keys for JWTs. D1 integration tests run migrations, SQL, and triggers in local workerd. D1 and browser tests require loopback port access.

Use the [API test client](../tests/support/api-client.ts) for identity, headers, and JSON requests, and place assertions in the relevant feature tests. Browser tests focus on interactions; use a controllable clock for refresh and timing behavior.

The [browser fixtures](../tests/e2e/support/fixtures.ts) reset data and settings before each case. Each file must run independently; tests share a database and run serially, so do not start multiple browser test processes in parallel. Failures save screenshots and traces to `test-results/`, which GitHub Actions uploads.

<a id="代码组织"></a>

## Code organization

Code is divided into `web / worker / shared` layers, with monitors, groups, events, settings, and status features inside each layer. See [architecture and code organization](architecture.md) for feature responsibilities, dependency directions, request and check flows, styles, and conventions for adding features.

<a id="部署配置"></a>

## Deployment configuration

`npm run deploy:prepare` validates environment variables, creates or reuses D1 by name, and generates `wrangler.deploy.json` without an API Token. The workflow rebuilds with `UPTIME_WRANGLER_CONFIG=wrangler.deploy.json`, then runs `npm run deploy:migrate` to apply remote migrations before publishing. See the [deployment guide](deployment.md) for variables and steps.

<a id="数据库迁移"></a>

## Database migrations

Use `migrations/NNNN_description.sql` for new database changes; do not edit migrations already applied in production. Prefer backward-compatible changes and migrate before deploying code. Run `npm run db:migrate` locally; the deployment workflow applies remote migrations. Review [compatibility notes](#compatibility-notes) before upgrades and [database recovery](deployment.md#rollback-and-database-recovery) before rollbacks.

| Migration                       | Changes                                                                                                                                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_initial.sql`              | Monitor, check, daily aggregate, and scheduler lease tables; statistics triggers.                                                                                                                                             |
| `0002_global_settings.sql`      | Global WAF settings, token, and version; legacy domain columns retained.                                                                                                                                                      |
| `0003_flexible_intervals.sql`   | Integer intervals from 1–60; replaces the interval column and restores aggregate triggers.                                                                                                                                    |
| `0004_page_refresh.sql`         | `page_refresh_seconds`: default 30, accepting 0 or integer seconds from 5–3600.                                                                                                                                               |
| `0005_groups_events.sql`        | Groups, events, updates, monitor name snapshots, failure timers, and suppression intervals. Existing monitors start ungrouped; the automatic incident threshold defaults to 5 minutes, without publishing historical outages. |
| `0006_event_update_titles.sql`  | Nullable update titles; omitted titles in old writes and automatic updates remain null.                                                                                                                                       |
| `0007_performance_settings.sql` | Plan, concurrency, batch size, and time budget (Free / 4 / 10 / 50 seconds); due-monitor index.                                                                                                                               |
| `0008_display_order.sql`        | Independent service ordering initialized by creation time and ID within each group.                                                                                                                                           |
| `0009_ungrouped_order.sql`      | `__ungrouped__` system ordering record in `monitor_groups`, initially last with an empty internal name; monitor membership remains `group_id = NULL`.                                                                         |

Migration tests use raw INSERT statements against the corresponding old schema rather than repositories that depend on the latest columns, and verify that existing data is preserved.

<a id="兼容性说明"></a>

## Compatibility notes

- Rolling back performance support restores the old creation and scheduling limits; avoid this on deployments with more than 10 services. Legacy settings requests and removed fields are documented in the [API reference](api.md#global-settings) and [monitor configuration](api.md#monitor-configuration).
- Event updates support legacy free-form titles and untitled `resolve` requests; see [event compatibility rules](api.md#groups-and-events).
- After saving intervals such as 1, 2, or 7 minutes, rollback code must still support 1–60 minute validation.
- Older monitors without `wafBypassEnabled` treat it as off. Legacy WAF domain columns remain unused; this change requires no migration. Update old GET/HEAD WAF rules to permit all supported HTTP methods.
- Code predating `0008_display_order.sql` can run but ignores service ordering and does not append newly created services in the new order.
- After `0009_ungrouped_order.sql`, old pages that omit the system item from group ordering requests must refresh after a conflict. New pages display Ungrouped last when old responses lack `ungrouped`. Rollback code that does not recognize the system item may expose it as a regular group and requires compatibility handling.

<a id="界面语言"></a>

## Interface languages

The interface uses React Context and the type-safe dictionary in `src/web/i18n/messages.ts`. Add both Chinese and English for new copy, with named parameters for dynamic values and `one` / `other` for English plurals. Store persistent notifications as `message(key, params)` and normalize errors with `errorMessage` so they resolve in the current language during rendering.

Shared validation and Worker errors use stable codes and parameters while retaining legacy Chinese descriptions. Translate event stages and recognized automatic-event templates for display; keep API values, monitor names, user content, and unknown historical text unchanged.

Browser tests default to `zh-CN`; see [language tests](../tests/e2e/platform/i18n.spec.ts) for coverage. Check new labels, hints, errors, titles, and accessible names in both languages.

## Documentation maintenance

The default English docs use `README.md` and `docs/*.md`; Simplified Chinese uses `README.zh-CN.md` and matching files in `docs/zh-CN/`. Update both versions together, keeping sections, examples, and technical values aligned.

Keep the README focused on capabilities and guides on tasks. Document API contracts in the API reference and implementation details in the development or architecture guide. Avoid exhaustive UI behavior descriptions.

Language switches link to the corresponding document in each language; other cross-references stay in the selected language. Preserve historical heading anchors. Chinese guides use `../../` for repository files. Translate explanations and interface labels while preserving commands, API fields, enums, error codes, configuration values, Chinese error-response text, and the license.

Check relative links, anchors, JSON examples, and Markdown rendering, then run:

```sh
npx prettier --check README.md README.zh-CN.md "docs/**/*.md"
```
