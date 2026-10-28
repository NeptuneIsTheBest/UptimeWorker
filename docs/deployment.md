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

默认通过 `workers.dev` 部署，不需要 DNS 或 Zone 写入权限，也不需要 API Token 管理 Access 策略。

## 2. 创建 Access 应用

在 **Zero Trust → Access → Applications** 中创建一个 **Self-hosted** 应用，在同一个应用中添加两个公共主机名 / 路径：

```text
uptimeworker.<你的 workers.dev 子域名>.workers.dev/admin
uptimeworker.<你的 workers.dev 子域名>.workers.dev/api/admin
```

使用路径规则保护上述路径及所有子路径。保持 `/`、`/api/status` 和 `/api/monitors/*/history` 公开。不要直接对整个 Worker 开启登录要求，否则访客也会被拦截。若账户已启用全局 Worker 保护，需要先为此 Worker 配置公开例外，再对后台路径设置 Access。

在应用中配置 **Allow** 策略，仅允许你的邮箱或指定用户组；选择现有身份提供商，或使用邮件一次性验证码。两条路径应属于同一个 Access 应用，使用相同 AUD。

记录团队域名（例如 `your-team.cloudflareaccess.com`）和该应用的 **Application Audience (AUD) Tag**。即使通过另一个未受路径规则保护的域名访问，Worker 也会拒绝缺失或无效的 JWT。未配置 Access 的后台默认关闭，不会自动开放。

详细规则见 [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) 和 [Access 路径匹配](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)。使用自定义域名时，将域名绑定到同一 Worker，并在 Access 应用中增加对应的后台路径。

## 3. 配置 GitHub

仓库 **Settings → Secrets and variables → Actions**：

| 类型               | 名称                    | 内容                                |
| ------------------ | ----------------------- | ----------------------------------- |
| Secret             | `CLOUDFLARE_API_TOKEN`  | 上一步创建的 Token                  |
| Secret             | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID（32 位）         |
| Variable 或 Secret | `ACCESS_TEAM_DOMAIN`    | 团队域名，可包含 `https://`         |
| Variable 或 Secret | `ACCESS_AUD`            | Access 应用的 64 位 AUD             |
| Variable，可选     | `WORKER_NAME`           | 默认 `uptimeworker`                 |
| Variable，可选     | `D1_DATABASE_NAME`      | 默认 `<WORKER_NAME>-db`             |
| Variable，可选     | `SITE_NAME`             | 状态页站点名称，默认 `UptimeWorker` |

Access 配置同时存在于 Variables 和 Secrets 时，优先使用 Variables 中的值。

Worker / D1 名称使用小写字母、数字与连字符，字母开头，最长 63 个字符。每个实例应使用自己的名称；不要将不相关的数据库命名为相同名称。

在 **Actions → Verify and deploy → Run workflow** 选择 `main` 手动运行。PR 和任何分支推送都不会自动触发该工作流。

选择 `main` 手动运行后，工作流会：

1. 使用 lockfile 安装依赖，运行类型检查、单元 / D1 集成测试、生产构建和 Chromium 浏览器测试。
2. 检查部署变量，通过 Cloudflare API 查找完全匹配名称的 D1；不存在则创建，存在则复用。
3. 生成不包含 API Token 的 `wrangler.deploy.json`，使用该配置重新构建。
4. 执行 `wrangler d1 migrations apply DB --remote --config wrangler.deploy.json`。
5. 仅在迁移成功后发布 Worker 和静态资源，启用每 5 分钟的 Cron。

手动选择其他分支时只执行验证；仅 `main` 分支验证通过后才会部署。生产发布串行执行，正在运行的发布不会被后续手动运行取消。验证、配置、查库、构建或迁移失败都会阻止发布；数据库不会被自动删除或重建。

部署地址为 `https://<WORKER_NAME>.<你的子域名>.workers.dev`。首次添加 Cron 后可能需要数分钟传播，参见 [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。

## 首次上线验收

1. 未登录访问首页应正常，访问 `/admin` 应进入 Access 登录。
2. 登录后分别新增一个公开 HTTP 目标和一个允许出站连接的 TCP 目标，先执行“测试连接”。
3. 等待 Cron 运行，在状态页与详情中确认检测结果、延迟和历史记录已出现。
4. 重新运行部署，确认日志显示 `Reusing D1 database`，监控与历史仍然存在。
5. 在 Cloudflare 查看 Worker Cron 日志、CPU 用量及 D1 Row Metrics。没有真实账户凭据时，本地测试不能替代这一步。

## 回滚与数据库恢复

代码发布失败不会自动撤销已经成功的数据库迁移。需要回滚代码时，可在 Cloudflare 回退 Worker 版本；数据库恢复需单独使用 D1 Time Travel 并评估数据影响。新增迁移应遵循[开发指南中的迁移约定](development.md#数据库迁移)。
