# 开发与维护

[返回 README](../README.md)

## 本地环境

首次安装和启动见 [README 本地运行](../README.md#本地运行)。以下命令均在仓库根目录执行。

[`.dev.vars.example`](../.dev.vars.example) 中的 `DEV_ACCESS_BYPASS=true` 仅在 Vite 开发模式、且请求主机是 localhost / 回环地址时生效。它不会进入生产 Worker。不要将开发服务器暴露到公网。

本地数据库位于 `.wrangler/state/`，不会写入云端。自动化浏览器测试使用独立且可丢弃的 `.wrangler/e2e-state/`，不会清空本地开发数据库。仓库不会提交真实密钥、开发数据或测试数据。

本地 Cron 不会自动按时运行。在开发服务器运行期间，可以手动触发一轮：

```sh
curl 'http://127.0.0.1:5173/cdn-cgi/local/scheduled?cron=*/5+*+*+*+*'
```

同一 5 分钟时间窗只执行一次；重复触发不会增加统计。新增监控或编辑配置后，等待下一个时间窗，或使用后台的“测试连接”。

## 验证命令

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run check` 执行类型检查、单元 / D1 集成测试和生产构建。构建同时检查 D1、Cron 配置，并确保产物不包含本地开发鉴权分支。浏览器测试另行运行，GitHub Actions 的验证阶段会执行上述两组检查。

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

局部改动可用 `npx prettier --write <文件路径>` 只格式化相关文件；改用 `--check` 可只检查而不写入。

若使用本机已有的 Chromium，可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 为浏览器可执行文件路径后运行浏览器测试。

## 测试职责与隔离

| 测试                                                                                     | 主要职责                                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [validation](../tests/validation.test.ts)、[http-options](../tests/http-options.test.ts) | 配置校验、请求参数、HTTP 方法与重定向、响应内容边界          |
| [probes](../tests/probes.test.ts)                                                        | HTTP/TCP 探测、超时与资源释放、WAF 凭据发送范围              |
| [api](../tests/api.test.ts)                                                              | 路由鉴权、同源写入、JSON 与大小限制、CRUD 版本冲突、公开缓存 |
| [settings](../tests/settings.test.ts)                                                    | 密钥生命周期、旧设置兼容、并发保存、全局设置快照与读取失败   |
| [monitor-options](../tests/monitor-options.test.ts)                                      | 高级配置持久化、监控快照、手动与定时检测一致性、敏感信息保护 |
| [data](../tests/data.test.ts)                                                            | D1 迁移、租约、结果去重、事务回滚、统计与保留策略            |
| [auth](../tests/auth.test.ts)、[deploy](../tests/deploy.test.mjs)                        | JWT 签名及声明、部署配置和数据库创建 / 复用                  |
| [浏览器测试](../tests/e2e/)                                                              | 管理流程、状态与历史展示、设置恢复、规则更新及移动端布局     |

单元测试使用可控 HTTP / socket 替身；D1 集成测试在真实本地 workerd 中运行迁移、SQL 和触发器；JWT 测试使用本地 RSA 密钥验证签名与声明。测试不会访问生产数据库。运行 D1 和浏览器测试的环境需要允许监听本地回环端口。

[API 测试客户端](../tests/api-client.ts) 统一测试身份、请求头和 JSON 请求；具体功能测试保留各自的业务断言。新增测试应优先放入对应层级，避免在浏览器中重复枚举已经由单元测试覆盖的参数组合。

[浏览器测试夹具](../tests/e2e/fixtures.ts) 在每个用例前清理监控、关闭全局 WAF 并写入固定测试密钥，用例不依赖其他测试留下的数据。未配置密钥等特定页面状态使用请求替身构造。每个测试文件都应能够独立运行；当前配置串行使用同一个测试数据库，不应并行启动多个浏览器测试进程。

仅失败时自动保存截图并保留 trace，产物位于 `test-results/`；没有固定截图或图片快照比较。GitHub Actions 在验证失败时上传该目录。

## 项目结构

| 目录                         | 职责                            |
| ---------------------------- | ------------------------------- |
| [src/web](../src/web/)       | 前端页面与交互                  |
| [src/worker](../src/worker/) | API、鉴权、探测、调度和数据访问 |
| [src/shared](../src/shared/) | 共享类型与校验                  |
| [scripts](../scripts/)       | 部署和测试辅助脚本              |
| [migrations](../migrations/) | D1 数据库迁移                   |

依赖版本以 [package.json](../package.json) 和 lockfile 为准；Cloudflare 开发工具使用的 `undici` 由 npm override 固定版本。

## 数据库迁移

新数据库变更放入新的 `migrations/NNNN_description.sql` 文件，不修改已经在生产应用过的迁移。优先使用向后兼容的迁移，本地验证后由部署工作流应用到远端。发布失败与恢复策略见[部署指南](deployment.md#回滚与数据库恢复)。
