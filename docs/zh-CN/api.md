# API 参考

[English](../api.md) | [简体中文](api.md)

[返回 README](../../README.zh-CN.md)

## 接口列表

| 方法                 | 路径                            | 说明                                                   |
| -------------------- | ------------------------------- | ------------------------------------------------------ |
| GET                  | `/api/status`                   | 站点信息、分组、当前状态、每日可用率、未结束与历史事件 |
| GET                  | `/api/monitors/:id/history`     | 服务展示数据、最近 24 小时明细、关联事件               |
| GET                  | `/api/events/:id`               | 单个事件及完整进展记录，支持独立详情页                 |
| GET                  | `/api/admin/monitors`           | 完整监控配置、分组与身份                               |
| POST                 | `/api/admin/monitors`           | 创建监控                                               |
| PATCH                | `/api/admin/monitors/:id`       | 更新配置，必须携带当前 `version`                       |
| DELETE               | `/api/admin/monitors/:id`       | 删除监控及历史                                         |
| POST                 | `/api/admin/monitors/:id/test`  | 只测试已保存目标，不写入统计                           |
| GET                  | `/api/admin/settings`           | 全局设置、版本与密钥配置状态                           |
| PATCH                | `/api/admin/settings`           | 更新全局设置，必须携带当前 `version`                   |
| GET / POST           | `/api/admin/groups`             | 列出／创建分组                                         |
| PUT                  | `/api/admin/groups/order`       | 原子保存全部分组的顺序                                 |
| PUT                  | `/api/admin/monitors/order`     | 原子保存指定分组内全部服务的顺序                       |
| PATCH / DELETE       | `/api/admin/groups/:id`         | 更新／删除分组，必须携带 `version`                     |
| GET / POST           | `/api/admin/events`             | 分页列出／发布事件                                     |
| POST                 | `/api/admin/events/bulk-delete` | 原子删除选中的事件，每项必须携带 `id` 和 `version`     |
| GET / PATCH / DELETE | `/api/admin/events/:id`         | 获取／编辑／删除事件，写入必须携带 `version`           |
| POST                 | `/api/admin/events/:id/updates` | 追加进展，可同时完成手动事件，必须携带 `version`       |

## 访问与错误

管理接口通过 [Cloudflare Access](deployment.md#3-配置-cloudflare-access) 鉴权。写请求须携带同源 `Origin` 和 `Content-Type: application/json`；删除监控、测试连接可发送 `{}`，删除分组或事件须携带 `version`。

错误格式为 `{ "code": "稳定错误码", "params": {} }`。`code` 与语言无关，`params` 为空时省略；界面按当前语言翻译已知错误码，未知错误码显示通用请求失败提示。例如无效检测间隔返回 `{ "code": "monitor_interval_invalid", "params": { "min": 1, "max": 60 } }`。文本长度错误的 `field` 为 `event_title`、`event_body`、`progress_title`、`progress_body` 或 `group_name`，详见[错误码定义](../../src/shared/error-messages.ts)。未知接口返回 JSON `404`；公开接口不返回目标地址、监控配置、JWT 或原始异常。

## 全局设置

GET / PATCH 返回下表字段。PATCH 须携带当前 `version`，其余字段省略时保留原值；无效配置返回 `400`，版本冲突返回 `409`，需重新读取后提交。

| 字段                       | 规则                                                  |
| -------------------------- | ----------------------------------------------------- |
| `version`                  | 当前设置版本，PATCH 必填。                            |
| `performance`              | 性能设置对象，嵌套字段省略时保留原值；见下表。        |
| `pageRefreshSeconds`       | 默认 30，接受 5–3600 的整数秒，或 0（关闭自动刷新）。 |
| `autoIncidentAfterMinutes` | 默认 5，接受 0–1440 的整数分钟，0 关闭新自动事件。    |
| `wafBypassEnabled`         | 布尔值，启用前须配置密钥。                            |
| `wafBypassTokenConfigured` | 只读，表示是否已配置密钥。                            |

刷新间隔、自动事件阈值和 `performance` 数值字段仅接受范围内的整数；字符串、小数、null 和越界值返回 `400`。PATCH 示例：`{"version": 1, "pageRefreshSeconds": 15, "autoIncidentAfterMinutes": 10}`。

性能设置与全局设置共用 `version`，不在公开接口返回；套餐仅接受下表的字符串值。

| 嵌套字段            | 默认值   | 规则                                            |
| ------------------- | -------- | ----------------------------------------------- |
| `workersPlan`       | `"free"` | `"free"` / `"paid"`，应用预算依据，不改变订阅。 |
| `concurrency`       | 4        | 1–6。                                           |
| `maxChecksPerRun`   | 10       | 1–500，单轮候选数量。                           |
| `timeBudgetSeconds` | 50       | 40–180 秒，启动前预留完整超时及 5 秒保存时间。  |

例如 `{"version": 1, "performance": {"concurrency": 6, "maxChecksPerRun": 30}}` 仅修改并发和批量，保留套餐、时间预算以及其他全局设置。估算规则见[调度与容量模型](architecture.md#调度与容量模型)。

`wafBypassToken` 仅用于写入，省略或空字符串保留原密钥，不回传原值。密钥格式与发送规则见 [WAF 凭据](#waf-凭据)。

`GET /api/status`、`GET /api/monitors/:id/history`、`GET /api/events/:id` 和 `GET /api/admin/monitors` 的顶层响应均包含 `pageRefreshSeconds`。公开接口缓存有效期为 `min(pageRefreshSeconds, 60)` 秒，关闭时为 60 秒；已有缓存自然过期后生效。管理接口及失败响应不缓存。`generatedAt` 表示服务端生成数据的时间，界面刷新行为见[页面自动刷新](configuration.md#页面自动刷新)，事件触发规则见[事件生命周期](architecture.md#事件生命周期)。

## 分组与事件

分组包含 `id`、`name`、只读 `sortOrder`、`version`。POST / PATCH 提交 `name`（1–80 字符、不重复），PATCH 另须提交 `version`。新分组追加到普通分组末尾；未分组原本在末尾时继续留在末尾。重命名保留当前位置，调整顺序使用 `PUT /api/admin/groups/order`。删除分组后节点的 `groupId` 变为 null，并按原组内顺序追加到未分组末尾。

监控的 `groupId` 须指向现存普通分组；创建时省略默认 null，PATCH 省略保留原值，传 null 移出分组。只改名称或分组会增加管理版本，保留当前状态、检测计划和连续失败计时。`GET /api/admin/groups` 和 `GET /api/admin/monitors` 返回普通分组 `groups`，以及 `ungrouped: {id: "__ungrouped__", sortOrder, version}`。`GET /api/status` 返回相应的公开信息，省略版本。系统项仅参与排序，PATCH / DELETE 返回 `400 group_readonly`；将其 ID 用作监控 `groupId` 返回 `400 group_invalid`，未分组节点仍使用 null。

管理端监控响应包含只读 `sortOrder`，不属于探测配置，普通监控 POST / PATCH 不接受它作为排序指令。新增或换组的服务追加到目标组末尾。管理和公开列表均按分组顺序、组内服务顺序排列，未分组使用保存的分组位置；普通分组同序按创建时间、ID 保证稳定，未分组在相同序号的普通分组之后。

排序请求的 `items` 必须是目标顺序的完整非空列表，每项为 `{id, expectedVersion, expectedSortOrder}`，其中版本和顺序取自最近一次管理列表响应，而不是目标序号。`PUT /api/admin/groups/order` 提交 `{items}`，必须同时包含全部普通分组及 `__ungrouped__`（包括空分组），返回 `{groups, ungrouped}`。`PUT /api/admin/monitors/order` 提交 `{groupId, items}`，`groupId` 必填，null 表示未分组，返回 `{groupId, monitors}`（该组全部服务）。成功后按数组位置保存从 0 开始的连续序号。

两个排序接口的请求体上限为 256 KiB；缺失或无效参数、重复 ID、空列表返回 `400`，完整成员集合、分组归属、原版本或原顺序不一致返回 `409 order_conflict`。排序原子提交，不发生部分写入。服务排序保留监控 `version`，分组排序增加位置变化的分组版本。保存后使用返回的新快照，冲突后重新读取再提交。

创建或编辑手动事件须提交完整配置：`title`（1–120 字符）、`body`（1–4000 字符纯文本）、`type`（`incident` / `maintenance`）、`monitorIds`（至少一个现存节点，去重，无固定数量上限；请求体仍受 16 KiB 限制）。维护须提供 UTC 毫秒 `startsAt`、`endsAt`，结束晚于开始；故障的这两个字段归一化为 null。编辑另须提交 `version`；已删除节点的名称保留，有此类历史关联时允许 `monitorIds` 为空。

事件响应包含 `id`、`title`、`body`、`type`、`startsAt`、`endsAt`、`source`（`manual` / `automatic`）、`status`（`open` / `resolved` / `stopped`）、`startedAt`、`endedAt`、`createdAt`、`updatedAt`、`monitors` 和 `updates`：

- `monitors` 为 `{id, name}` 数组；已删除节点的 id 为 null，name 保留快照。
- `updates` 中每项包含 `id`、`title`、`body`、`source`、`status`、`createdAt`，按 `createdAt` 升序、同时间按 `id` 升序排列。所有 `title` 均为固定英文阶段，自动恢复和停止跟踪记录分别使用 `Resolved` 和 `Stopped`；仅补充说明时 status 为 null。
- 维护的待开始、进行中、已过计划时间由 `open` 状态和计划时间推导，计划结束不会自动变为 `resolved`。

追加进展示例：`{"version": 1, "title": "Completed", "body": "维护已完成"}`。`title` 去除首尾空白后必须属于当前事件允许的固定阶段，区分大小写；`body` 为 1–4000 字符的纯文本。

| 事件情况           | 允许的 `title`                                                     |
| ------------------ | ------------------------------------------------------------------ |
| 未结束的维护       | `Scheduled`、`Updated`、`In Progress`、`Completed`                 |
| 未结束的手动故障   | `Investigating`、`Identified`、`Monitoring`、`Updated`、`Resolved` |
| 未结束的自动故障   | `Investigating`、`Identified`、`Monitoring`、`Updated`             |
| 已结束事件追加说明 | `Updated`                                                          |

`Completed` 完成维护，`Resolved` 恢复手动故障；进展、事件状态及静默窗口原子更新。其他阶段仅记录说明，不改变计划维护状态或检测结果。`Stopped` 表示系统停止跟踪记录，不接受手动提交。

进展的 `title` 必填；缺失、null、空白、自由文本及当前事件不可用的阶段返回 `400`，不发生写入。

自动事件不能编辑或手动完成，开放时不能删除；过期版本以及不允许的编辑、删除操作返回 `409`，需重新读取后处理。

`POST /api/admin/events/bulk-delete` 接受 `{"items": [{"id": "event-id", "version": 1}]}`，成功返回 `{"ok": true, "deletedCount": 1}`。列表不能为空；每项 ID 须唯一、非空白且不超过 100 字符，版本须为正安全整数。无效选择返回 `400`；请求体上限为 256 KiB，超限返回 `413`，无固定条数上限。所有事件必须存在、版本匹配且允许删除；任一项不满足条件，整批返回 `409 event_bulk_delete_conflict`，不产生修改。数据库执行失败时整批回滚。

批量删除会永久移除选中的事件、关联关系及进展记录。与单条删除一致，尚未开始的静默窗口会被移除，正在生效的窗口结束于删除时刻，过去的静默区间保留供自动故障跟踪使用。后台仅选择当前页事件，翻页清空选择，删除前展示标题和数量供确认。刷新仅保留仍可见、可删除且版本未变的选择；已打开的确认弹窗固定原选择与版本。成功后返回最新页；冲突时清空选择并刷新当前页，供重新选择。

`GET /api/admin/events` 返回 `{events, nextCursor, pageRefreshSeconds}`。每页包含全部 `open` 事件和最多 20 条 `resolved` / `stopped` 事件，合并后按 `updatedAt` 倒序、同时间按 `id` 倒序排列。分页仅作用于已结束事件：将非空 `nextCursor` URL 编码后作为 `?cursor=` 获取下一页历史。全部未结束事件会在每页返回，不占用 20 条历史额度。管理事件含 `version`，公开事件不含管理版本、身份或监控目标。

`/api/status` 始终返回 `groups`、`ungrouped` 和 `events`；`/api/monitors/:id/history` 返回 `checks` 和仅关联该节点的 `events`。`groups` 和 `events` 为空时仍返回数组，监控响应始终包含 `groupId`（未分组为 null）。公开 `events` 包含全部 `open` 事件及最近 20 条 `resolved` / `stopped` 事件，按 `updatedAt` 倒序、同时间按 `id` 倒序排列；未结束事件不受历史条数限制。自动事件文案仅使用节点名称及通用检测描述。

`GET /api/events/:id` 无需登录，返回 `{siteName, event, generatedAt, pageRefreshSeconds}`，使用相同的公开事件字段并包含全部进展。按 ID 读取不受最近 20 条历史记录的限制；事件不存在或已删除时返回 `404`，失败响应不缓存。

## 监控配置

监控 POST / PATCH 的 JSON 请求上限为 256 KiB，其余 API 为 16 KiB，上述排序接口除外。`intervalMinutes` 接受 1–60 的整数分钟，POST 省略默认 1，PATCH 省略保留原值；小数、越界值、字符串和 null 返回 `400`。

创建 HTTP 监控必须显式提供 `method`、`wafBypassEnabled`、`requestHeaders`、`requestBody` 和 `responseCheck`。无自定义请求头使用 `{}`，无请求体或响应校验使用 `null`。管理页面将这些选项初始化为 GET、false、`{}`、null 和 null。PATCH 省略字段保留原值，传 null 可清空请求体或响应校验。服务总数无固定上限。`name` 去除首尾空白后为 1–80 字符，`timeoutSeconds` 为 1–30 的整数，`enabled` 为布尔值。HTTP URL 最多 2048 字符，使用 HTTP 或 HTTPS、公网主机且不包含内嵌凭据。期望状态码为 100–599 的整数，包含上下界，最小值不得大于最大值。

### HTTP 请求与响应规则

`requestHeaders` 为字符串键值对象，按 UTF-8 的 `name: value` 行（含 CRLF）计算，合计最多 8 KiB。名称须为合法 HTTP header token，不区分大小写且不重复；存储时转为小写，值去除首尾空白。值支持制表符及 HTTP 请求头字符，不能换行。保留名称包括 WAF 凭据头、Host、Content-Length 和逐跳传输头，完整列表见[校验代码](../../src/shared/monitors/validation.ts)。Authorization、Cookie 等凭据仅通过管理接口返回。

`requestBody` 为 null 或 `{format: "text" | "json", content: string}`，正文按 UTF-8 最多 16 KiB。JSON 校验格式并保留原文。GET 和 HEAD 要求 null，其他支持的方法可携带请求体，默认 Content-Type 分别为 `text/plain;charset=UTF-8` 或 `application/json`，显式请求头优先。

`responseCheck` 为 null 或 `{includes: string[], excludes: string[], ignoreCase: boolean}`。每组最多 20 项，去除首尾空白、空项及重复项；保留的关键词最多 256 字符且不能换行。两组均为空时归一化为 null。包含项须全部出现，排除项须全部不出现；按 UTF-8 解码后的响应原文匹配字面文本，可忽略大小写，不解析 HTML、JSON 字段或正则表达式。HEAD 要求无有效正文校验。

状态码与关键词须同时通过。关键词校验最多读取 1 MiB 响应数据，超出返回 `response_too_large`；响应正文不保存、不记录到日志。响应头 `cf-mitigated: challenge` 始终判定为 `cloudflare_challenge`。

最多跟随三次重定向，每一跳均验证公网地址。301/302 将 POST 改为 GET，303 将非 GET/HEAD 请求改为 GET，同时删除请求体及相关内容头；307/308 保留方法和正文。协议、主机名或端口改变时移除所有自定义请求头，后续跳转也不恢复。仍需跨源转发正文时返回 `unsafe_redirect`，应直接配置最终地址。定时检测失败不在同次检测中自动重试。

### WAF 凭据

`wafBypassToken` 接受 32–256 位字母、数字、下划线或连字符，界面生成器使用 32 字节随机数。全局开关、单站 HTTP 开关和密钥均就绪时才携带凭据。保存后应用于新的即时测试及下一轮调度快照；关闭全局开关保留密钥和单站设置。

`X-UptimeWorker-WAF-Bypass` 仅发送到当前监控完整域名匹配的 HTTPS 地址，每次重定向重新判断。域名统一大小写、移除尾点并规范化国际化域名；不匹配子域名或通配符，不限制端口。HTTP 目标只有跳转到同域 HTTPS 后才携带密钥，跳回原域名 HTTPS 时可再次发送。TCP 和 IP 地址目标不能开启 WAF 放行。

规则模板汇总并去重所有开启 WAF 的监控域名，包含暂停项。此列表用于配置 Cloudflare 规则，每次探测独立使用自身监控的域名。示例：

```text
(http.host in {"example.com" "api.example.com"}) and
(http.request.method in {"GET" "HEAD" "POST" "PUT" "PATCH" "DELETE" "OPTIONS"}) and
(any(http.request.headers["x-uptimeworker-waf-bypass"][*] eq "<YOUR_TOKEN>"))
```

已保存密钥不通过 API 回传，也不写入日志或历史；重新读取设置后，模板使用 `<YOUR_TOKEN>`。Skip 操作配置见[使用指南](configuration.md#cloudflare-waf-放行)。

### 检测结果

即时测试与历史记录使用 `{checkedAt, ok, latencyMs, httpStatus, errorCode}`。`checkedAt` 为 UTC 毫秒，`latencyMs` 为耗时毫秒，TCP 或尚未取得 HTTP 响应时 `httpStatus` 为 null。目标检测失败返回 `ok: false` 及下列 `errorCode`，与 API 参数校验或鉴权错误分开。

| 错误码                 | 含义                    |
| ---------------------- | ----------------------- |
| `timeout`              | 达到配置超时            |
| `network`              | 连接或读取响应失败      |
| `unexpected_status`    | HTTP 状态码超出期望范围 |
| `redirect_limit`       | 超过三次重定向          |
| `blocked_target`       | 地址或 TCP 目标受限     |
| `cloudflare_challenge` | Cloudflare 返回挑战响应 |
| `content_mismatch`     | 不符合关键词要求        |
| `response_too_large`   | 关键词校验超过 1 MiB    |
| `unsafe_redirect`      | 请求体需要跨源转发      |

### 基本 HTTP 监控

```json
{
  "name": "官网",
  "type": "http",
  "url": "https://example.com/health",
  "method": "GET",
  "wafBypassEnabled": false,
  "requestHeaders": {},
  "requestBody": null,
  "responseCheck": null,
  "expectedStatusMin": 200,
  "expectedStatusMax": 299,
  "intervalMinutes": 1,
  "timeoutSeconds": 10,
  "enabled": true
}
```

### 高级 HTTP 监控

以下示例同时使用请求体、凭据与响应校验。目标站点按 [WAF 放行步骤](configuration.md#cloudflare-waf-放行)配置。

```json
{
  "name": "API 健康检查",
  "type": "http",
  "url": "https://api.example.com/health",
  "method": "POST",
  "wafBypassEnabled": true,
  "requestHeaders": { "Authorization": "Bearer <API_TOKEN>" },
  "requestBody": { "format": "json", "content": "{\"check\":true}" },
  "responseCheck": { "includes": ["healthy"], "excludes": ["error"], "ignoreCase": true },
  "expectedStatusMin": 200,
  "expectedStatusMax": 299,
  "intervalMinutes": 1,
  "timeoutSeconds": 10,
  "enabled": true
}
```

### TCP 监控

TCP 使用 `type: "tcp"`、`hostname`、`port` 替代 HTTP 专属字段，其余公共字段一致。提供公网域名或 IPv4/IPv6 地址，不含协议和路径；端口单独填写，接受 1–65535 的整数，排除 25。Cloudflare 同时限制连接其自身 IP。探测只建立连接，不执行 TLS 或应用协议校验。参见 [TCP Socket 限制](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)。完整契约见[监控类型](../../src/shared/monitors/types.ts)、[公开状态与历史响应](../../src/shared/status/types.ts)、[事件类型](../../src/shared/events/types.ts)及[设置类型](../../src/shared/settings/types.ts)。
