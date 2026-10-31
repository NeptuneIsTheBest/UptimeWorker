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

Repeated triggers in the same minute, or triggers while the previous run is unfinished, are skipped. After creating or editing a monitor, wait for the next time window or use **Test connection** in the admin console. See [scheduling and capacity model](architecture.md#scheduling-and-capacity-model) for scheduler behavior.

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

`npm run test:performance` uses disposable local D1 data: 10, 100, and 500 monitors with 90 daily rows each, plus 10,000 events with five still open. It compares aggregation output with a reference implementation and reports median local execution times. `snapshotRowsRead` covers the monitor/statistics batch; event metrics distinguish parent selection from the full event batch. Timings are informational, while correctness and D1 row budgets are asserted. The benchmarks are also part of `npm test`.

An ordinary same-day successful check writes 6 rows in the local D1 fixture; replay writes none. The first sample of a day and incident transitions have additional writes. Public event parent selection must read fewer than 100 rows in the event fixture. These fixture measurements isolate database work. Measure production load with Worker CPU metrics and `scheduled_run` row counters, as described under [operational monitoring](#operational-monitoring).

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

The manual [Verify and deploy workflow](../.github/workflows/deploy.yml) deploys only from `main`; other branches verify. Production deployments use one concurrency group with active runs allowed to finish. See [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) for queue behavior.

1. Verification installs dependencies, runs `npm run check`, installs Chromium, and runs `npm run test:e2e`.
2. `npm run deploy:prepare` validates environment variables and finds D1 by exact name, creating it when absent. An existing database is reused. A concurrent create conflict triggers a second lookup; an ambiguous name or invalid identity stops preparation.
3. The script reads `wrangler.jsonc` and writes `wrangler.deploy.json` with the Worker name, D1 binding, Access values, site name, and domain switches. It excludes the API Token.
4. The workflow rebuilds with `UPTIME_WRANGLER_CONFIG=wrangler.deploy.json`, applies remote migrations with `npm run deploy:migrate`, then publishes the Worker and assets. A failed step stops later steps.

Access settings in GitHub Variables take precedence over Secrets. Worker and D1 names begin with a lowercase letter, contain lowercase letters, digits, and hyphens, and are at most 63 characters. The default `<WORKER_NAME>-db` limits `WORKER_NAME` to 60 characters; an explicit `D1_DATABASE_NAME` allows each name up to 63. Each instance needs its own names because preparation reuses the database identified by name.

`WORKERS_DEV` accepts `true` or `false` after trimming and case normalization, defaults to true, and is applied on every deployment. Preview URLs are disabled. Custom-domain bindings are preserved. Direct deployment with the base `wrangler.jsonc` uses its own settings, where `workers_dev` is true. User-facing setup and defaults are in the [deployment guide](deployment.md).

## Database migrations

`0001_initial.sql` is the initial-release baseline for new databases. It creates the complete monitoring, grouping, event, settings, and scheduler schema, including indexes and triggers. It seeds global settings, the scheduler lease row, and the internal `__ungrouped__` ordering record at position `0`; ungrouped monitors retain `group_id = NULL`.

The baseline stores check results in a `WITHOUT ROWID` table keyed by `(monitor_id, scheduled_at)`, with indexes for time-based history and retention. Open and closed event partial indexes bound public event selection; the group-order index also serves monitor group lookups.

Before the first release, schema changes update this baseline directly. Initialize a fresh local database with `npm run db:migrate`; use a separate persistence directory when checking initialization. The deployment workflow applies the same SQL through the production D1 binding.

Migration tests initialize an empty D1 database, check defaults, constraints, indexes, and foreign keys, and verify check aggregation and cascading deletion. Feature tests cover automatic incident lifecycle and display ordering. Test fixtures apply all SQL migrations in numerical order.

## Operational monitoring

Inspect Worker Cron logs and CPU metrics alongside D1 Row Metrics. A `scheduled_run` log includes `claimed`, `checked`, `stored`, `rowsRead`, `rowsWritten`, and `elapsedMs`. `checked` counts completed probes; `stored` counts accepted samples after version and lease checks. Database counters sum D1 result metadata. `elapsedMs` measures total wall time, including network and database waits; use the platform's CPU metric for execution time.

For ten monitors checked every minute, the model yields 14,400 daily scheduled checks. A default batch of ten HTTP monitors reserves 40 HTTP subrequests. Probe requests and Worker invocations are separate counts. Actual usage also includes public/admin traffic, indexes, triggers, event changes, and cleanup. Compare account totals with the [capacity model](architecture.md#scheduling-and-capacity-model), especially after changing frequency, concurrency, or batch size.

After redeploying, confirm that preparation reports `Reusing D1 database`, and that monitors and history remain available. For custom-domain-only installations, check the Production and Preview URL switches after redeployment as well as public access and admin sign-in.

## Rollback and database recovery

Worker rollback restores a code version. D1 recovery restores database state and is handled separately through [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

1. Identify the Worker version and database state to restore. Check the schema required by that code and the writes that would be lost by restoring an earlier database point.
2. Roll back the Worker version in Cloudflare. If database recovery is needed, use D1 Time Travel to select and restore the required point.
3. Verify Access sign-in, monitor configuration, scheduled results, and public status after recovery.

A failed deployment leaves completed database migrations applied. Review their SQL and the target Worker schema before choosing a recovery point.

## Interface languages

The interface uses React Context and the type-safe dictionary in `src/web/i18n/messages.ts`. Add both Chinese and English for new copy, with named parameters for dynamic values and `one` / `other` for English plurals. Store persistent notifications as `message(key, params)` and normalize errors with `errorMessage` so they resolve in the current language during rendering.

Shared validation and Worker errors use stable codes and parameters. Translate automatic event bodies by stage and titles using the saved publication-time name. Manual content stays as entered. Keep API fields and stage values language-independent; see [event lifecycle](architecture.md#event-lifecycle).

Browser tests default to `zh-CN`; see [language tests](../tests/e2e/platform/i18n.spec.ts) for coverage. Check new labels, hints, errors, titles, and accessible names in both languages.

## Documentation maintenance

The default English docs use `README.md` and `docs/*.md`; Simplified Chinese uses `README.zh-CN.md` and matching files in `docs/zh-CN/`. Update both versions together, keeping sections, examples, and technical values aligned.

Keep the README focused on capabilities and setup, and guides focused on completing tasks. Interface hints cover inputs, immediate effects, and the next action. Put field constraints, redirects, and error codes in the API reference; scheduling, formulas, and event boundaries in architecture; deployment internals, diagnostics, and recovery here. Describe the current initial-release contract without historical upgrade narratives.

Language switches link to the corresponding document in each language; other cross-references stay in the selected language. Chinese guides use `../../` for repository files. Translate explanations and interface labels while preserving commands, API fields, enums, error codes, configuration values, and the license.

Check relative links, anchors, JSON examples, and Markdown rendering, then run:

```sh
npx prettier --check README.md README.zh-CN.md "docs/**/*.md"
```
