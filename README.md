# UptimeWorker

基于 Cloudflare Workers 和 D1 的服务监控网站，提供公开状态页和管理后台。

## 功能

- 中文响应式界面：整体状态、服务详情、24 小时响应时间、30 日可用率和 90 日状态条。
- HTTP/HTTPS 与 TCP Port 检测，支持自定义请求、响应校验和单站 WAF 放行。
- 通过 Cloudflare Access 登录后台，管理监控、分组与排序，支持暂停 / 恢复和即时连接测试。
- 公开维护与故障事件，可关联多个节点、追加进展；连续离线自动发布，恢复后自动完成。

## 本地运行

需要 Node.js 24 或更新版本。

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate
npm run dev
```

打开 [本地状态页](http://127.0.0.1:5173)，后台为 `/admin`。开发服务器仅供本机访问；本地数据库、手动触发 Cron 和验证命令见[开发指南](docs/development.md)。

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
