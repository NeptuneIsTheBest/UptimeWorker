# Deployment guide

[English](deployment.md) | [简体中文](zh-CN/deployment.md)

[Back to README](../README.md)

Run the [Verify and deploy workflow](../.github/workflows/deploy.yml) manually in GitHub Actions. It creates the Worker and D1 database, applies migrations, and publishes static assets. Configure the Access application, sign-in policy, and custom domain in the Cloudflare dashboard.

## 1. Prepare the repository and hostname

Use a GitHub repository where you can run Actions and manage repository Secrets / Variables, and a Cloudflare account with Workers and Zero Trust enabled. Complete team and plan setup when opening Zero Trust for the first time; an existing team can be reused.

Choose the hostname before configuring Access:

| Access method      | What you need                                                                               | `WORKERS_DEV`                                  |
| ------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Custom domain only | An active domain in the same Cloudflare account and a hostname such as `status.example.com` | Set to **`false` before the first deployment** |
| Default hostname   | The account subdomain shown in Workers & Pages, such as `my-team.workers.dev`               | Leave unset or use `true`                      |

The Worker name defaults to `uptimeworker`. Choose `WORKER_NAME` first if changing it, for example to `team-status`. The default URL combines the Worker name and account subdomain: `https://uptimeworker.my-team.workers.dev`. Find the account subdomain under **Workers & Pages → Your subdomain**; it is separate from the Zero Trust team domain. A custom-domain-only deployment does not require enabling or visiting the Worker's default URL.

You do not need to create a Worker or D1 database beforehand, supply a database ID, or edit `wrangler.jsonc`. To update an existing installation, rerun the workflow. See [redeployment and a fresh installation](#redeployment-and-a-fresh-installation) for resetting data.

## 2. Obtain the Cloudflare account ID and API Token

### Account ID

Select the target account and open **Compute → Workers & Pages → Account Details → Account ID**, then copy it. Alternatively, search for `Copy account ID` using `Cmd/Ctrl + K`. Put this 32-character hexadecimal value in `CLOUDFLARE_ACCOUNT_ID`. A Zone ID or D1 Database ID is a different identifier. See [finding your account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/).

### API Token

Open the profile menu, then **My Profile → API Tokens → Create Token → Create Custom Token**. Give it a name such as `UptimeWorker deploy` and add:

| Scope   | Permission       | Level |
| ------- | ---------------- | ----- |
| Account | Workers Scripts  | Edit  |
| Account | D1               | Edit  |
| Account | Account Settings | Read  |

Under **Account Resources**, select **Include → Specific account → your target account**, matching the account ID above. Review the summary, create the Token, and copy the full secret shown on the result page into `CLOUDFLARE_API_TOKEN`. It is shown only once; copy the Token itself, not its name, ID, or a whole example command. Reuse an existing valid Token for subsequent deployments. See [creating an API Token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

The permissions above are sufficient when managing Access and custom domains through the dashboard as described here.

## 3. Configure Access and copy the team domain and AUD

### Protect the admin paths

Open **Zero Trust → Access controls (Access in some layouts) → Applications → Create new application (or Add an application) → Self-hosted**. Create an application such as `UptimeWorker Admin`.

Add two **Public hostname** entries to the same application. For `status.example.com`:

| Subdomain | Domain        | Path        |
| --------- | ------------- | ----------- |
| `status`  | `example.com` | `admin`     |
| `status`  | `example.com` | `api/admin` |

When the Path field already has a `/` prefix, enter `admin` and `api/admin`; the resulting paths are `/admin` and `/api/admin`. If the form uses a single hostname field, enter `status.example.com` in both entries and keep the paths separate. Omit `https://` and paths from hostname fields. For the default hostname, use `<WORKER_NAME>.<account-subdomain>.workers.dev`.

Protect both paths and their subpaths. Keep `/`, `/monitors/*`, `/events/*`, `/api/status`, `/api/monitors/*/history`, and `/api/events/*` public. Avoid requiring sign-in for the entire status hostname; also check any account-wide Worker protection. See [Access path matching](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) and [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

Add an **Allow** policy using **Include → Emails** with your administrator email, or a designated user group. Use an existing identity provider or email one-time PIN, then save the application. Both paths must use this application's AUD.

### Where to find each value

| GitHub setting       | Cloudflare location                                                                                                                   | Value to copy                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` | **Zero Trust → Settings → Team domain → Full domain**, then Copy; older layouts may call the section Team name and domain             | Full `your-team.cloudflareaccess.com` hostname, not the application name or status hostname |
| `ACCESS_AUD`         | **Access controls → Applications → application name (or Configure) → Additional settings → AUD tag → Application Audience (AUD) Tag** | 64-character hexadecimal string, not the application ID, policy ID, or API Token            |

References: [team domain](https://developers.cloudflare.com/cloudflare-one/faq/getting-started-faq/), [finding the AUD](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag). Dashboard layouts can change; look for these field names.

**Reuse an existing Access application** if its hostname matches and it protects both admin paths. Recreating the Worker does not require recreating Access. Deleting and recreating the Access application changes its AUD. The workflow passes these two values to the Worker; it does not create or modify Access applications.

## 4. Enter GitHub Secrets / Variables

In your own repository, open **Settings → Secrets and variables → Actions**. Use **Repository** settings. This workflow does not select a GitHub Environment, so settings saved only under an Environment are not automatically available.

Under **Secrets → New repository secret**, add:

| Name                    | Secret                              |
| ----------------------- | ----------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Full Token from step 2              |
| `CLOUDFLARE_ACCOUNT_ID` | 32-character Account ID from step 2 |

Switch to **Variables → New repository variable**, and add:

| Name                 | Value                                                                               | Required?                     |
| -------------------- | ----------------------------------------------------------------------------------- | ----------------------------- |
| `ACCESS_TEAM_DOMAIN` | `your-team.cloudflareaccess.com` from step 3; an `https://` prefix is also accepted | Yes                           |
| `ACCESS_AUD`         | 64-character AUD from step 3                                                        | Yes                           |
| `WORKERS_DEV`        | `false` for custom-domain-only access; defaults to `true`                           | For custom-domain-only access |
| `WORKER_NAME`        | Your chosen name; defaults to `uptimeworker`                                        | No                            |
| `D1_DATABASE_NAME`   | Your chosen name; defaults to `<WORKER_NAME>-db`, such as `uptimeworker-db`         | No                            |
| `SITE_NAME`          | Display name for the status page; defaults to `UptimeWorker`                        | No                            |

`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` can also be Repository Secrets; existing settings need not be moved. A Variable takes precedence over a Secret with the same name, so avoid conflicting values. Do not add quotes or keep angle-bracket placeholders.

Worker and database names start with a lowercase letter and contain lowercase letters, digits, and hyphens. Give each instance distinct names; an existing database with the same name is reused. See [deployment configuration](development.md#deployment-configuration) for length limits.

## 5. Run deployment and check the result

1. Open **Actions**, then select **Verify and deploy** in the left sidebar.
2. Click **Run workflow**, select **main**, and click **Run workflow** in the expanded panel. Enable Actions first if prompted after forking.
3. Open the new run and wait for both `verify` and `deploy` to succeed. Other branches run verification without deploying.
4. Check these steps in the `deploy` logs:

| Workflow step                                | Expected result                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Create or reuse D1 and prepare configuration | `Created D1 database: ...` for a new database, or `Reusing D1 database: ...` for an existing one |
| Build with production bindings               | Successful production build                                                                      |
| Apply database migrations                    | Migrations applied to a new database; already applied migrations are skipped                     |
| Publish Worker and static assets             | Worker and assets published, with the `* * * * *` Cron trigger                                   |

If Run workflow is missing, select the specific workflow rather than All workflows, check repository write access, and check that the workflow is on the default branch. See [manually running a GitHub workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

For default-hostname deployments, visit `https://<WORKER_NAME>.<account-subdomain>.workers.dev`. For custom-domain-only deployments, continue below; having no reachable site before binding the domain is expected.

## Using only a custom domain

**First deployment order: configure Access → set `WORKERS_DEV=false` → run the workflow to create the Worker → bind the custom domain.** The default hostname can stay disabled throughout.

1. Under Cloudflare **Compute → Workers & Pages**, select the Worker and open **Domains → Add Domain**. Older layouts use **Settings → Domains & Routes → Add → Custom Domain**.
2. In the current **Connect domain** dialog, search for and select the root domain `example.com`. Enter `status` in **Subdomain**, keep **Enable for → Production**, and click **Add domain**. In older single-field forms, enter the full `status.example.com` hostname. Omit `https://`, paths, and `/*`. Wait for activation; Cloudflare manages the DNS record and certificate. See [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
3. Check that Access protects this hostname's `/admin` and `/api/admin` paths, then visit `https://status.example.com`.
4. In **Domains**, confirm both **Production** and **Preview** Worker URL switches are off. Older layouts list these under Domains & Routes. Deployment sets `workers_dev=false` and `preview_urls=false`; keep `WORKERS_DEV=false` in GitHub so later deployments retain this behavior.

Updating an existing Worker preserves dashboard domain bindings. **After deleting and recreating a Worker, check and rebind its domain.** An Access application does not create the Worker domain binding. If a DNS record conflicts, check its purpose before changing it.

## Initial production checks

1. In a signed-out browser session, open `/` and `/api/status`: both should be public. `/admin` and `/api/admin/monitors` should require Access sign-in.
2. Sign in with an allowed email and check that the monitor list loads. An empty list is expected with a new D1 database.
3. Add reachable public HTTP and TCP monitors and run **Test connection**. Immediate tests verify connectivity without updating status or history.
4. Wait for scheduled checks, then confirm last-check times, latency, and history. New or changed Cron settings may take up to 15 minutes to propagate; use Test connection to check connectivity while waiting. Check **Settings → Trigger events → Cron triggers** for `* * * * *`. See [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
5. Verify public and admin access on the custom domain and confirm default and preview URLs remain disabled. For targets protected by WAF, follow [monitor configuration](configuration.md#cloudflare-waf-bypass).

## Troubleshooting

| Symptom                                                          | What to check                                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Missing required setting: ...`                                  | Setting names and Repository scope in step 4; configure your own repository                         |
| Invalid Account ID, team domain, or AUD                          | Copy from steps 2–3; check for confusion with a Zone ID, application ID, or status hostname         |
| `Cloudflare D1 API failed` or an authentication/permission error | Token validity, all three permissions, and matching Account Resources and Account ID                |
| Admin returns 401/403 after sign-in, or the list fails to load   | Both admin paths, the Allow policy, the application's AUD, and Variables overriding correct Secrets |
| Public home page requires sign-in                                | Whole-hostname protection or account-wide Worker protection                                         |
| Deployment succeeds but the custom hostname fails                | Worker domain binding, DNS, and certificate; Access alone does not create a binding                 |
| Old monitors remain after redeployment                           | The workflow reuses D1 by name; redeployment does not reset data                                    |
| No scheduled results                                             | Monitor enabled state, Cron configuration and propagation, and `scheduled_run` Worker logs          |

## Redeployment and a fresh installation

For ordinary updates, rerun the workflow on `main` with unchanged Worker and database names. Confirm `Reusing D1 database` and check existing monitors and history.

Before testing a fresh installation, record monitor parameters, group order, global settings, custom domains, and Access configuration; export D1 if data must be preserved. WAF secrets and custom request credentials may be stored in the database. Recording only monitor names and targets is insufficient, and the admin UI does not reveal the saved WAF secret.

Worker and D1 are separate resources. **Deleting a Worker does not delete D1.** Deleting D1 removes monitors, history, events, and global settings. When intentionally resetting, identify the database behind the Worker's `DB` binding, then delete the Worker under **Settings** and the database under **Storage & databases → D1 SQLite Database → your database → Settings**. See [Worker and D1 deletion](https://developers.cloudflare.com/d1/get-started/#7-optional-delete-your-database).

Run the workflow using the existing GitHub settings, confirm `Created D1 database`, rebind the custom domain, and restore monitors and any required settings. Keeping the Access application preserves its AUD. See [development and maintenance](development.md#rollback-and-database-recovery) for rollback and database recovery.
