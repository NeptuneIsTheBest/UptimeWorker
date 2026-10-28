# 部署指南

[返回 README](../README.md)

通过 GitHub Actions 手动验证和部署，配置入口见仓库的 [Verify and deploy 工作流](../.github/workflows/deploy.yml)。

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
uptimeworker.<你的 workers.dev 子域名>.workers.dev/admin
uptimeworker.<你的 workers.dev 子域名>.workers.dev/api/admin
```

保护上述路径及其子路径，保持 `/`、`/api/status` 和 `/api/monitors/*/history` 公开。若账户已启用全局 Worker 保护，先为此 Worker 配置公开例外，再保护后台路径。

配置 **Allow** 策略，仅允许你的邮箱或指定用户组；选择现有身份提供商或邮件一次性验证码。两条路径使用同一个应用的 AUD。

记录团队域名（如 `your-team.cloudflareaccess.com`）和 **Application Audience (AUD) Tag**。Worker 会校验登录凭据；Access 未配置或凭据无效时，后台拒绝访问。

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

Access 配置同时存在于 Variables 和 Secrets 时，优先使用 Variables 中的值。

Worker / D1 名称以小写字母开头，只含小写字母、数字与连字符，最长 63 个字符。每个实例使用独立名称，避免复用其他应用的数据库。

在 **Actions → Verify and deploy → Run workflow** 选择 `main` 手动运行，依次执行：

1. 安装依赖，运行类型检查、单元 / D1 集成测试、生产构建和 Chromium 浏览器测试。
2. 检查部署变量，按名称查找 D1 数据库；存在则复用，不存在则创建。
3. 生成生产配置并重新构建，应用数据库迁移。
4. 发布 Worker 和静态资源，启用每分钟的 Cron。

工作流仅手动触发，其他分支只执行验证。生产发布串行排队，任一步骤失败即停止后续发布；已存在的数据库不会被删除或重建。配置生成过程见[开发指南](development.md#部署配置)。

默认部署地址为 `https://<WORKER_NAME>.<你的子域名>.workers.dev`；关闭默认域名后，通过已绑定的自定义域名访问。首次添加 Cron 后可能需要数分钟传播，参见 [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。

## 仅使用自定义域名

在 Cloudflare 控制台将自定义域名绑定到同一 Worker，并在 Access 应用中添加该域名的 `/admin` 和 `/api/admin` 路径及其子路径。后续部署会保留域名绑定。

在 GitHub Actions Variables 中将 `WORKERS_DEV` 设为 `false`，在 `main` 上重新运行工作流。每次部署都会应用该设置；只在 Cloudflare 控制台关闭默认域名会被后续部署覆盖。[Cloudflare 官方说明](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

`WORKERS_DEV` 未设置或仅含空白时默认 `true`；去除首尾空白后只接受 `true` / `false`，不区分大小写，其他值会在调用 Cloudflare API 前阻止部署。预览域名始终关闭。此变量用于 GitHub Actions 部署；直接使用 `wrangler.jsonc` 部署时，默认域名仍开启。

## 首次上线验收

1. 未登录访问首页应正常，访问 `/admin` 应进入 Access 登录。
2. 登录后分别新增一个公开 HTTP 目标和一个允许出站连接的 TCP 目标，先执行“测试连接”。
3. 等待 Cron 运行，在状态页与详情中确认检测结果、延迟和历史记录已出现。
4. 重新运行部署，确认日志显示 `Reusing D1 database`，监控与历史仍然存在。
5. 在 Cloudflare 查看 Worker Cron 日志、CPU 用量及 D1 Row Metrics。
6. 若设置了 `WORKERS_DEV=false`，首次及再次部署后确认 Worker 的 Production 和 Preview URL 开关均关闭，自定义域名首页与后台登录正常。

## 回滚与数据库恢复

代码回滚和数据库恢复分别处理：在 Cloudflare 回退 Worker 版本，数据库按需通过 D1 Time Travel 恢复并评估数据影响。发布失败不会撤销已完成的迁移；回滚前检查[数据库迁移](development.md#数据库迁移)和[兼容性说明](development.md#兼容性说明)。
