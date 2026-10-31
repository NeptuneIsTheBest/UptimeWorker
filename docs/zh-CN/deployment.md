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

Worker 名称默认 `uptimeworker`；如需修改，先确定 `WORKER_NAME`，例如 `team-status`。默认地址由 Worker 名称和账户子域名拼接：`https://uptimeworker.my-team.workers.dev`。账户子域名在 **Workers & Pages → Your subdomain** 查看，不是 Zero Trust 团队域名。仅使用自定义域名时，无需先开启或访问 Worker 的默认地址。

首次部署无需提前创建 Worker、D1 或填写数据库 ID，也无需手改 `wrangler.jsonc`。已有部署更新代码时直接重新运行工作流；清空重建见[重新部署与清空重建](#重新部署与清空重建)。

## 2. 获取 Cloudflare 账户 ID 和 API Token

### 账户 ID

选择目标账户，进入 **Compute → Workers & Pages → Account Details → Account ID**，点击复制。也可在控制台搜索框（`Cmd/Ctrl + K`）搜索 `Copy account ID`。这是 32 位十六进制值，填入 `CLOUDFLARE_ACCOUNT_ID`；不要使用网站的 Zone ID 或 D1 的 Database ID。参见[查找账户 ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)。

### API Token

打开右上角头像的 **My Profile → API Tokens → Create Token → Create Custom Token**，例如命名为 `UptimeWorker deploy`，添加以下三项权限：

| 第一列：范围 | 第二列：权限     | 第三列：级别 |
| ------------ | ---------------- | ------------ |
| Account      | Workers Scripts  | Edit         |
| Account      | D1               | Edit         |
| Account      | Account Settings | Read         |

在 **Account Resources** 中选择 **Include → Specific account → 目标账户**，须与上面的账户 ID 属于同一账户。检查摘要后创建 Token，复制结果页显示的完整令牌，填入 `CLOUDFLARE_API_TOKEN`。令牌只显示一次；不要复制 Token 的名称、ID 或示例命令整行。后续部署可复用已保存且有效的 Token。参见[创建 API Token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)。

本指南通过控制台管理 Access 和自定义域名，部署 Token 使用上表权限即可。

## 3. 配置 Access，复制团队域名和 AUD

### 保护后台路径

进入 **Zero Trust → Access controls（部分界面为 Access）→ Applications → Create new application（或 Add an application）→ Self-hosted**，创建应用，例如 `UptimeWorker Admin`。

在同一个应用中添加两个 **Public hostname**。以 `status.example.com` 为例：

| Subdomain | Domain        | Path        |
| --------- | ------------- | ----------- |
| `status`  | `example.com` | `admin`     |
| `status`  | `example.com` | `api/admin` |

Path 输入框前已显示 `/` 时，分别填写 `admin` 和 `api/admin`；最终地址是 `/admin` 和 `/api/admin`。若界面将主机名合并为一个字段，两行均填写 `status.example.com`，路径仍分别填写。主机名栏不填写 `https://` 或路径。使用默认域名时，主机名换成 `<WORKER_NAME>.<账户子域名>.workers.dev`。

保护这两条路径及其子路径。保持首页 `/`、监控详情 `/monitors/*`、事件详情 `/events/*`，以及 `/api/status`、`/api/monitors/*/history`、`/api/events/*` 公开。不要把整个状态页域名设为必须登录；如已启用账户级 Worker 保护，也需检查其对公开页的影响。参见 [Access 路径匹配](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) 和 [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)。

添加 **Allow** 策略，使用 **Include → Emails** 填写管理员邮箱，或选择指定用户组；使用现有身份提供商或邮件一次性验证码登录。保存应用。两条路径放在同一个应用中，使用同一个 AUD。

### 两个值在哪里找

| GitHub 配置名        | Cloudflare 中的来源                                                                                                               | 应复制的值                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` | **Zero Trust → Settings → Team domain → Full domain**，点击旁边的 Copy；旧版可能标为 Team name and domain                         | 完整的 `your-team.cloudflareaccess.com`，不是应用名称或状态页域名 |
| `ACCESS_AUD`         | **Access controls → Applications → 点击应用名称（或 Configure）→ Additional settings → AUD tag → Application Audience (AUD) Tag** | 64 位十六进制字符串，不是应用 ID、策略 ID 或 API Token            |

来源：[团队域名](https://developers.cloudflare.com/cloudflare-one/faq/getting-started-faq/)、[获取 AUD](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag)。控制台布局可能调整，按字段名称查找。

**已有 Access 应用可以复用。** 检查主机名与计划访问的域名一致、两条后台路径均受保护，再复制该应用的配置。重建 Worker 不要求重建 Access；删除并重建 Access 应用才会改变 AUD。工作流只把这两个值写入 Worker，不会创建或修改 Access 应用。

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

`ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD` 也可保存在 Repository Secrets，已有配置不用搬动。同名 Variable 优先于 Secret，避免两处保存了不同值。值不加引号，也不要保留尖括号占位符。

Worker 和 D1 名称使用小写字母开头的小写字母、数字及连字符。每个实例使用独立名称；同名数据库会复用。完整长度限制见[部署配置](development.md#部署配置)。

## 5. 运行部署并检查结果

1. 打开仓库 **Actions**，在左侧选择 **Verify and deploy**。
2. 点击 **Run workflow**，分支选择 **main**，再点击弹出面板中的 **Run workflow**。Fork 后若提示启用 Actions，先启用工作流。
3. 打开新出现的运行记录，等待 `verify` 和 `deploy` 两个任务均成功。其他分支只运行验证，不发布。
4. 在 `deploy` 日志中检查以下步骤：

| 工作流步骤                                   | 应看到的结果                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Create or reuse D1 and prepare configuration | 新库显示 `Created D1 database: ...`；已有同名库显示 `Reusing D1 database: ...` |
| Build with production bindings               | 生产构建成功                                                                   |
| Apply database migrations                    | 新库成功应用迁移；已初始化的库无需重复应用                                     |
| Publish Worker and static assets             | Worker 和静态资源发布成功，Cron 为 `* * * * *`                                 |

没有 Run workflow 按钮时，检查是否已进入具体工作流（不是 All workflows 列表）、是否有仓库写权限，以及默认分支是否包含该工作流。参考 [GitHub 手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。

使用默认域名时，现在可访问 `https://<WORKER_NAME>.<账户子域名>.workers.dev`。仅用自定义域名时继续下一节；首次发布后、绑定域名前没有可访问的站点地址是正常的。

## 仅使用自定义域名

**首次发布顺序：配置 Access → 设置 `WORKERS_DEV=false` → 运行工作流创建 Worker → 绑定自定义域名。** 无需临时开启默认域名。

1. 在 Cloudflare **Compute → Workers & Pages** 选择 Worker，进入 **Domains → Add Domain**。旧版布局入口为 **Settings → Domains & Routes → Add → Custom Domain**。
2. 新版 **Connect domain** 对话框先搜索并选择根域名 `example.com`，再在 **Subdomain** 填 `status`，**Enable for** 保持 **Production**，点击 **Add domain**。如果旧版表单只有一个域名输入框，则填写完整的 `status.example.com`。不要填写 `https://`、路径或 `/*`。等待域名和证书生效；Cloudflare 管理对应 DNS 记录与证书，参见[自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。
3. 核对 Access 应用保护的是这个域名的 `/admin` 和 `/api/admin`，从 `https://status.example.com` 访问。
4. 在 **Domains** 确认 Worker URL 的 **Production** 和 **Preview** 开关均关闭；旧版布局在 Domains & Routes 中显示。本项目部署时设置 `workers_dev=false`、`preview_urls=false`。GitHub 中保留 `WORKERS_DEV=false`，后续发布才会继续应用。

更新现有 Worker 会保留控制台配置的域名绑定；**删除 Worker 后重新创建，必须重新检查并绑定域名**。Access 应用不能代替域名绑定。如果已有 DNS 记录冲突，先确认该记录的用途再处理。

## 首次上线验收

1. 使用未登录的浏览器会话打开首页和 `/api/status`，应可公开访问；`/admin` 和 `/api/admin/monitors` 应要求 Access 登录。
2. 用允许的邮箱登录，确认监控列表可加载；全新 D1 显示空列表属于正常现象。
3. 添加你可访问的公网 HTTP 和 TCP 监控，分别执行「测试连接」。即时测试验证连通性，不写入状态或历史。
4. 等待定时检测，确认「最近检测」、响应时间和历史出现。新建或修改 Cron 最多可能需要 15 分钟传播，期间先用「测试连接」确认连通性；检查 Worker 的 **Settings → Trigger Events → Cron Triggers** 中是否有 `* * * * *`。参见 [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。
5. 自定义域名的公开页和后台登录均正常后，确认默认及预览地址仍禁用。目标受 WAF 保护时，继续按[监控配置](configuration.md#cloudflare-waf-放行)配置放行。

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
