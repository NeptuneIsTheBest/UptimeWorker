# Deployment guide

[English](deployment.md) | [简体中文](zh-CN/deployment.md)

[Back to README](../README.md)

Verify and deploy manually through GitHub Actions using the repository's [Verify and deploy workflow](../.github/workflows/deploy.yml).

## 1. Configure Cloudflare

Enable Cloudflare Workers, the account's `workers.dev` subdomain, and Zero Trust. Create an API Token scoped only to the target account with these permissions:

| Scope   | Permission             |
| ------- | ---------------------- |
| Account | Workers Scripts: Edit  |
| Account | D1: Edit               |
| Account | Account Settings: Read |

Deployment uses `workers.dev` by default, so the API Token only needs the permissions above. Configure Access policies in the dashboard.

## 2. Create an Access application

In **Zero Trust → Access → Applications**, create a **Self-hosted** application and add these two public hostnames / paths to the same application:

```text
<WORKER_NAME>.<your workers.dev subdomain>.workers.dev/admin
<WORKER_NAME>.<your workers.dev subdomain>.workers.dev/api/admin
```

Replace `<WORKER_NAME>` with the actual Worker name used for deployment. It must match the `WORKER_NAME` value in GitHub Actions below, which defaults to `uptimeworker`.

Protect these paths and their subpaths. Keep the home page `/`, monitor details `/monitors/*`, event details `/events/*`, and `/api/status`, `/api/monitors/*/history`, and `/api/events/*` public. If account-wide Worker protection is enabled, first configure a public exception for this Worker, then protect the admin paths.

Configure an **Allow** policy limited to your email address or a designated user group. Use an existing identity provider or an email one-time PIN. Both paths use the same application's AUD.

Record the team domain, such as `your-team.cloudflareaccess.com`, and the **Application Audience (AUD) Tag**. The Worker validates sign-in credentials and denies admin access if Access is not configured or the credentials are invalid.

See [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) and [Access path matching](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) for detailed rules. Custom domain setup is covered [below](#using-only-a-custom-domain).

## 3. Configure GitHub

Open the repository's **Settings → Secrets and variables → Actions**:

| Type               | Name                    | Value                                                            |
| ------------------ | ----------------------- | ---------------------------------------------------------------- |
| Secret             | `CLOUDFLARE_API_TOKEN`  | The Token created above                                          |
| Secret             | `CLOUDFLARE_ACCOUNT_ID` | Your 32-character Cloudflare account ID                          |
| Variable or Secret | `ACCESS_TEAM_DOMAIN`    | The team domain; may include `https://`                          |
| Variable or Secret | `ACCESS_AUD`            | The Access application's 64-character AUD                        |
| Variable, optional | `WORKER_NAME`           | Defaults to `uptimeworker`                                       |
| Variable, optional | `WORKERS_DEV`           | Defaults to `true`; set to `false` to disable the default domain |
| Variable, optional | `D1_DATABASE_NAME`      | Defaults to `<WORKER_NAME>-db`                                   |
| Variable, optional | `SITE_NAME`             | Status page site name; defaults to `UptimeWorker`                |

If Access settings exist in both Variables and Secrets, the values in Variables take precedence.

Worker / D1 names must start with a lowercase letter, contain only lowercase letters, digits, and hyphens, and be at most 63 characters long. When using the default database name `<WORKER_NAME>-db`, `WORKER_NAME` is limited to 60 characters to leave room for the suffix. If you explicitly set `D1_DATABASE_NAME`, each name can be up to 63 characters long. Use distinct names for each instance to avoid reusing another application's database.

In **Actions → Verify and deploy → Run workflow**, select `main` and run the workflow manually. It performs these steps:

1. Install dependencies, then run type checks, unit / D1 integration tests, a production build, and Chromium browser tests.
2. Validate deployment variables and find the D1 database by name. Reuse it if it exists, or create it otherwise.
3. Generate the production configuration, rebuild, and apply database migrations.
4. Publish the Worker and static assets, and enable Cron to run every minute.

The workflow runs manually and deploys only from `main`; other branches run verification only. Production deployments run one at a time. See [GitHub's concurrency rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) for queue behavior.

A failed step stops the remaining steps of that deployment. Existing databases are never deleted or recreated. See the [development guide](development.md#deployment-configuration) for configuration generation.

The default deployment URL is `https://<WORKER_NAME>.<your-subdomain>.workers.dev`. When the default domain is disabled, use the custom domain already bound to the Worker. A newly added Cron trigger may take a few minutes to propagate; see [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Using only a custom domain

Bind the custom domain to the same Worker in the Cloudflare dashboard. Add its `/admin` and `/api/admin` paths and their subpaths to the Access application. Subsequent deployments preserve the domain binding.

Set `WORKERS_DEV` to `false` in GitHub Actions Variables, then rerun the workflow on `main`. Every deployment applies this setting; disabling the default domain only in the Cloudflare dashboard will be overridden by a later deployment. See the [Cloudflare documentation](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

`WORKERS_DEV` accepts `true` / `false` and defaults to `true`; invalid values stop deployment. Preview URLs are always disabled. This variable applies to GitHub Actions; deploying directly with `wrangler.jsonc` leaves the default domain enabled.

## Initial production checks

1. Confirm that the home page is accessible without signing in and that `/admin` redirects to Access sign-in.
2. After signing in, add a public HTTP target and a TCP target that permits outbound connections, then run **Test connection** for each.
3. Wait for Cron to run and confirm that check results, response times, and history appear on the status and detail pages.
4. Deploy again. Confirm that the logs show `Reusing D1 database` and that monitors and history are retained.
5. Inspect the Worker's Cron logs, CPU usage, and D1 Row Metrics in Cloudflare.
6. If `WORKERS_DEV=false`, confirm after both the first and subsequent deployments that the Worker's Production and Preview URL switches are off, and that the custom domain's home page and admin sign-in work.

## Rollback and database recovery

Handle code rollback and database recovery separately: roll back the Worker version in Cloudflare, and use D1 Time Travel to recover the database when needed after assessing the data impact. A failed deployment does not undo completed migrations. Before rolling back, review [database migrations](development.md#database-migrations).
