# UptimeWorker

部署在 Cloudflare Workers 上的轻量服务监控网站：公开状态页、Cloudflare Access 管理后台、HTTP/HTTPS 与 TCP Port 检测、D1 历史数据，以及 GitHub Actions 自动部署。

## 功能

- 中文响应式界面，包含整体状态、服务详情、24 小时响应时间、30 日可用率和 90 日状态条。
- HTTP 支持 GET / HEAD、期望状态码范围、最多 3 次重定向；TCP 检测连接建立情况。
- 后台支持新增、编辑、删除、暂停、恢复和即时连接测试。即时测试不改变历史或当前状态。
- 默认每 5 分钟检测，可选择 5 / 10 / 15 / 30 / 60 分钟间隔，超时范围 1–30 秒。
- D1 保存配置与历史；原子租约、结果唯一键和配置版本阻止重叠任务、重复统计及过期结果覆盖。
- Access JWT 在 Worker 内校验，生产构建会检查并移除本地开发鉴权分支。
- 第一版最多 10 个监控（包括暂停项），以小规模、免费优先为目标；没有告警和用户注册功能。

## 本地运行

需要 Node.js 24 或更新版本。

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate
npm run dev
```

打开 <http://127.0.0.1:5173>，后台为 `/admin`。`.dev.vars.example` 中的 `DEV_ACCESS_BYPASS=true` 仅在 Vite 开发模式、且请求主机是 localhost / 回环地址时生效。它不会进入生产 Worker。不要将开发服务器暴露到公网。

本地数据库位于 `.wrangler/state/`，不会写入云端。自动化浏览器测试使用独立且可丢弃的 `.wrangler/e2e-state/`，不会清空本地开发数据库。仓库不会提交真实密钥、开发数据或测试数据。

本地 Cron 不会自动按时运行。在开发服务器运行期间，可以手动触发一轮：

```sh
curl 'http://127.0.0.1:5173/cdn-cgi/local/scheduled?cron=*/5+*+*+*+*'
```

同一 5 分钟时间窗只执行一次；重复触发不会增加统计。新增监控或编辑配置后，等待下一个时间窗，或使用后台的“测试连接”。

## GitHub Actions 部署

### 1. 配置 Cloudflare

启用 Cloudflare Workers、账户的 `workers.dev` 子域名以及 Zero Trust。创建一个只授权目标账户的 API Token，包含：

| 范围    | 权限                   |
| ------- | ---------------------- |
| Account | Workers Scripts: Edit  |
| Account | D1: Edit               |
| Account | Account Settings: Read |

默认通过 `workers.dev` 部署，不需要 DNS 或 Zone 写入权限，也不需要 API Token 管理 Access 策略。

### 2. 创建 Access 应用

在 **Zero Trust → Access → Applications** 中创建一个 **Self-hosted** 应用，在同一个应用中添加两个公共主机名 / 路径：

```text
uptimeworker.<你的 workers.dev 子域名>.workers.dev/admin
uptimeworker.<你的 workers.dev 子域名>.workers.dev/api/admin
```

使用路径规则保护上述路径及所有子路径。保持 `/`、`/api/status` 和 `/api/monitors/*/history` 公开。不要直接对整个 Worker 开启登录要求，否则访客也会被拦截。若账户已启用全局 Worker 保护，需要先为此 Worker 配置公开例外，再对后台路径设置 Access。

在应用中配置 **Allow** 策略，仅允许你的邮箱或指定用户组；选择现有身份提供商，或使用邮件一次性验证码。两条路径应属于同一个 Access 应用，使用相同 AUD。

记录团队域名（例如 `your-team.cloudflareaccess.com`）和该应用的 **Application Audience (AUD) Tag**。即使通过另一个未受路径规则保护的域名访问，Worker 也会拒绝缺失或无效的 JWT。未配置 Access 的后台默认关闭，不会自动开放。

详细规则见 [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) 和 [Access 路径匹配](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)。使用自定义域名时，将域名绑定到同一 Worker，并在 Access 应用中增加对应的后台路径。

### 3. 配置 GitHub

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

推送到 `main`，或在 **Actions → Verify and deploy → Run workflow** 选择 `main` 运行。

工作流会：

1. 使用 lockfile 安装依赖，运行类型检查、单元 / D1 集成测试、生产构建和 Chromium 浏览器测试。
2. 检查部署变量，通过 Cloudflare API 查找完全匹配名称的 D1；不存在则创建，存在则复用。
3. 生成不包含 API Token 的 `wrangler.deploy.json`，使用该配置重新构建。
4. 执行 `wrangler d1 migrations apply DB --remote --config wrangler.deploy.json`。
5. 仅在迁移成功后发布 Worker 和静态资源，启用每 5 分钟的 Cron。

PR 只验证，不部署，也无法使用生产密钥。生产发布串行执行，正在运行的发布不会被新推送取消。配置、查库、构建或迁移失败都会阻止发布；数据库不会被自动删除或重建。

部署地址为 `https://<WORKER_NAME>.<你的子域名>.workers.dev`。首次添加 Cron 后可能需要数分钟传播，参见 [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。

### 首次上线验收

1. 未登录访问首页应正常，访问 `/admin` 应进入 Access 登录。
2. 登录后分别新增一个公开 HTTP 目标和一个允许出站连接的 TCP 目标，先执行“测试连接”。
3. 等待 Cron 运行，在状态页与详情中确认检测结果、延迟和历史记录已出现。
4. 重新运行部署，确认日志显示 `Reusing D1 database`，监控与历史仍然存在。
5. 在 Cloudflare 查看 Worker Cron 日志、CPU 用量及 D1 Row Metrics。没有真实账户凭据时，本地测试不能替代这一步。

## 检测、统计与保留策略

- HTTP 耗时从发起请求开始，直到收到最终响应头并释放响应体；重定向耗时包含在内。不读取整页内容，也不做关键字匹配。
- TCP 耗时为连接建立时间；不执行数据库查询、TLS 握手或应用协议校验。连接成功不代表应用业务正常。
- TCP 无法连接内网、localhost、Cloudflare IP 或端口 25。Cloudflare 代理后的域名不适合裸 TCP 检测；HTTP 服务应使用 HTTP 检测。[官方限制](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- 检测来自 Cloudflare 调度所在位置，不是固定城市或多地区探针。网络往返时间和调度位置会影响响应耗时。
- 第一次检测前显示“等待检测”；停用显示“已暂停”；超过两个配置周期没有新结果显示“数据过期”。平台或数据库故障不会自动生成“成功”样本。
- 可用率 = 成功检测次数 / 完成检测次数。30 日指包含今天的最近 30 个 UTC 自然日，并非精确到秒的故障持续时间；缺失样本和暂停区间不算成功，也不纳入分母。一天存在检测记录但有漏跑时，状态条只代表已有样本。
- 数据时间戳使用 UTC 毫秒；每日状态条按 UTC 日汇总，检测时间按浏览器时区显示。
- 保留最近 7 天明细、包含今天的 90 个 UTC 日汇总。每轮最多清理 500 条过期明细和 100 条过期汇总，长期停机后可能需要多轮清理。
- 编辑监控保留历史，并重置当前状态，等待新配置的下一轮结果；历史会包含编辑前的样本。删除监控会同时删除它的明细与汇总。
- 公共 API 缓存 60 秒，后台修改在公开页面最多可能延迟约一分钟出现。管理员 API 不缓存。

### 免费额度与运行观测

默认 10 个监控、5 分钟间隔产生最多 2,880 次定时检测 / 天。并发为 4；每轮 HTTP 最多 40 个请求（包含重定向），结果批量写入 D1。

`scheduled_run` 结构化日志包含 `checked`、`stored`、`rowsRead`、`rowsWritten`、`elapsedMs`。`elapsedMs` 是总耗时，不是 CPU 时间；CPU 应在 Cloudflare 仪表盘查看。D1 索引、触发器与清理均产生读写，访问量和多缓存节点也会增加用量。免费账户还有同账户其他应用的共享配额，不能保证所有流量下均免费。[D1 计费](https://developers.cloudflare.com/d1/platform/pricing/)

当前上限在 `src/shared/types.ts`，调度批量上限在 `src/worker/scheduler.ts`；扩大规模前需要一起调整、验证每轮外部请求数 / CPU / 数据库用量，而不是只修改页面限制。

## 接口

| 方法   | 路径                           | 说明                             |
| ------ | ------------------------------ | -------------------------------- |
| GET    | `/api/status`                  | 站点信息、当前状态、每日可用率   |
| GET    | `/api/monitors/:id/history`    | 服务展示数据、最近 24 小时明细   |
| GET    | `/api/admin/monitors`          | 监控完整配置、身份与数量限制     |
| POST   | `/api/admin/monitors`          | 创建监控                         |
| PATCH  | `/api/admin/monitors/:id`      | 更新配置，必须携带当前 `version` |
| DELETE | `/api/admin/monitors/:id`      | 删除监控及历史                   |
| POST   | `/api/admin/monitors/:id/test` | 只测试已保存目标，不写入统计     |

管理接口必须通过 Access；写请求必须携带同源 `Origin` 和 `Content-Type: application/json`，DELETE / 测试可发送 `{}`。公开接口不返回目标地址、配置、JWT 或原始异常。错误统一为 `{ "error": "说明" }`，未知 API 返回 JSON 404。

HTTP 创建示例：

```json
{
  "name": "官网",
  "type": "http",
  "url": "https://example.com/health",
  "method": "GET",
  "expectedStatusMin": 200,
  "expectedStatusMax": 299,
  "intervalMinutes": 5,
  "timeoutSeconds": 10,
  "enabled": true
}
```

TCP 使用 `type: "tcp"`、`hostname`、`port` 替代 HTTP 专属字段，其余公共字段一致。共享接口类型位于 `src/shared/types.ts`。

## 验证与维护

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run format
```

单元测试使用可控 HTTP / socket 替身；D1 集成测试在真实本地 workerd 中运行迁移、SQL 和触发器；JWT 测试使用本地 RSA 密钥验证签名与声明。测试不会访问生产数据库。浏览器测试使用独立数据库，覆盖管理操作、公开状态、过期状态、错误提示和移动端布局；截图位于 `test-results/`。

若使用本机已有的 Chromium，可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 为浏览器可执行文件路径后运行浏览器测试。

新数据库变更放入新的 `migrations/NNNN_description.sql` 文件，不修改已经在生产应用过的迁移。优先使用向后兼容的迁移：代码发布失败不会自动撤销已经成功的数据库迁移；需要回滚代码时，可在 Cloudflare 回退 Worker 版本，数据库恢复需单独使用 D1 Time Travel 并评估数据影响。

源代码结构：`src/web/` 为前端，`src/worker/` 为 API / 鉴权 / 探测 / 调度 / 数据访问，`src/shared/` 为共享类型与校验，`scripts/` 为部署和测试辅助脚本。Cloudflare 开发工具中的 `undici` 通过 npm override 固定到修复版本 `7.30.1`。

## License

[Apache-2.0](LICENSE)
