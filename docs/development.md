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

`npm run check` runs strict type checks, including unused local declarations and parameters, unit / D1 integration tests, and a production build. It also checks the D1 and Cron configuration and verifies that development authentication branches are removed. Browser tests run separately; GitHub Actions runs both sets of checks.

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

| Tests                                   | Main responsibilities                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [monitors](../tests/features/monitors/) | Configuration validation, HTTP/TCP probes, WAF credential scope, advanced settings, check snapshots, scheduler leases, deduplication, and statistics |
| [groups](../tests/features/groups/)     | Preserving check state across renames and group changes, monitor membership after group deletion, and automatic incident continuity                  |
| [events](../tests/features/events/)     | Events, progress stages, suppression windows, automatic incident recovery, concurrency, and transaction rollback                                     |
| [settings](../tests/features/settings/) | Token lifecycle, legacy settings compatibility, concurrent saves, refresh settings, and read failures                                                |
| [status](../tests/features/status/)     | Home page status priorities, maintenance time boundaries, and data errors                                                                            |
| [platform](../tests/platform/)          | API authentication and caching, request limits, version conflicts, JWTs, database migrations, and deployment configuration                           |
| [Browser tests](../tests/e2e/)          | Admin and public page interactions, form preservation, automatic refresh, event timelines, and desktop / mobile layouts                              |

Unit tests use HTTP / socket test doubles. D1 integration tests run migrations, SQL, and triggers in local workerd, and JWT tests use local RSA keys. D1 and browser tests require permission to listen on loopback ports.

The [API test client](../tests/support/api-client.ts) centralizes identity, headers, and JSON requests. Place new assertions in the relevant feature tests; keep browser tests focused on interaction flows. See [architecture and code organization](architecture.md) for directory and dependency conventions.

Before each case, the [browser test fixtures](../tests/e2e/support/fixtures.ts) clear monitors, events, and groups; restore the 5-minute automatic incident threshold and 30-second refresh interval; disable global WAF bypass; and save a fixed test token. Special page states use request stubs. Each file should run independently. Tests run serially against a shared database, so do not start multiple browser test processes in parallel.

Automatic refresh tests use a controllable clock to verify polling, relative times, slow requests, and pausing in the background.

Ordering tests cover atomic D1 updates, conflicts with old snapshots, append order after group changes or group deletion, check-result writes during reordering, browser dragging, keyboard buttons, failure recovery, and races with automatic refresh.

On failure, screenshots and traces are saved in `test-results/`, which GitHub Actions uploads.

<a id="代码组织"></a>

## Code organization

Code is divided into `web / worker / shared` layers, with monitors, groups, events, settings, and status features inside each layer. See [architecture and code organization](architecture.md) for feature responsibilities, dependency directions, request and check flows, styles, and conventions for adding features.

<a id="部署配置"></a>

## Deployment configuration

`npm run deploy:prepare` validates environment variables, creates or reuses D1 by name, and generates `wrangler.deploy.json` without an API Token. The workflow rebuilds with `UPTIME_WRANGLER_CONFIG=wrangler.deploy.json`, then runs `npm run deploy:migrate` to apply remote migrations before publishing. See the [deployment guide](deployment.md) for variables and steps.

<a id="数据库迁移"></a>

## Database migrations

Use `migrations/NNNN_description.sql` for new database changes; do not edit migrations already applied in production. Prefer backward-compatible changes and migrate the database before deploying code. Run `npm run db:migrate` for local upgrades; the deployment workflow applies remote migrations. See the [deployment guide](deployment.md#rollback-and-database-recovery) for recovery.

| Migration                       | Changes and compatibility                                                                                                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0001_initial.sql`              | Initial monitor, detailed check, daily aggregate, and scheduler lease tables, plus statistics triggers.                                                                                                                                                                                                |
| `0002_global_settings.sql`      | Adds global WAF settings, token, and version fields. Legacy domain columns remain for compatibility with the old schema.                                                                                                                                                                               |
| `0003_flexible_intervals.sql`   | Expands intervals to integers from 1–60. Replaces the interval column and restores aggregate triggers in one transaction, preserving configuration, history, statistics, scheduler state, and foreign-key relationships.                                                                               |
| `0004_page_refresh.sql`         | Adds `page_refresh_seconds`, defaulting to 30 and accepting 0 or integer seconds from 5–3600. Preserves the settings version, WAF configuration, and monitor data; old code can still run.                                                                                                             |
| `0005_groups_events.sql`        | Adds groups, events, monitor name snapshots, updates, continuous failure timing, and suppression intervals. Preserves monitors and statistics. Existing monitors default to Ungrouped, and the automatic incident threshold defaults to 5 minutes. Historical outages are not published retroactively. |
| `0006_event_update_titles.sql`  | Adds nullable update titles, preserving historical descriptions, statuses, and associations. Old writes and automatic updates that omit the title store null. Apply the migration before deploying code; old code can still run.                                                                       |
| `0007_performance_settings.sql` | Adds plan, concurrency, batch size, and time budget settings, defaulting to Free / 4 / 10 / 50 seconds, plus an index for due monitors. Preserves existing settings versions, tokens, services, history, and leases; old code can still run.                                                           |

Migration tests prepare data with raw INSERT statements against the corresponding old schema, avoiding feature repositories that depend on the newest columns.

`0008_display_order.sql` adds an independent service order column and index, initializing order within each group from the previous creation time and ID order. It preserves group order, monitor versions, status, statistics, and failure timing. Apply the migration before deploying ordering support. Old code can still run but will not use service ordering, and services created by old code will not follow the append-order convention.

`0009_ungrouped_order.sql` adds a system ordering record named `__ungrouped__` to `monitor_groups`, with an empty internal name and an initial position after existing groups. Monitors continue to use `group_id = NULL`, and existing group and monitor data is unchanged. Apply the migration before deploying the corresponding code. New group ordering requests must include the system item; older pages that omit it receive an ordering conflict and must refresh before retrying. If an old read response lacks `ungrouped`, new pages display Ungrouped last. Rolling back to code that does not recognize the system item may expose it as a regular group; address this compatibility issue as part of the rollback.

<a id="兼容性说明"></a>

## Compatibility notes

- Before upgrading performance settings, apply `0007_performance_settings.sql`, then deploy the code. Older settings PATCH requests that omit `performance` retain the current performance settings. The new admin list no longer returns `limit`, so update the admin client together with it. Rolling back to old code restores the previous creation and scheduling limits; avoid rolling back this feature on deployments with more than 10 services.

- Event update reads support old free-form titles and untitled records. New writes use fixed stages, while untitled legacy `resolve` requests remain supported. See the [API reference](api.md#groups-and-events) for the complete rules.

- Interval upgrades preserve existing values. After saving intervals such as 1, 2, or 7 minutes, any rollback code must also support 1–60 minute validation.
- Older monitors without an individual `wafBypassEnabled` setting treat it as off. Legacy WAF domain columns remain but are no longer read or written, and domain lists no longer determine where credentials are sent. This change requires no new migration; see the [API reference](api.md#global-settings) for compatibility behavior.
- When upgrading from an older GET/HEAD WAF rule template, update the target site's Cloudflare rule to permit the currently supported HTTP methods.

<a id="界面语言"></a>

## Interface languages

The interface uses React Context and the type-safe bilingual dictionary in `src/web/i18n/messages.ts`, with no additional runtime dependency. Add both Chinese and English for new copy. English messages containing counts may use `one` / `other`. Dynamic values use named parameters. Persistent notifications store `message(key, params)`, and errors are normalized with `errorMessage`, then resolved in the current language during rendering.

Language precedence is a valid `localStorage["uptimeworker.locale"]` value (`zh-CN` / `en`), the browser's preferred language, then English. Any `zh` language variant uses Simplified Chinese. Manual changes synchronize across tabs on the same origin; if storage is disabled, switching still works on the current page. Page times use the browser's time zone, while statistics remain aggregated in UTC.

Shared validation and Worker errors use stable error codes and parameters, retaining older Chinese error descriptions. Fixed event stages translate only their display names; API values stay unchanged. Automatic events recognize existing system templates only when displayed, preserving the service name from the original title. Manual content and unknown historical text retain their original wording. No database migration is required.

Existing browser tests use `zh-CN`. `tests/e2e/platform/i18n.spec.ts` covers English, language persistence, switching across tabs, preserving edits, and mobile layouts in both languages. For new features, check labels, hints, errors, titles, and accessible names in both languages.

## Documentation maintenance

English is the default entry point, using `README.md` at the repository root and `docs/*.md`. Simplified Chinese uses `README.zh-CN.md` at the root and `docs/zh-CN/*.md`, with matching filenames for each guide. When changing features, APIs, or operating instructions, update both languages in the same change and keep sections, examples, and technical parameters aligned.

Keep an `English | 简体中文` switch at the top of every page linking to the same document in each language. Document indexes, links back to the README, and cross-references should stay in the current language. Legacy Chinese heading anchors on English pages preserve historical links. Retain these explicit anchors when renaming headings and update affected section references. Chinese guides use `../../` to reach source, test, or configuration files relative to the repository root.

Translate prose, tables, example explanations, and directory tree comments using operation names from the corresponding interface language. Keep commands, API fields, enums, error codes, configuration values, and numeric limits accurate. Preserve Chinese error text in real API responses and explain its compatibility purpose in English. Keep the license in its original language.

Before submitting, check that both versions cover the same content, language switches and relative links work, section anchors resolve, and JSON examples parse. Compare commands and technical parameters, then inspect tables, code blocks, and navigation in a Markdown preview. Run the documentation format check:

```sh
npx prettier --check README.md README.zh-CN.md "docs/**/*.md"
```
