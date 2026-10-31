# Development and maintenance

[English](development.md) | [简体中文](zh-CN/development.md)

[Back to README](../README.md)

## Local environment

See [Local development in the README](../README.md#local-development) for initial installation and startup. Run all commands below from the repository root.

`DEV_ACCESS_BYPASS=true` in [`.dev.vars.example`](../.dev.vars.example) applies only to localhost / loopback addresses in Vite development mode. Production builds remove this branch. Keep the development server accessible only from the local machine.

Development mode bypasses the Worker's public response cache. The local database lives in `.wrangler/state/`. Browser tests use a separate, disposable `.wrangler/e2e-state/`, isolated from development and cloud data.

Local Cron does not run automatically on a schedule. While the development server is running, trigger a run manually:

```sh
curl 'http://127.0.0.1:5173/cdn-cgi/local/scheduled?cron=*+*+*+*+*'
```

Repeated triggers in the same minute, or triggers while the previous run is unfinished, are skipped. After creating or editing a monitor, wait for the next time window or use **Test connection** in the admin console. See [checks, statistics, and retention](configuration.md#checks-statistics-and-retention) for scheduler behavior.

## Verification commands

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run check` runs type checks, unit / D1 integration tests, and a production build. Build checks cover D1 and Cron configuration and removal of development authentication. Browser tests run separately; GitHub Actions runs both.

Run individual checks as needed:

| Command                                                     | Purpose                                     |
| ----------------------------------------------------------- | ------------------------------------------- |
| `npm run typecheck`                                         | TypeScript type checks                      |
| `npm test`                                                  | Unit and D1 integration tests               |
| `npm run test:watch`                                        | Vitest in watch mode                        |
| `npm run test:performance`                                  | Aggregation timings and D1 row-usage checks |
| `npm run build`                                             | Production build and output checks          |
| `npm test -- tests/platform/api.test.ts`                    | API boundary checks only                    |
| `npm run test:e2e -- tests/e2e/monitors/management.spec.ts` | Run one browser test file independently     |
| `npm run format`                                            | Format the entire repository with Prettier  |

For selected files, use `npx prettier --write <file-path>`; replace `--write` with `--check` to check without changing files.

To use a locally installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable path.

### Performance benchmarks

`npm run test:performance` uses disposable local D1 data: 10, 100, and 500 monitors with 90 daily rows each, plus 10,000 events with five still open. It compares aggregation output with the original algorithm and reports median local execution times. `snapshotRowsRead` covers the monitor/statistics batch; event metrics distinguish parent selection from the full event batch. Timings are informational, while correctness and D1 row budgets are asserted. The benchmarks are also part of `npm test`.

An ordinary same-day successful check writes 6 rows in the local D1 fixture, compared with 7 before the composite-key change; replay writes none. The first sample of a day and incident transitions have additional writes. Public event parent selection must read fewer than 100 rows in the event fixture. These are isolated measurements, not total account usage or production CPU guarantees; use Worker CPU metrics and `scheduled_run` row counters after deployment.

## Test responsibilities and isolation

| Tests                                                                         | Main responsibilities                                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [monitors](../tests/features/monitors/)                                       | Configuration, HTTP/TCP probes, WAF, scheduling, and statistics               |
| [groups](../tests/features/groups/) / [ordering](../tests/features/ordering/) | Group membership, atomic ordering, conflicts, and preservation of check state |
| [events](../tests/features/events/)                                           | Event lifecycle, stages, suppression, recovery, and transactions              |
| [settings](../tests/features/settings/)                                       | Settings validation, tokens, and concurrent saves                             |
| [status](../tests/features/status/)                                           | Overall status, maintenance boundaries, and data errors                       |
| [platform](../tests/platform/)                                                | API contracts, authentication, caching, migrations, and deployment            |
| [performance](../tests/performance/)                                          | Aggregation equivalence, timings, and D1 row budgets                          |
| [Browser tests](../tests/e2e/)                                                | Page interactions, refreshes, forms, ordering, and responsive layouts         |

Unit tests use HTTP / socket test doubles and local RSA keys for JWTs. D1 integration tests run migrations, SQL, and triggers in local workerd. D1 and browser tests require loopback port access.

Use the [API test client](../tests/support/api-client.ts) for identity, headers, and JSON requests, and place assertions in the relevant feature tests. Browser tests focus on interactions; use a controllable clock for refresh and timing behavior.

The [browser fixtures](../tests/e2e/support/fixtures.ts) reset data and settings before each case. Each file must run independently; tests share a database and run serially, so do not start multiple browser test processes in parallel. Failures save screenshots and traces to `test-results/`, which GitHub Actions uploads.

## Code organization

Code is divided into `web / worker / shared` layers, with monitors, groups, events, settings, and status features inside each layer. See [architecture and code organization](architecture.md) for feature responsibilities, dependency directions, request and check flows, styles, and conventions for adding features.

## Deployment configuration

`npm run deploy:prepare` validates environment variables, creates or reuses D1 by name, and generates `wrangler.deploy.json` without an API Token. The workflow rebuilds with `UPTIME_WRANGLER_CONFIG=wrangler.deploy.json`, then runs `npm run deploy:migrate` to apply remote migrations before publishing. See the [deployment guide](deployment.md) for variables and steps.

## Database migrations

`0001_initial.sql` is the initial-release baseline for new databases. It creates the complete monitoring, grouping, event, settings, and scheduler schema, including indexes and triggers. It seeds global settings, the scheduler lease row, and the internal `__ungrouped__` ordering record at position `0`; ungrouped monitors retain `group_id = NULL`.

The baseline stores check results in a `WITHOUT ROWID` table keyed by `(monitor_id, scheduled_at)`, with indexes for time-based history and retention. Open and closed event partial indexes bound public event selection; the group-order index also serves monitor group lookups.

Use a fresh local database or a separate persistence directory to test initialization; existing local databases are not automatically reset. Databases initialized with an earlier development baseline are not upgraded by reapplying `0001_initial.sql`. Preserve any needed data before choosing a fresh directory or explicitly rebuilding disposable development data.

Add subsequent database changes as `migrations/0002_description.sql`, then continue in numerical order. Do not edit migrations already applied in production. Apply migrations before deploying code. Run `npm run db:migrate` locally; the deployment workflow applies remote migrations. Review [database recovery](deployment.md#rollback-and-database-recovery) before rollbacks.

Migration tests initialize an empty D1 database, check defaults, constraints, indexes, and foreign keys, and verify check aggregation and cascading deletion. Feature tests cover automatic incident lifecycle and display ordering. Test fixtures apply all SQL migrations in numerical order.

## Interface languages

The interface uses React Context and the type-safe dictionary in `src/web/i18n/messages.ts`. Add both Chinese and English for new copy, with named parameters for dynamic values and `one` / `other` for English plurals. Store persistent notifications as `message(key, params)` and normalize errors with `errorMessage` so they resolve in the current language during rendering.

Shared validation and Worker errors use stable codes and parameters. Translate event stages and automatic-event templates for display; keep API values, monitor names, and user content unchanged.

Browser tests default to `zh-CN`; see [language tests](../tests/e2e/platform/i18n.spec.ts) for coverage. Check new labels, hints, errors, titles, and accessible names in both languages.

## Documentation maintenance

The default English docs use `README.md` and `docs/*.md`; Simplified Chinese uses `README.zh-CN.md` and matching files in `docs/zh-CN/`. Update both versions together, keeping sections, examples, and technical values aligned.

Keep the README focused on capabilities and guides on tasks. Document API contracts in the API reference and implementation details in the development or architecture guide. Avoid exhaustive UI behavior descriptions.

Language switches link to the corresponding document in each language; other cross-references stay in the selected language. Chinese guides use `../../` for repository files. Translate explanations and interface labels while preserving commands, API fields, enums, error codes, configuration values, and the license.

Check relative links, anchors, JSON examples, and Markdown rendering, then run:

```sh
npx prettier --check README.md README.zh-CN.md "docs/**/*.md"
```
