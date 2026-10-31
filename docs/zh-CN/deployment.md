# 部署指南

[English](../deployment.md) | [简体中文](deployment.md)

[返回 README](../../README.zh-CN.md)

通过 GitHub Actions 的 [Verify and deploy 工作流](../../.github/workflows/deploy.yml) 手动验证和部署。工作流创建 Worker 和 D1、应用迁移并发布静态资源；Access 应用、登录策略和自定义域名需要在 Cloudflare 控制台配置。

## 1. 准备仓库和访问域名

准备一个可运行 Actions、可管理仓库 Secrets / Variables 的 GitHub 仓库，以及已启用 Workers 和 Zero Trust 的 Cloudflare 账户。首次开通 Zero Trust 时完成团队名称和套餐选择，已有团队可直接使用。

先选择访问方式，配置 Access 时使用同一个域名：

| 访问方式         | 准备内容                                                                                  | `WORKERS_DEV`                |
| ---------------- | ----------------------------------------------------------------------------------------- | ---------------------------- |
| 仅使用自定义域名 | 同一 Cloudflare 账户下已生效的域名，以及准备用作状态页的主机名，例如 `status.example.com` | **首次部署前就设为 `false`** |
| 使用默认域名     | Workers & Pages 中的账户子域名，例如 `my-team.workers.dev`                                | 留空或 `true`                |

Worker 名称由 `WORKER_NAME` 设置，默认 `uptimeworker`。默认地址由 Worker 名称和账户子域名拼接，例如 `https://uptimeworker.my-team.workers.dev`。账户子域名在 **Workers & Pages → Your subdomain** 查看，与 Zero Trust 团队域名不同。

首次部署无需提前创建 Worker、D1 或填写数据库 ID，也无需手改 `wrangler.jsonc`。已有部署更新代码时直接重新运行工作流；清空重建见[重新部署与清空重建](#重新部署与清空重建)。

## 2. 获取 Cloudflare 账户 ID 和 API Token

### 账户 ID

在目标账户的 **Workers & Pages → Account Details → Account ID** 复制 32 位十六进制账户 ID，填入 `CLOUDFLARE_ACCOUNT_ID`。注意区分网站的 Zone ID 和 D1 的 Database ID；参见[查找账户 ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)。

### API Token

在 **My Profile → API Tokens** 创建自定义 Token，添加以下权限：

| 范围    | 权限             | 级别 |
| ------- | ---------------- | ---- |
| Account | Workers Scripts  | Edit |
| Account | D1               | Edit |
| Account | Account Settings | Read |

将 **Account Resources** 设为 **Include → Specific account → 目标账户**，与上述账户 ID 保持一致。创建后，将仅显示一次的完整令牌保存到 `CLOUDFLARE_API_TOKEN`，后续部署可复用。参见[创建 API Token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)。

本指南通过控制台管理 Access 和自定义域名，部署 Token 使用上表权限即可。

## 3. 配置 Cloudflare Access

进入 **Zero Trust → Access controls → Applications**，创建 **Self-hosted** 应用，例如 `UptimeWorker Admin`。

在同一个应用中添加两个 **Public hostname**。以 `status.example.com` 为例：

| Subdomain | Domain        | Path        |
| --------- | ------------- | ----------- |
| `status`  | `example.com` | `admin`     |
| `status`  | `example.com` | `api/admin` |

两条路径分别为 `/admin` 和 `/api/admin`；Path 输入框自带 `/` 时按表格填写。主机名不带协议或路径，使用默认域名时改为 `<WORKER_NAME>.<账户子域名>.workers.dev`。

保护这两条路径及其子路径，保持 `/`、`/monitors/*`、`/events/*`、`/api/status`、`/api/monitors/*/history` 和 `/api/events/*` 公开。检查整站或账户级 Worker 保护是否影响公开访问；参见 [Access 路径匹配](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)和 [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)。

添加 **Allow** 策略，通过 **Include → Emails** 指定管理员邮箱，或选择指定用户组；使用现有身份提供商或邮件一次性验证码登录。两条路径使用同一应用的 AUD。保存后记录以下配置：

| GitHub 配置名        | 配置位置                                                                      | 配置值                                              |
| -------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` | **Zero Trust → Settings → Team domain**                                       | 完整团队域名，例如 `your-team.cloudflareaccess.com` |
| `ACCESS_AUD`         | **Access controls → Applications → 该应用的 Configure → Additional settings** | **Application Audience (AUD) Tag**，64 位十六进制值 |

查找配置时可参见[团队域名](https://developers.cloudflare.com/cloudflare-one/faq/getting-started-faq/)和[应用 AUD](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag)。

已有 Access 应用的域名和受保护路径匹配时可以复用，重建 Worker 也可沿用原配置；删除并重建 Access 应用后需更新 AUD。工作流将上述配置写入 Worker，Access 应用仍由控制台管理。

## 4. 填写 GitHub Secrets / Variables

打开你自己的仓库 **Settings → Secrets and variables → Actions**。使用 **Repository** 配置；本工作流未指定 GitHub Environment，只有 Environment 下的同名配置不会自动被读取。

在 **Secrets → New repository secret** 分别添加：

| Name                    | Secret                         |
| ----------------------- | ------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | 第 2 步创建的完整 Token        |
| `CLOUDFLARE_ACCOUNT_ID` | 第 2 步复制的 32 位 Account ID |

切换到 **Variables → New repository variable**，分别添加：

| Name                 | Value                                                                  | 是否必填           |
| -------------------- | ---------------------------------------------------------------------- | ------------------ |
| `ACCESS_TEAM_DOMAIN` | 第 3 步的 `your-team.cloudflareaccess.com`，也接受带 `https://` 的形式 | 是                 |
| `ACCESS_AUD`         | 第 3 步的 64 位 AUD                                                    | 是                 |
| `WORKERS_DEV`        | 仅用自定义域名时填 `false`；默认 `true`                                | 自定义域名方案必填 |
| `WORKER_NAME`        | 自行命名，默认 `uptimeworker`                                          | 否                 |
| `D1_DATABASE_NAME`   | 自行命名，默认 `<WORKER_NAME>-db`，如 `uptimeworker-db`                | 否                 |
| `SITE_NAME`          | 状态页显示的名称，默认 `UptimeWorker`                                  | 否                 |

`ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD` 也可保存在 Repository Secrets，同名 Variable 优先于 Secret。填写实际值，不加引号，也不保留尖括号占位符。

Worker 和 D1 名称使用小写字母开头的小写字母、数字及连字符。每个实例使用独立名称；同名数据库会复用。完整长度限制见[部署配置](development.md#部署配置)。

## 5. 运行部署并检查结果

1. 打开仓库 **Actions → Verify and deploy**。Fork 后若提示启用 Actions，先启用工作流。
2. 通过 **Run workflow** 选择 **main** 分支并运行。
3. 等待 `verify` 和 `deploy` 两个任务成功。其他分支只运行验证，不发布。

在 `deploy` 日志中检查以下步骤：

| 工作流步骤                                   | 应看到的结果                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Create or reuse D1 and prepare configuration | 新库显示 `Created D1 database: ...`；已有同名库显示 `Reusing D1 database: ...` |
| Build with production bindings               | 生产构建成功                                                                   |
| Apply database migrations                    | 应用尚未执行的迁移，已应用的迁移不会重复执行                                   |
| Publish Worker and static assets             | Worker 和静态资源发布成功，Cron 为 `* * * * *`                                 |

若未显示 Run workflow 按钮，确认已选择具体工作流、具有仓库写权限，且默认分支包含该工作流。参见 [GitHub 手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。

使用默认域名时，现在可访问 `https://<WORKER_NAME>.<账户子域名>.workers.dev`。仅用自定义域名时继续下一节；首次发布后、绑定域名前没有可访问的站点地址是正常的。

## 仅使用自定义域名

首次发布顺序：配置 Access → 设置 `WORKERS_DEV=false` → 运行工作流创建 Worker → 绑定自定义域名。

1. 在 Cloudflare **Workers & Pages** 选择 Worker，通过 **Domains → Add Domain** 添加自定义域名。
2. 将生产域名设为 `status.example.com`。若表单分列域名和子域名，分别填写 `example.com` 与 `status`，**Enable for** 选择 **Production**。主机名不带协议或路径。Cloudflare 自动管理 DNS 记录和证书，等待生效后继续；参见[自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。
3. 核对 Access 应用保护的是这个域名的 `/admin` 和 `/api/admin`，从 `https://status.example.com` 访问。
4. 确认 `workers.dev` 地址的 **Production** 和 **Preview** 开关均关闭，并在 GitHub 中保留 `WORKERS_DEV=false`，使后续部署继续应用。

更新现有 Worker 会保留控制台配置的域名绑定；**删除 Worker 后重新创建，必须重新检查并绑定域名**。Access 应用不能代替域名绑定。如果已有 DNS 记录冲突，先确认该记录的用途再处理。

## 首次上线验收

1. 使用未登录的浏览器会话打开首页和 `/api/status`，应可公开访问；`/admin` 和 `/api/admin/monitors` 应要求 Access 登录。
2. 用允许的邮箱登录，确认监控列表可加载；全新 D1 显示空列表属于正常现象。
3. 添加你可访问的公网 HTTP 和 TCP 监控，分别执行「测试连接」。即时测试验证连通性，不写入状态或历史。
4. 等待定时检测更新「最近检测」、响应时间和历史。检查 Worker 的 **Settings → Trigger Events → Cron Triggers** 中是否有 `* * * * *`；新建或修改 Cron 最多可能需要 15 分钟传播，参见 [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。
5. 仅使用自定义域名时，确认 `workers.dev` 生产及预览地址仍禁用。目标受 WAF 保护时，按[监控配置](configuration.md#cloudflare-waf-放行)配置放行。

## 常见问题

| 现象                                       | 检查位置与处理                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `Missing required setting: ...`            | 核对第 4 步的名称、Repository 作用域，确认配置在自己的仓库中                   |
| Account ID / team domain / AUD 格式错误    | 按第 2、3 步重新复制，检查是否混淆了 Zone ID、应用 ID 或状态页域名             |
| `Cloudflare D1 API failed` 或认证/权限错误 | 检查 Token 有效性、三项权限、Account Resources 与 Account ID 是否匹配          |
| 登录后后台仍然 401/403，或列表加载失败     | 检查两个后台路径、Allow 策略、应用 AUD，以及 Variables 是否覆盖了正确的 Secret |
| 首页也被要求登录                           | 检查是否保护了整个域名，或账户级 Worker 保护覆盖了公开页                       |
| 部署成功但自定义域名打不开                 | 检查新 Worker 的域名绑定、DNS 和证书；仅配置 Access 不会建立域名绑定           |
| 重新部署后仍有旧监控                       | 工作流按名称复用 D1，重新部署不会清空数据                                      |
| 新监控没有定时结果                         | 检查是否启用、Cron 配置和传播时间；查看 Worker 日志中的 `scheduled_run`        |

## 重新部署与清空重建

普通更新只需从 `main` 重新运行工作流，保持 Worker 和 D1 名称不变；确认日志为 `Reusing D1 database`，并验证原有监控和历史可用。

验证全新安装前，记录监控参数、分组顺序、全局设置、自定义域名和 Access 配置，需要保留数据时先导出 D1。WAF 密钥和自定义请求凭据可能存在数据库中；只记录名称与地址不足以恢复它们，后台也不会回显已保存的 WAF 密钥。

Worker 与 D1 是独立资源。删除 Worker **不会自动删除 D1**；删除 D1 会丢失监控、历史、事件和全局设置。确需清空时，在 Worker 的 **Bindings** 确认 `DB` 对应的数据库，再分别到 Worker 的 **Settings** 和 **Storage & databases → D1 SQLite Database → 对应数据库 → Settings** 删除。参见 [Worker / D1 删除步骤](https://developers.cloudflare.com/d1/get-started/#7-optional-delete-your-database)。

使用原 GitHub 配置运行工作流，确认日志为 `Created D1 database`，重新绑定自定义域名，再恢复监控和所需设置。保留 Access 应用时可继续使用原 AUD。回滚与数据库恢复见[开发与维护](development.md#回滚与数据库恢复)。
