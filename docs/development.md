# 开发与维护

[返回 README](../README.md)

## 本地环境

首次安装和启动见 [README 本地运行](../README.md#本地运行)。以下命令均在仓库根目录执行。

[`.dev.vars.example`](../.dev.vars.example) 中的 `DEV_ACCESS_BYPASS=true` 仅在 Vite 开发模式下对 localhost / 回环地址生效，生产构建会移除该分支。开发服务器应只供本机访问。

开发模式绕过 Worker 公共响应缓存。本地数据库位于 `.wrangler/state/`；浏览器测试使用独立、可丢弃的 `.wrangler/e2e-state/`，与开发及云端数据隔离。

本地 Cron 不会自动按时运行。在开发服务器运行期间，可以手动触发一轮：

```sh
curl 'http://127.0.0.1:5173/cdn-cgi/local/scheduled?cron=*+*+*+*+*'
```

同一分钟内重复触发或上一轮未结束时会跳过。新增或编辑监控后，等待下一个时间窗，或使用后台的“测试连接”。调度行为见[检测、统计与保留策略](configuration.md#检测统计与保留策略)。

## 验证命令

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run check` 执行类型检查、单元 / D1 集成测试和生产构建，并检查 D1、Cron 配置及开发鉴权分支的移除。浏览器测试单独运行；GitHub Actions 会执行两组检查。

按需单独运行：

| 命令                                         | 用途                         |
| -------------------------------------------- | ---------------------------- |
| `npm run typecheck`                          | TypeScript 类型检查          |
| `npm test`                                   | 单元与 D1 集成测试           |
| `npm run test:watch`                         | 监听模式运行 Vitest          |
| `npm run build`                              | 生产构建及产物检查           |
| `npm test -- tests/api.test.ts`              | 只验证 API 边界              |
| `npm run test:e2e -- tests/e2e/site.spec.ts` | 独立运行一个浏览器测试文件   |
| `npm run format`                             | 使用 Prettier 格式化整个仓库 |

局部格式化使用 `npx prettier --write <文件路径>`，仅检查时改用 `--check`。

使用本机 Chromium 时，将 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 设为可执行文件路径。

## 测试职责与隔离

| 测试                                                                                     | 主要职责                                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [validation](../tests/validation.test.ts)、[http-options](../tests/http-options.test.ts) | 配置校验、请求参数、HTTP 方法与重定向、响应内容边界          |
| [probes](../tests/probes.test.ts)                                                        | HTTP/TCP 探测、超时与资源释放、WAF 凭据发送范围              |
| [api](../tests/api.test.ts)                                                              | 路由鉴权、同源写入、JSON 与大小限制、CRUD 版本冲突、公开缓存 |
| [settings](../tests/settings.test.ts)                                                    | 密钥生命周期、旧设置兼容、并发保存、全局设置快照与读取失败   |
| [monitor-options](../tests/monitor-options.test.ts)                                      | 高级配置持久化、监控快照、手动与定时检测一致性、敏感信息保护 |
| [data](../tests/data.test.ts)                                                            | D1 迁移、租约、结果去重、事务回滚、统计与保留策略            |
| [events](../tests/events.test.ts)                                                        | 分组、事件、静默区间、自动故障恢复、并发与事务回滚           |
| [status-summary](../tests/status-summary.test.ts)                                        | 首页故障、维护、检测及数据错误的状态优先级与时间边界         |
| [auth](../tests/auth.test.ts)、[deploy](../tests/deploy.test.mjs)                        | JWT 签名及声明、部署配置和数据库创建 / 复用                  |
| [浏览器测试](../tests/e2e/)                                                              | 管理流程、状态与历史展示、设置恢复、规则更新及移动端布局     |

单元测试使用 HTTP / socket 替身，D1 集成测试在本地 workerd 中运行迁移、SQL 和触发器，JWT 测试使用本地 RSA 密钥。D1 和浏览器测试需要允许监听回环端口。

[API 测试客户端](../tests/api-client.ts) 统一身份、请求头和 JSON 请求。新增断言放入对应功能测试，浏览器测试聚焦交互流程。

[浏览器测试夹具](../tests/e2e/fixtures.ts) 在每个用例前清理监控、事件和分组，恢复 5 分钟自动事件阈值和 30 秒刷新间隔，关闭全局 WAF 并写入固定测试密钥。特殊页面状态使用请求替身构造。各文件应可独立运行；测试串行共用数据库，不要并行启动多个浏览器测试进程。

自动刷新测试使用可控时钟验证轮询、相对时间、慢请求和后台暂停。

失败时保存截图和 trace 到 `test-results/`，GitHub Actions 会上传该目录。

## 项目结构

| 目录                         | 职责                            |
| ---------------------------- | ------------------------------- |
| [src/web](../src/web/)       | 前端页面与交互                  |
| [src/worker](../src/worker/) | API、鉴权、探测、调度和数据访问 |
| [src/shared](../src/shared/) | 共享类型与校验                  |
| [scripts](../scripts/)       | 部署和测试辅助脚本              |
| [migrations](../migrations/) | D1 数据库迁移                   |

## 运行实现

- D1 保存配置与历史，HTTP 高级配置存入 `monitors.config_json`。调度通过租约防止重叠执行，通过结果唯一键和监控版本检查避免重复统计及写入过期配置的结果。
- 每轮检测读取同一份监控和全局设置快照，即时测试读取最新快照；读取失败时不执行检测或写入样本。每轮最多检测 10 项，并发数为 4，结果批量写入。
- 每轮最多清理 500 条过期检测明细、100 条过期日汇总和 100 条过期静默记录。保留期限见[配置指南](configuration.md#检测统计与保留策略)。
- 共享监控上限位于 [src/shared/types.ts](../src/shared/types.ts)，调度批量上限位于 [src/worker/scheduler.ts](../src/worker/scheduler.ts)。调整时需同步修改，并验证每轮外部请求数、CPU 和数据库用量。
- 分组和事件写入通过版本检查防止覆盖；事件父记录的私有写入令牌约束同一事务中的关联、进展和静默更新。自动事件规则在写入检测样本的事务中读取当前设置，与统计一起提交。

## 部署配置

`npm run deploy:prepare` 校验环境变量，按名称创建或复用 D1，生成不含 API Token 的 `wrangler.deploy.json`。工作流设置 `UPTIME_WRANGLER_CONFIG=wrangler.deploy.json` 重新构建，再运行 `npm run deploy:migrate` 应用远端迁移，成功后发布。变量与操作步骤见[部署指南](deployment.md)。

## 数据库迁移

新增数据库变更使用 `migrations/NNNN_description.sql`，不修改已应用到生产的迁移。优先保持向后兼容，先迁移数据库再部署代码；本地升级执行 `npm run db:migrate`，远端由部署工作流应用。恢复操作见[部署指南](deployment.md#回滚与数据库恢复)。

| 迁移                           | 内容与兼容性                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `0003_flexible_intervals.sql`  | 将间隔扩展为 1–60 的整数；同一事务中替换间隔列并恢复汇总触发器，保留配置、历史、统计、调度状态及外键关系。                                |
| `0004_page_refresh.sql`        | 新增 `page_refresh_seconds`，默认 30，允许 0 或 5–3600 的整数秒；保留设置版本、WAF 配置和监控数据，旧代码可继续运行。                     |
| `0005_groups_events.sql`       | 新增分组、事件、节点名称快照、进展、连续失败计时和静默区间；保留监控及统计，已有节点默认未分组，自动事件阈值默认 5 分钟，不补发历史故障。 |
| `0006_event_update_titles.sql` | 新增可空的进展标题；保留历史正文、状态及关联，旧写入与自动进展省略标题时为 null。先应用迁移再部署代码，旧代码仍可运行。                   |

事件时间线与固定进展选项沿用 `0006` 的标题字段，无需新增迁移。读取兼容旧自由标题和无标题记录；新写入仅接受预设阶段，并保留无标题的旧版 `resolve` 请求兼容，具体约定见 [API 参考](api.md#分组与事件)。

迁移测试使用对应旧 schema 的原始 INSERT 准备数据，避免依赖最新列的业务 repository。

## 兼容性说明

- 检测间隔升级保留已有值。保存过 1、2、7 分钟等间隔后，回滚代码也必须支持 1–60 分钟校验。
- 旧监控缺少单站 `wafBypassEnabled` 时按关闭处理。旧 WAF 域名列保留但不再读写，域名名单不再决定凭据发送范围；此变更无需新增迁移，接口兼容行为见 [API 参考](api.md#全局设置)。
- 从旧版 GET/HEAD WAF 规则模板升级时，需同步更新目标站点的 Cloudflare 规则，以放行当前支持的 HTTP 方法。
