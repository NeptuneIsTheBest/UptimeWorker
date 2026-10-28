# API 参考

[返回 README](../README.md)

## 接口列表

| 方法                 | 路径                            | 说明                                             |
| -------------------- | ------------------------------- | ------------------------------------------------ |
| GET                  | `/api/status`                   | 站点信息、分组、当前状态、每日可用率、最近事件   |
| GET                  | `/api/monitors/:id/history`     | 服务展示数据、最近 24 小时明细、关联事件         |
| GET                  | `/api/admin/monitors`           | 监控完整配置、身份与数量限制                     |
| POST                 | `/api/admin/monitors`           | 创建监控                                         |
| PATCH                | `/api/admin/monitors/:id`       | 更新配置，必须携带当前 `version`                 |
| DELETE               | `/api/admin/monitors/:id`       | 删除监控及历史                                   |
| POST                 | `/api/admin/monitors/:id/test`  | 只测试已保存目标，不写入统计                     |
| GET                  | `/api/admin/settings`           | 全局设置、版本及密钥是否已配置，不返回密钥       |
| PATCH                | `/api/admin/settings`           | 更新全局设置，必须携带当前 `version`             |
| GET / POST           | `/api/admin/groups`             | 列出／创建分组                                   |
| PATCH / DELETE       | `/api/admin/groups/:id`         | 更新／删除分组，必须携带 `version`               |
| GET / POST           | `/api/admin/events`             | 分页列出／发布事件                               |
| GET / PATCH / DELETE | `/api/admin/events/:id`         | 获取／编辑／删除事件，写入必须携带 `version`     |
| POST                 | `/api/admin/events/:id/updates` | 追加进展，可同时完成手动事件，必须携带 `version` |

## 访问与错误

管理接口必须通过 [Cloudflare Access](deployment.md#2-创建-access-应用)；写请求必须携带同源 `Origin` 和 `Content-Type: application/json`，删除监控／连接测试可发送 `{}`，删除分组／事件须携带 `version`。公开接口不返回目标地址、配置、JWT 或原始异常。错误统一为 `{ "error": "说明" }`，未知 API 返回 JSON 404。

## 全局设置

全局设置的 GET / PATCH 响应为 `version`、`pageRefreshSeconds`、`autoIncidentAfterMinutes`、`wafBypassEnabled`、`wafBypassTokenConfigured`。PATCH 必须携带当前 `version`，其余字段可按需提交；`wafBypassToken` 仅用于写入，省略或空字符串保留原密钥。旧请求中的 `wafBypassDomains`、`wafBypassAutoDomains` 会被忽略，不再返回或参与放行判定。配置不合法返回 `400`，版本冲突返回 `409`，需重新读取设置后提交。

`pageRefreshSeconds` 默认 `30`，接受 `5–3600` 的整数秒或 `0`（关闭自动刷新）；省略时保留当前值，字符串、小数、null 和越界值返回 `400`。例如 `{"version": 1, "pageRefreshSeconds": 15}` 将三个数据页的刷新间隔统一设为 15 秒。

`GET /api/status`、`GET /api/monitors/:id/history` 和 `GET /api/admin/monitors` 的顶层响应均包含 `pageRefreshSeconds`。公开接口缓存有效期为 `min(pageRefreshSeconds, 60)` 秒，关闭时为 60 秒；已有缓存自然过期后才反映新设置。管理接口及失败响应不缓存。`generatedAt` 仍表示服务端生成数据的时间；界面的“上次刷新”使用客户端成功接收数据的时间，命中缓存也会更新。

`autoIncidentAfterMinutes` 默认为 `5`，接受 `0–1440` 的整数分钟，`0` 表示关闭新自动事件。PATCH 省略保留原值，无效值返回 `400`；例如 `{"version": 1, "autoIncidentAfterMinutes": 10}`。自动规则在成功写入定时检测样本的事务中读取当前配置，规则及维护静默说明见[监控配置](configuration.md#服务器分组与事件)。

## 分组与事件

分组包含 `id`、`name`、`sortOrder` 和管理版本 `version`；名称为 1–80 字符且不重复，`sortOrder` 为 0–1000000 的整数。POST / PATCH 发送 `name` 和 `sortOrder`，PATCH 额外发送 `version`。删除分组后节点的 `groupId` 变为 null。

监控 POST / PATCH 支持 `groupId`：创建时省略默认 null，PATCH 省略保留原值，传 null 移出分组。分组必须存在。只修改名称或分组会增加管理版本，但不会清空当前状态、检测计划和连续失败计时。`GET /api/admin/monitors` 额外返回 `groups`。

手动事件创建／编辑提交完整配置：`title`（1–120 字符）、`body`（1–4000 字符纯文本）、`type`（`incident` 或 `maintenance`）、`monitorIds`（1–10 个现存节点）。维护还必须填写 UTC 毫秒 `startsAt`、`endsAt`，结束须晚于开始；故障的两个时间字段归一化为 null。编辑额外提交 `version`。编辑时保留已删除节点的名称快照；如果已有此类历史关联，允许 `monitorIds` 为空。

事件响应包含 `id`、上述展示字段、`source`（`manual` / `automatic`）、`status`（`open` / `resolved` / `stopped`）、`startedAt`、`endedAt`、`createdAt`、`updatedAt`、`monitors` 和 `updates`。`monitors` 是 `{id, name}` 数组，已删除节点的 id 为 null，name 保留快照。进展包含 `id`、`body`、`source`、`status`、`createdAt`；仅补充说明时 status 为 null。维护的待开始／进行中／已过计划时间由 open 状态和计划起止时间推导，不会按计划结束自动变为 resolved。

追加进展示例：`{"version": 1, "body": "维护已完成", "resolve": true}`。`resolve` 省略或 false 只追加说明；true 将开放的手动事件完成并结束静默，进展和状态原子提交。自动事件不能编辑配置或手动完成，开放时不能删除；这些冲突及过期版本返回 `409`，需重新读取后重试。

`GET /api/admin/events` 返回 `{events, nextCursor, pageRefreshSeconds}`，每页 20 条；将非空 nextCursor URL 编码后作为 `?cursor=` 取得下一页，管理数据不缓存。管理事件额外包含 `version`。公开 `/api/status` 返回 `groups` 和最新 20 条 `events`，详情 `/api/monitors/:id/history` 返回最新 20 条关联 `events`，保留原有 `checks`。公开事件不带管理版本、身份或监控目标，自动文案只使用节点名称及通用检测描述。

## 监控配置

监控 POST / PATCH 的 JSON 请求上限为 256 KiB，其余 API 仍为 16 KiB。`intervalMinutes` 支持 1–60 的整数分钟，POST 省略时默认 1，PATCH 省略时保留原值；小数、越界值、字符串和 null 均返回 `400`。已有监控不会自动改为 1 分钟。

HTTP 的 `method` 缺省为 GET，`wafBypassEnabled` 缺省为 false，`requestHeaders` 缺省为空对象，`requestBody`、`responseCheck` 缺省为 null；PATCH 省略字段保留原配置，传 null 可清空请求体或响应校验。HTTP 高级字段继续保存在 `config_json`；间隔范围变更需要应用新的数据库迁移。

### 基本 HTTP 监控

HTTP 创建示例：

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

各选项的大小限制、重定向规则及 WAF 配置见[监控配置指南](configuration.md)。

带参数与响应校验的 HTTP 创建示例：

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
