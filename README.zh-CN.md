# UptimeWorker

[English](README.md) | [简体中文](README.zh-CN.md)

基于 Cloudflare Workers 和 D1 的服务监控网站，提供公开状态页和管理后台。

## 功能

- 简体中文 / 英文响应式界面：整体状态、服务详情、24 小时响应时间、30 日可用率和 90 日状态条。
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

打开 [本地状态页](http://127.0.0.1:5173)，后台为 `/admin`。本地数据库、手动触发 Cron 和验证命令见[开发指南](docs/zh-CN/development.md)。

## GitHub Actions 部署

先配置 Cloudflare 与 Access，再设置 GitHub Secrets / Variables，通过 **Actions → Verify and deploy → Run workflow** 手动运行。配置步骤和首次上线验收见[部署指南](docs/zh-CN/deployment.md)。

## 文档

| 文档                                         | 内容                                          |
| -------------------------------------------- | --------------------------------------------- |
| [部署指南](docs/zh-CN/deployment.md)         | Cloudflare、Access、GitHub Actions 与首次验收 |
| [监控配置](docs/zh-CN/configuration.md)      | 监控、分组、事件、WAF、刷新与性能设置         |
| [API 参考](docs/zh-CN/api.md)                | 接口、鉴权、字段规则、检测行为与请求示例      |
| [开发与维护](docs/zh-CN/development.md)      | 本地环境、测试、部署实现、运行观测与恢复      |
| [架构与代码组织](docs/zh-CN/architecture.md) | 代码组织、调度、容量估算、统计与事件规则      |

## License

[Apache-2.0](LICENSE)
