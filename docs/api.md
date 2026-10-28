# API 参考

[返回 README](../README.md)

## 接口列表

| 方法   | 路径                           | 说明                                       |
| ------ | ------------------------------ | ------------------------------------------ |
| GET    | `/api/status`                  | 站点信息、当前状态、每日可用率             |
| GET    | `/api/monitors/:id/history`    | 服务展示数据、最近 24 小时明细             |
| GET    | `/api/admin/monitors`          | 监控完整配置、身份与数量限制               |
| POST   | `/api/admin/monitors`          | 创建监控                                   |
| PATCH  | `/api/admin/monitors/:id`      | 更新配置，必须携带当前 `version`           |
| DELETE | `/api/admin/monitors/:id`      | 删除监控及历史                             |
| POST   | `/api/admin/monitors/:id/test` | 只测试已保存目标，不写入统计               |
| GET    | `/api/admin/settings`          | 全局设置、版本及密钥是否已配置，不返回密钥 |
| PATCH  | `/api/admin/settings`          | 更新全局设置，必须携带当前 `version`       |

## 访问与错误

管理接口必须通过 [Cloudflare Access](deployment.md#2-创建-access-应用)；写请求必须携带同源 `Origin` 和 `Content-Type: application/json`，DELETE / 测试可发送 `{}`。公开接口不返回目标地址、配置、JWT 或原始异常。错误统一为 `{ "error": "说明" }`，未知 API 返回 JSON 404。

## 全局设置

全局设置的 GET / PATCH 响应为 `version`、`wafBypassEnabled`、`wafBypassTokenConfigured`。PATCH 必须携带当前 `version`，其余字段可按需提交；`wafBypassToken` 仅用于写入，省略或空字符串保留原密钥。旧请求中的 `wafBypassDomains`、`wafBypassAutoDomains` 会被忽略，不再返回或参与放行判定。配置不合法返回 `400`，版本冲突返回 `409`，需重新读取设置后提交。

## 监控配置

监控 POST / PATCH 的 JSON 请求上限为 256 KiB，其余 API 仍为 16 KiB。HTTP 的 `method` 缺省为 GET，`wafBypassEnabled` 缺省为 false，`requestHeaders` 缺省为空对象，`requestBody`、`responseCheck` 缺省为 null；PATCH 省略字段保留原配置，传 null 可清空请求体或响应校验。新增字段继续保存在 `config_json`，无需新增数据库迁移。

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
  "intervalMinutes": 5,
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
  "intervalMinutes": 5,
  "timeoutSeconds": 10,
  "enabled": true
}
```

### TCP 监控

TCP 使用 `type: "tcp"`、`hostname`、`port` 替代 HTTP 专属字段，其余公共字段一致。完整类型定义见 [src/shared/types.ts](../src/shared/types.ts)。
