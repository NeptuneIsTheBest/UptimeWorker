# UptimeWorker

[English](README.md) | [简体中文](README.zh-CN.md)

A service monitoring website built on Cloudflare Workers and D1, with a public status page and an admin console.

## Features

- Responsive interface in English and Simplified Chinese, with overall status, service details, 24-hour response times, 30-day uptime, and a 90-day status history.
- HTTP/HTTPS and TCP port checks, with custom requests, response validation, and WAF bypass for individual monitors.
- Admin sign-in through Cloudflare Access, with monitor management, groups, ordering, pause/resume controls, and immediate connection tests.
- Public maintenance events and incidents with multiple associated monitors and progress updates. Sustained outages publish incidents automatically, and recovery resolves them.

## Local development

Requires Node.js 24 or later.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate
npm run dev
```

Open the [local status page](http://127.0.0.1:5173); the admin console is at `/admin`. See the [development guide](docs/development.md) for the local database, manual Cron triggers, and verification commands.

## Deployment with GitHub Actions

Configure Cloudflare and Access, set the GitHub Secrets / Variables, then run **Actions → Verify and deploy → Run workflow** manually. See the [deployment guide](docs/deployment.md) for setup and initial production checks.

## Documentation

| Document                                                   | Contents                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Deployment guide](docs/deployment.md)                     | Cloudflare, Access, GitHub Actions, and initial checks                    |
| [Monitor configuration](docs/configuration.md)             | Monitors, groups, events, WAF, refreshes, and performance settings        |
| [API reference](docs/api.md)                               | Endpoints, authentication, field rules, probe behavior, and examples      |
| [Development and maintenance](docs/development.md)         | Local setup, tests, deployment internals, operations, and recovery        |
| [Architecture and code organization](docs/architecture.md) | Code organization, scheduling, capacity estimates, statistics, and events |

## License

[Apache-2.0](LICENSE)
