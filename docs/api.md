# API 参考

[返回 README](../README.md)

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
| GET / PATCH / DELETE | `/api/admin/events/:id`         | 获取／编辑／删除事件，写入必须携带 `version`           |
| POST                 | `/api/admin/events/:id/updates` | 追加进展，可同时完成手动事件，必须携带 `version`       |

## 访问与错误

管理接口通过 [Cloudflare Access](deployment.md#2-创建-access-应用) 鉴权。写请求须携带同源 `Origin` 和 `Content-Type: application/json`；删除监控、测试连接可发送 `{}`，删除分组或事件须携带 `version`。

错误格式为 `{ "error": "说明", "code": "稳定错误码", "params": {} }`，无参数时省略 `params`。`error` 保留原有中文说明以兼容旧客户端；`code` 与语言无关，前端用它和 `params` 本地化显示。未知错误码或旧响应仍可显示 `error`。例如无效检测间隔返回 `{ "error": "检测间隔需为 1–60 分钟的整数", "code": "monitor_interval_invalid", "params": { "min": 1, "max": 60 } }`；文本长度错误的 `field` 参数使用 `event_title`、`event_body`、`progress_title`、`progress_body` 或 `group_name` 标识。错误码定义见 [error-messages](../src/shared/error-messages.ts)。未知接口返回 JSON `404`。公开接口不返回目标地址、监控配置、JWT 或原始异常。

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

刷新间隔和自动事件阈值均不接受字符串、小数、null 或越界值。PATCH 示例：`{"version": 1, "pageRefreshSeconds": 15, "autoIncidentAfterMinutes": 10}`。

`performance` 的数值字段仅接受范围内的整数，字符串、null、小数和越界值均返回 `400`；套餐仅接受下表的字符串值。性能设置与其他全局设置共用 `version`，不在公开接口返回。

| 嵌套字段            | 默认值   | 规则                                            |
| ------------------- | -------- | ----------------------------------------------- |
| `workersPlan`       | `"free"` | `"free"` / `"paid"`，应用预算依据，不改变订阅。 |
| `concurrency`       | 4        | 1–6。                                           |
| `maxChecksPerRun`   | 10       | 1–500，单轮候选数量。                           |
| `timeBudgetSeconds` | 50       | 40–180 秒，启动前预留完整超时及 5 秒保存时间。  |

例如 `{"version": 1, "performance": {"concurrency": 6, "maxChecksPerRun": 30}}` 仅修改并发和批量，保留套餐、时间预算以及其他全局设置。估算规则见[性能设置与容量估算](configuration.md#性能设置与容量估算)。

`wafBypassToken` 仅用于写入，省略或空字符串保留原密钥，不回传原值。旧字段 `wafBypassDomains`、`wafBypassAutoDomains` 会被忽略，不返回也不参与放行判定。

`GET /api/status`、`GET /api/monitors/:id/history`、`GET /api/events/:id` 和 `GET /api/admin/monitors` 的顶层响应均包含 `pageRefreshSeconds`。公开接口缓存有效期为 `min(pageRefreshSeconds, 60)` 秒，关闭时为 60 秒；已有缓存自然过期后生效。管理接口及失败响应不缓存。`generatedAt` 表示服务端生成数据的时间，界面刷新行为见[页面自动刷新](configuration.md#页面自动刷新)，事件触发规则见[服务器分组与事件](configuration.md#服务器分组与事件)。

## 分组与事件

分组包含 `id`、`name`、`sortOrder`、`version`。POST / PATCH 提交 `name`（1–80 字符、不重复），可选 `sortOrder`（0–1000000 的整数），PATCH 另须提交 `version`。创建省略顺序时追加到末尾，编辑省略时保留原顺序；兼容旧客户端的数字排序。追加时若已有顺序占满数值范围，会先按现有顺序归一化并更新受影响分组的版本。删除分组后节点的 `groupId` 变为 null，并按原组内顺序追加到未分组末尾。

监控的 `groupId` 须指向现存分组；创建时省略默认 null，PATCH 省略保留原值，传 null 移出分组。只改名称或分组会增加管理版本，保留当前状态、检测计划和连续失败计时。`GET /api/admin/monitors` 返回 `groups`。

管理端监控响应增加只读 `sortOrder`，不属于探测配置，普通监控 POST / PATCH 不接受它作为排序指令。新增或换组的服务追加到目标组末尾。管理和公开列表均按分组顺序、组内服务顺序排列，未分组在最后；同序按创建时间、ID 保证稳定。

排序请求的 `items` 必须是目标顺序的完整非空列表，每项为 `{id, expectedVersion, expectedSortOrder}`，其中版本和顺序取自最近一次管理列表响应，而不是目标序号。`PUT /api/admin/groups/order` 提交 `{items}`，返回 `{groups}`；`PUT /api/admin/monitors/order` 提交 `{groupId, items}`，`groupId` 必填，null 表示未分组，返回 `{groupId, monitors}`（该组全部服务）。成功后按数组位置保存从 0 开始的连续序号。

两个排序接口的请求体上限为 256 KiB；缺失或无效参数、重复 ID、空列表返回 `400`，完整成员集合、分组归属、原版本或原顺序与数据库不一致返回 `409 order_conflict`。排序在单条数据库更新中校验全量快照并提交，不发生部分写入。服务排序不修改监控 `version`，正在执行的检测继续有效；分组排序会增加顺序发生变化的分组版本。保存后客户端应使用返回的新快照，冲突时重新读取再提交。

创建或编辑手动事件须提交完整配置：`title`（1–120 字符）、`body`（1–4000 字符纯文本）、`type`（`incident` / `maintenance`）、`monitorIds`（至少一个现存节点，去重，无固定数量上限；请求体仍受 16 KiB 限制）。维护须提供 UTC 毫秒 `startsAt`、`endsAt`，结束晚于开始；故障的这两个字段归一化为 null。编辑另须提交 `version`；已删除节点的名称保留，有此类历史关联时允许 `monitorIds` 为空。

事件响应包含 `id`、`title`、`body`、`type`、`startsAt`、`endsAt`、`source`（`manual` / `automatic`）、`status`（`open` / `resolved` / `stopped`）、`startedAt`、`endedAt`、`createdAt`、`updatedAt`、`monitors` 和 `updates`：

- `monitors` 为 `{id, name}` 数组；已删除节点的 id 为 null，name 保留快照。
- `updates` 中每项包含 `id`、`title`、`body`、`source`、`status`、`createdAt`，按 `createdAt` 升序、同时间按 `id` 升序排列；新写入的 `title` 为固定英文阶段，旧记录仍可能是自由标题或 null，自动生成进展可无标题；仅补充说明时 status 为 null。
- 维护的待开始、进行中、已过计划时间由 `open` 状态和计划时间推导，计划结束不会自动变为 `resolved`。

追加进展示例：`{"version": 1, "title": "Completed", "body": "维护已完成"}`。`title` 去除首尾空白后必须属于当前事件允许的固定阶段，区分大小写；`body` 为 1–4000 字符的纯文本。

| 事件情况           | 允许的 `title`                                                     |
| ------------------ | ------------------------------------------------------------------ |
| 未结束的维护       | `Scheduled`、`Updated`、`In Progress`、`Completed`                 |
| 未结束的手动故障   | `Investigating`、`Identified`、`Monitoring`、`Updated`、`Resolved` |
| 未结束的自动故障   | `Investigating`、`Identified`、`Monitoring`、`Updated`             |
| 已结束事件追加说明 | `Updated`                                                          |

`Completed` 同时完成维护，`Resolved` 同时恢复手动故障；进展、事件状态及静默窗口在同一事务中提交。其他阶段仅记录说明，不改变维护时间推导或检测结果。`Stopped` 仅用于展示系统停止跟踪记录，不接受手动提交。

兼容旧客户端：省略 `title`、传 null 或空白时，默认保存为 `Updated`；若同时传 `resolve: true`，按事件类型保存为 `Completed` 或 `Resolved` 并完成事件。显式提交的 `resolve` 必须与固定阶段的完成含义一致。新自由文本标题、不可用阶段及冲突参数返回 `400`，且不发生写入。旧自由标题仍可读取，界面将其保留为补充文字。

自动事件不能编辑或手动完成，开放时不能删除；过期版本及旧版 `resolve: true` 请求试图完成自动或已结束事件时返回 `409`，需重新读取后处理。

`GET /api/admin/events` 返回 `{events, nextCursor, pageRefreshSeconds}`，每页 20 条；将非空 `nextCursor` URL 编码后作为 `?cursor=` 获取下一页。管理事件含 `version`，公开事件不含管理版本、身份或监控目标。

`/api/status` 返回 `groups` 和 `events`；`/api/monitors/:id/history` 返回 `checks` 和仅关联该节点的 `events`。公开 `events` 包含全部 `status = open` 的事件，以及最近 20 条已结束事件（`resolved` / `stopped`），合计可以超过 20 条；整体按 `updatedAt` 倒序、同时间按 `id` 倒序排列。未结束事件不受历史条数限制，待开始及已过计划时间但尚未确认完成的维护仍包含在内。自动事件文案仅使用节点名称及通用检测描述。

`GET /api/events/:id` 无需登录，返回 `{siteName, event, generatedAt, pageRefreshSeconds}`。`event` 使用同一公开字段集合，包含全部进展，不包含管理版本、身份或监控目标。按 ID 读取不受列表最近 20 条历史记录的限制；事件不存在或已删除时返回 `404`，失败响应不缓存。

## 监控配置

监控 POST / PATCH 的 JSON 请求上限为 256 KiB，其余 API 为 16 KiB。`intervalMinutes` 接受 1–60 的整数分钟，POST 省略默认 1，PATCH 省略保留原值；小数、越界值、字符串和 null 返回 `400`。

创建 HTTP 监控时，`method` 默认 GET，`wafBypassEnabled` 默认 false，`requestHeaders` 默认 `{}`，`requestBody`、`responseCheck` 默认 null。PATCH 省略字段保留原值，传 null 可清空请求体或响应校验。服务总数无固定上限，`GET /api/admin/monitors` 不再返回 `limit`，创建不再返回 `monitor_limit`。超时和检测行为见[基本配置](configuration.md#基本配置)。

### 基本 HTTP 监控

```json
{
  "name": "官网",
  "type": "http",
  "url": "https://example.com/health",
  "method": "GET",
  "expectedStatusMin": 200,
  "expectedStatusMax": 299,
  "intervalMinutes": 1,
  "timeoutSeconds": 10,
  "enabled": true
}
```

### 高级 HTTP 监控

请求参数、大小限制和重定向规则见 [HTTP 高级配置](configuration.md#http-高级配置)，放行步骤见 [Cloudflare WAF 放行](configuration.md#cloudflare-waf-放行)。以下示例创建带请求体和响应校验的监控：

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

TCP 使用 `type: "tcp"`、`hostname`、`port` 替代 HTTP 专属字段，其余公共字段一致。完整契约见[监控类型](../src/shared/monitors/types.ts)、[公开状态与历史响应](../src/shared/status/types.ts)、[事件类型](../src/shared/events/types.ts)及[设置类型](../src/shared/settings/types.ts)。
