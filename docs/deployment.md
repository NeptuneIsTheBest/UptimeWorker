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

Record the team domain, such as `your-team.cloudflareaccess.com`, and the **Application Audience (AUD) Tag** for the next step.

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

Give each instance its own Worker and database names, for example `team-status` and `team-status-db`. Use lowercase names starting with a letter. Exact naming rules and variable precedence are in [deployment configuration](development.md#deployment-configuration).

In **Actions → Verify and deploy → Run workflow**, select `main` and run the workflow. It verifies the project, creates or reuses the named D1 database, initializes its schema, and publishes the Worker and static assets with a per-minute Cron trigger. Other branches run verification only.

The default deployment URL is `https://<WORKER_NAME>.<your-subdomain>.workers.dev`. When the default domain is disabled, use the custom domain already bound to the Worker. A newly added Cron trigger may take a few minutes to propagate; see [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Using only a custom domain

Bind the custom domain to the same Worker in the Cloudflare dashboard. Add its `/admin` and `/api/admin` paths and their subpaths to the Access application. Subsequent deployments preserve the domain binding.

Set `WORKERS_DEV` to `false` in GitHub Actions Variables, then rerun the workflow on `main`. This setting is applied on every deployment; preview URLs are disabled. See [workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## Initial production checks

1. Open the home page without signing in, then visit `/admin` and sign in through Access.
2. Add an HTTP monitor and a TCP monitor for public targets, and run **Test connection**.
3. Wait for scheduled checks and confirm status, response times, and history appear.
4. For a custom-domain-only deployment, check the public page and admin sign-in on that domain, and confirm the Worker's Production and Preview URL switches are off.

For deployment internals, usage measurement, and recovery procedures, see [development and maintenance](development.md#deployment-configuration).
