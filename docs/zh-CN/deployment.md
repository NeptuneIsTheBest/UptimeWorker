# 部署指南

[English](../deployment.md) | [简体中文](deployment.md)

[返回 README](../../README.zh-CN.md)

通过 GitHub Actions 手动验证和部署，配置入口见仓库的 [Verify and deploy 工作流](../../.github/workflows/deploy.yml)。

## 1. 配置 Cloudflare

启用 Cloudflare Workers、账户的 `workers.dev` 子域名以及 Zero Trust。创建一个只授权目标账户的 API Token，包含：

| 范围    | 权限                   |
| ------- | ---------------------- |
| Account | Workers Scripts: Edit  |
| Account | D1: Edit               |
| Account | Account Settings: Read |

默认通过 `workers.dev` 部署，API Token 只需上述权限；Access 策略在控制台配置。

## 2. 创建 Access 应用

在 **Zero Trust → Access → Applications** 中创建一个 **Self-hosted** 应用，在同一个应用中添加两个公共主机名 / 路径：

```text
<WORKER_NAME>.<你的 workers.dev 子域名>.workers.dev/admin
<WORKER_NAME>.<你的 workers.dev 子域名>.workers.dev/api/admin
```

将 `<WORKER_NAME>` 替换为实际部署的 Worker 名称，须与下方 GitHub Actions 的 `WORKER_NAME` 一致；默认值为 `uptimeworker`。

保护上述路径及其子路径，保持首页 `/`、监控详情 `/monitors/*`、事件详情 `/events/*`，以及 `/api/status`、`/api/monitors/*/history`、`/api/events/*` 公开。若账户已启用全局 Worker 保护，先为此 Worker 配置公开例外，再保护后台路径。

配置 **Allow** 策略，仅允许你的邮箱或指定用户组；选择现有身份提供商或邮件一次性验证码。两条路径使用同一个应用的 AUD。

记录团队域名（如 `your-team.cloudflareaccess.com`）和 **Application Audience (AUD) Tag**，用于下一步。

详细规则见 [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) 和 [Access 路径匹配](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)。自定义域名的配置见[下文](#仅使用自定义域名)。

## 3. 配置 GitHub

仓库 **Settings → Secrets and variables → Actions**：

| 类型               | 名称                    | 内容                                   |
| ------------------ | ----------------------- | -------------------------------------- |
| Secret             | `CLOUDFLARE_API_TOKEN`  | 上一步创建的 Token                     |
| Secret             | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID（32 位）            |
| Variable 或 Secret | `ACCESS_TEAM_DOMAIN`    | 团队域名，可包含 `https://`            |
| Variable 或 Secret | `ACCESS_AUD`            | Access 应用的 64 位 AUD                |
| Variable，可选     | `WORKER_NAME`           | 默认 `uptimeworker`                    |
| Variable，可选     | `WORKERS_DEV`           | 默认 `true`；设为 `false` 关闭默认域名 |
| Variable，可选     | `D1_DATABASE_NAME`      | 默认 `<WORKER_NAME>-db`                |
| Variable，可选     | `SITE_NAME`             | 状态页站点名称，默认 `UptimeWorker`    |

每个实例使用独立的 Worker 和数据库名称，例如 `team-status` 与 `team-status-db`，使用小写字母开头的小写名称。完整命名规则及变量优先级见[部署配置](development.md#部署配置)。

在 **Actions → Verify and deploy → Run workflow** 选择 `main` 手动运行。工作流验证项目，创建或复用同名 D1 数据库，初始化数据库结构，然后发布 Worker 和静态资源，并启用每分钟 Cron。其他分支只运行验证。

默认部署地址为 `https://<WORKER_NAME>.<你的子域名>.workers.dev`；关闭默认域名后，通过已绑定的自定义域名访问。首次添加 Cron 后可能需要数分钟传播，参见 [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。

## 仅使用自定义域名

在 Cloudflare 控制台将自定义域名绑定到同一 Worker，并在 Access 应用中添加该域名的 `/admin` 和 `/api/admin` 路径及其子路径。后续部署会保留域名绑定。

在 GitHub Actions Variables 中将 `WORKERS_DEV` 设为 `false`，在 `main` 上重新运行工作流。每次部署都会应用此设置，预览域名保持关闭。参见 [workers.dev 路由配置](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)。

## 首次上线验收

1. 未登录打开首页，再访问 `/admin` 并通过 Access 登录。
2. 添加公网 HTTP 和 TCP 监控，分别执行「测试连接」。
3. 等待定时检测，确认状态、响应时间和历史记录出现。
4. 仅使用自定义域名时，确认该域名的公开页和后台登录正常，Worker 的 Production 和 Preview URL 开关均已关闭。

部署实现、用量观测和恢复流程见[开发与维护](development.md#部署配置)。
