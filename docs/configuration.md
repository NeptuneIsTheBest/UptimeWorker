# Monitor configuration

[English](configuration.md) | [简体中文](zh-CN/configuration.md)

[Back to README](../README.md)

## Basic configuration

In **Monitor management**, choose **Add monitor**, enter a name and public target address, then save.

| Setting        | Options                                                                |
| -------------- | ---------------------------------------------------------------------- |
| Check type     | HTTP/HTTPS or TCP port                                                 |
| Check interval | 1–60 whole minutes; default 1                                          |
| Timeout        | 1–30 seconds                                                           |
| HTTP method    | GET / HEAD / POST / PUT / PATCH / DELETE / OPTIONS                     |
| HTTP success   | The response matches the configured status-code range and any keywords |
| TCP success    | A connection is established to the target port                         |

Use **Test connection** to check the saved configuration immediately. Scheduled checks update the status and history; an immediate test leaves both unchanged. All request methods run repeatedly at the configured interval.

HTTP targets must be public URLs. For TCP, use a public hostname or IP; private addresses, Cloudflare IPs, and port 25 are unavailable. Use HTTP checks for services behind Cloudflare's proxy.

Pause or resume checks from the monitor list. Editing check parameters resets the current status until the next check; changing the name or group preserves it. Deleting a monitor permanently removes its check history.

## Automatic page refresh

Set the interval under **Global settings → Automatic page refresh**. It applies to public and admin pages. Choose off, 15 / 30 / 60 seconds, or a custom whole number from 5–3600 seconds; the default is 30 seconds.

Refreshes preserve filters and unsaved edits. Use **Refresh now** when automatic refresh is off, including once after re-enabling it on another page. **Updated** shows when the page last fetched data; **Last checked** shows when the service was checked.

## Server groups and events

Use **Manage groups** to create, rename, reorder, or delete groups. Assign monitors in the monitor editor. Drag a handle or use the move buttons to reorder groups and services; changes save automatically. Services move within their group, and new or reassigned services appear at the end. Deleting a group moves its services to Ungrouped.

The home page supports search, status and group filters, and collapsible groups. It shares the admin console's display order. Ungrouped can be reordered; the browser remembers collapsed groups separately for each page.

On the **Events** tab, enter a title and description, associate monitors, then publish an incident or scheduled maintenance. Use **Add update** to record progress. Choosing **Completed** or **Resolved** also closes a manual event. Event titles link to a shareable timeline.

The admin event list shows all open incidents and maintenance events in **Open and scheduled events** at the top, including overdue maintenance that has not been completed. **Event history** appears below with 20 closed events per page. Both sections show the most recently updated events first. Browsing or refreshing history keeps all open events in the top section; publishing, editing, or adding an update returns to the latest history page.

New incidents start with an **Investigating** description, new maintenance events with a **Scheduled** description, and progress updates with an **Updated** description. Changing the event type or progress stage replaces blank or unedited generated descriptions and preserves nonempty manual edits. **Use stage description** replaces the current text and resumes automatic updates. Editing an existing event preserves its saved description; the button uses the initial stage for its event type. Generated drafts follow the interface language, while manual edits and saved descriptions keep their original text. Clearing a description still requires entering text before submitting.

Enter maintenance times in your browser's time zone and confirm completion manually. During the scheduled window, checks and uptime statistics continue while new automatic incidents are paused. The home page shows all open events and the 20 most recent closed events; monitor pages show associated events.

Under **Global settings → Automatic outage incidents**, set how long checks must keep failing before an incident is published. The default is 5 minutes; use 1–1440 minutes, or 0 to turn publication off. A successful check resolves an automatic incident. You can add response notes to it, and delete it after it closes.

Events are retained when a monitor is deleted, along with its saved name. Open automatic incidents stop tracking. Detailed event timing and suppression rules are in the [architecture guide](architecture.md#event-lifecycle).

## Advanced HTTP configuration

Expand **Advanced settings** in the monitor editor:

- **Custom request headers**: add Authorization, Cookie, API keys, or other headers, up to 8 KiB in total. Use the final check URL when sending credentials.
- **Request body**: choose text or JSON, up to 16 KiB. Content-Type is set automatically and can be overridden with a custom header. GET and HEAD use no body.
- **Response validation**: enter one keyword per line, up to 20 per list and 256 characters each. All required keywords must appear and all excluded keywords must be absent. Select **Ignore case** as needed. Leave both lists empty to check only the status code; HEAD checks the status code only.

Checks follow up to three redirects. Configure the final URL for requests with a body that would otherwise redirect to another origin. The [API reference](api.md#http-request-and-response-rules) describes request validation, redirects, and probe errors.

## Cloudflare WAF bypass

For sites you manage in Cloudflare, configure a Skip rule and a shared token:

1. Enable **WAF bypass** on each HTTP monitor and save it. Use the site's full hostname and HTTPS check URL.
2. Open **Global settings**, generate or enter a 32–256 character token, and copy it before saving. Saved tokens are shown as **Configured**.
3. Expand **Configure a Cloudflare Skip rule** and copy the complete rule. When copying the template, replace `<YOUR_TOKEN>` with your saved token.
4. In the target site's **Security rules**, create a custom rule with that expression. Choose **Skip**, select the features to skip, and place the rule before the relevant blocking rules. Standard Bot Fight Mode requires a separate configuration because Skip cannot bypass it. See [Cloudflare's supported features](https://developers.cloudflare.com/waf/custom-rules/skip/options/).
5. Save the rule, enable the global WAF switch, and save settings. Run **Test connection** and check Cloudflare Security Events for the rule match.

Leave the token blank to keep it. When changing the token or monitor domains, update the rules on the target sites. The [API reference](api.md#waf-credentials) describes token validation and delivery.

## Checks, statistics, and retention

The status page shows current service health, 30-day uptime, and 90 days of daily history. Uptime is the share of successful checks. Days use UTC; individual check times use your browser's time zone.

Monitor details show response times and all checks from the last 24 hours. Detailed checks are retained for 7 days, daily summaries for 90 days, and events indefinitely. Before the first check, a monitor shows **Awaiting checks**; after two check intervals without an update, it shows **Stale data**.

See [statistics and retention](architecture.md#statistics-and-retention) for aggregation formulas and status rules.

## Performance settings and capacity estimates

Use the **Performance** tab to adjust scheduling. Estimates respond to your current input; saved settings apply to the next run.

| Setting                | Default    | Range          |
| ---------------------- | ---------- | -------------- |
| Workers plan           | Free       | Free / Paid    |
| Probe concurrency      | 4          | 1–6            |
| Maximum checks per run | 10         | 1–500          |
| Time budget per run    | 50 seconds | 40–180 seconds |

Select the plan matching your Cloudflare subscription. The setting chooses the application's budgets; manage the subscription in Cloudflare.

The panel estimates checks, HTTP requests, retained samples, and minimum base writes. It also simulates all enabled services becoming due together. If checks are deferred regularly, increase the batch or time budget, or lengthen check intervals. View actual Worker CPU and D1 usage in Cloudflare.

Calculation details are in the [capacity model](architecture.md#scheduling-and-capacity-model); logging and measurement are in [operational monitoring](development.md#operational-monitoring).
