# API 参考

[返回 README](../README.md)

## 接口列表

| 方法                 | 路径                            | 说明                                             |
| -------------------- | ------------------------------- | ------------------------------------------------ |
| GET                  | `/api/status`                   | 站点信息、分组、当前状态、每日可用率、未结束与历史事件   |
| GET                  | `/api/monitors/:id/history`     | 服务展示数据、最近 24 小时明细、关联事件         |
| GET                  | `/api/admin/monitors`           | 完整监控配置、分组、身份与数量上限               |
| POST                 | `/api/admin/monitors`           | 创建监控                                         |
| PATCH                | `/api/admin/monitors/:id`       | 更新配置，必须携带当前 `version`                 |
| DELETE               | `/api/admin/monitors/:id`       | 删除监控及历史                                   |
| POST                 | `/api/admin/monitors/:id/test`  | 只测试已保存目标，不写入统计                     |
| GET                  | `/api/admin/settings`           | 全局设置、版本与密钥配置状态                     |
| PATCH                | `/api/admin/settings`           | 更新全局设置，必须携带当前 `version`             |
| GET / POST           | `/api/admin/groups`             | 列出／创建分组                                   |
| PATCH / DELETE       | `/api/admin/groups/:id`         | 更新／删除分组，必须携带 `version`               |
| GET / POST           | `/api/admin/events`             | 分页列出／发布事件                               |
| GET / PATCH / DELETE | `/api/admin/events/:id`         | 获取／编辑／删除事件，写入必须携带 `version`     |
| POST                 | `/api/admin/events/:id/updates` | 追加进展，可同时完成手动事件，必须携带 `version` |

## 访问与错误

管理接口通过 [Cloudflare Access](deployment.md#2-创建-access-应用) 鉴权。写请求须携带同源 `Origin` 和 `Content-Type: application/json`；删除监控、测试连接可发送 `{}`，删除分组或事件须携带 `version`。

错误格式为 `{ "error": "说明" }`，未知接口返回 JSON `404`。公开接口不返回目标地址、监控配置、JWT 或原始异常。

## 全局设置

GET / PATCH 返回下表字段。PATCH 须携带当前 `version`，其余字段省略时保留原值；无效配置返回 `400`，版本冲突返回 `409`，需重新读取后提交。

| 字段                       | 规则                                                  |
| -------------------------- | ----------------------------------------------------- |
| `version`                  | 当前设置版本，PATCH 必填。                            |
| `pageRefreshSeconds`       | 默认 30，接受 5–3600 的整数秒，或 0（关闭自动刷新）。 |
| `autoIncidentAfterMinutes` | 默认 5，接受 0–1440 的整数分钟，0 关闭新自动事件。    |
| `wafBypassEnabled`         | 布尔值，启用前须配置密钥。                            |
| `wafBypassTokenConfigured` | 只读，表示是否已配置密钥。                            |

刷新间隔和自动事件阈值均不接受字符串、小数、null 或越界值。PATCH 示例：`{"version": 1, "pageRefreshSeconds": 15, "autoIncidentAfterMinutes": 10}`。

`wafBypassToken` 仅用于写入，省略或空字符串保留原密钥，不回传原值。旧字段 `wafBypassDomains`、`wafBypassAutoDomains` 会被忽略，不返回也不参与放行判定。

`GET /api/status`、`GET /api/monitors/:id/history` 和 `GET /api/admin/monitors` 的顶层响应均包含 `pageRefreshSeconds`。公开接口缓存有效期为 `min(pageRefreshSeconds, 60)` 秒，关闭时为 60 秒；已有缓存自然过期后生效。管理接口及失败响应不缓存。`generatedAt` 表示服务端生成数据的时间，界面刷新行为见[页面自动刷新](configuration.md#页面自动刷新)，事件触发规则见[服务器分组与事件](configuration.md#服务器分组与事件)。

## 分组与事件

分组包含 `id`、`name`、`sortOrder`、`version`。POST / PATCH 提交 `name`（1–80 字符、不重复）和 `sortOrder`（0–1000000 的整数），PATCH 另须提交 `version`。删除分组后节点的 `groupId` 变为 null。

监控的 `groupId` 须指向现存分组；创建时省略默认 null，PATCH 省略保留原值，传 null 移出分组。只改名称或分组会增加管理版本，保留当前状态、检测计划和连续失败计时。`GET /api/admin/monitors` 返回 `groups`。

创建或编辑手动事件须提交完整配置：`title`（1–120 字符）、`body`（1–4000 字符纯文本）、`type`（`incident` / `maintenance`）、`monitorIds`（1–10 个现存节点）。维护须提供 UTC 毫秒 `startsAt`、`endsAt`，结束晚于开始；故障的这两个字段归一化为 null。编辑另须提交 `version`；已删除节点的名称保留，有此类历史关联时允许 `monitorIds` 为空。

事件响应包含 `id`、`title`、`body`、`type`、`startsAt`、`endsAt`、`source`（`manual` / `automatic`）、`status`（`open` / `resolved` / `stopped`）、`startedAt`、`endedAt`、`createdAt`、`updatedAt`、`monitors` 和 `updates`：

- `monitors` 为 `{id, name}` 数组；已删除节点的 id 为 null，name 保留快照。
- `updates` 中每项包含 `id`、`title`、`body`、`source`、`status`、`createdAt`；`title` 为独立进展标题或 null，历史及自动生成进展可无标题；仅补充说明时 status 为 null。
- 维护的待开始、进行中、已过计划时间由 `open` 状态和计划时间推导，计划结束不会自动变为 `resolved`。

追加进展示例：`{"version": 1, "title": "升级完成", "body": "维护已完成", "resolve": true}`。`title` 选填，去除首尾空白后最多 120 字符；省略、null 或空白统一保存为 null，其他类型及超长标题返回 `400`。`body` 仍须为 1–4000 字符的纯文本。`resolve` 省略或 false 只追加说明；true 同时完成开放的手动事件并结束静默，标题、正文和状态一起提交。自动事件不能编辑或手动完成，开放时不能删除；这些冲突及过期版本返回 `409`，需重新读取后重试。

`GET /api/admin/events` 返回 `{events, nextCursor, pageRefreshSeconds}`，每页 20 条；将非空 `nextCursor` URL 编码后作为 `?cursor=` 获取下一页。管理事件含 `version`，公开事件不含管理版本、身份或监控目标。

`/api/status` 返回 `groups` 和 `events`；`/api/monitors/:id/history` 返回 `checks` 和仅关联该节点的 `events`。公开 `events` 包含全部 `status = open` 的事件，以及最近 20 条已结束事件（`resolved` / `stopped`），合计可以超过 20 条；整体按 `updatedAt` 倒序、同时间按 `id` 倒序排列。未结束事件不受历史条数限制，待开始及已过计划时间但尚未确认完成的维护仍包含在内。自动事件文案仅使用节点名称及通用检测描述。

## 监控配置

监控 POST / PATCH 的 JSON 请求上限为 256 KiB，其余 API 为 16 KiB。`intervalMinutes` 接受 1–60 的整数分钟，POST 省略默认 1，PATCH 省略保留原值；小数、越界值、字符串和 null 返回 `400`。

创建 HTTP 监控时，`method` 默认 GET，`wafBypassEnabled` 默认 false，`requestHeaders` 默认 `{}`，`requestBody`、`responseCheck` 默认 null。PATCH 省略字段保留原值，传 null 可清空请求体或响应校验。数量上限、超时和检测行为见[基本配置](configuration.md#基本配置)。

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

TCP 使用 `type: "tcp"`、`hostname`、`port` 替代 HTTP 专属字段，其余公共字段一致。完整类型定义见 [src/shared/types.ts](../src/shared/types.ts)。
