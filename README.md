# UptimeWorker

部署在 Cloudflare Workers 上的轻量服务监控网站，提供公开状态页、Cloudflare Access 管理后台和 D1 历史数据。

## 功能

- 中文响应式界面：整体状态、服务详情、24 小时响应时间、30 日可用率和 90 日状态条。
- HTTP/HTTPS 与 TCP Port 检测，支持自定义请求、响应校验和单站 WAF 放行。
- 后台管理、暂停 / 恢复及即时连接测试。
- D1 保存配置与历史，通过租约、结果唯一键和配置版本保障调度与统计一致性。
- Worker 校验 Access JWT，通过 GitHub Actions 手动验证和部署。

面向小规模、免费优先场景，最多 10 个监控（包括暂停项），没有告警和用户注册功能。检测频率、平台限制和用量说明见[监控配置指南](docs/configuration.md)。

## 本地运行

需要 Node.js 24 或更新版本。

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate
npm run dev
```

打开 [本地状态页](http://127.0.0.1:5173)，后台为 `/admin`。本地开发身份仅用于回环地址，不要将开发服务器暴露到公网；数据库位置、手动触发 Cron 和验证命令见[开发指南](docs/development.md)。

## GitHub Actions 部署

先配置 Cloudflare 与 Access，再设置 GitHub Secrets / Variables，通过 **Actions → Verify and deploy → Run workflow** 手动运行。完整步骤、上线验收和回滚说明见[部署指南](docs/deployment.md)。

## 文档

| 文档                              | 内容                                               |
| --------------------------------- | -------------------------------------------------- |
| [部署指南](docs/deployment.md)    | Cloudflare、Access、GitHub Actions、上线验收与回滚 |
| [监控配置](docs/configuration.md) | HTTP/TCP、WAF、统计口径、保留策略与运行观测        |
| [API 参考](docs/api.md)           | 接口、鉴权、请求限制、版本控制与请求示例           |
| [开发与维护](docs/development.md) | 本地环境、验证命令、测试职责、项目结构与迁移约定   |

## License

[Apache-2.0](LICENSE)
