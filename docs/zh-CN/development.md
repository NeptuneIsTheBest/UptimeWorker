# 开发与维护

[English](../development.md) | [简体中文](development.md)

[返回 README](../../README.zh-CN.md)

## 本地环境

首次安装和启动见 [README 本地运行](../../README.zh-CN.md#本地运行)。以下命令均在仓库根目录执行。

[`.dev.vars.example`](../../.dev.vars.example) 中的 `DEV_ACCESS_BYPASS=true` 仅在 Vite 开发模式下对 localhost / 回环地址生效，生产构建会移除该分支。开发服务器应只供本机访问。

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

`npm run check` 执行类型检查、单元 / D1 集成测试和生产构建，包括 D1、Cron 配置及开发鉴权分支移除检查。浏览器测试单独运行，GitHub Actions 执行两组检查。

按需单独运行：

| 命令                                                        | 用途                         |
| ----------------------------------------------------------- | ---------------------------- |
| `npm run typecheck`                                         | TypeScript 类型检查          |
| `npm test`                                                  | 单元与 D1 集成测试           |
| `npm run test:watch`                                        | 监听模式运行 Vitest          |
| `npm run build`                                             | 生产构建及产物检查           |
| `npm test -- tests/platform/api.test.ts`                    | 只验证 API 边界              |
| `npm run test:e2e -- tests/e2e/monitors/management.spec.ts` | 独立运行一个浏览器测试文件   |
| `npm run format`                                            | 使用 Prettier 格式化整个仓库 |

局部格式化使用 `npx prettier --write <文件路径>`，仅检查时改用 `--check`。

使用本机 Chromium 时，将 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 设为可执行文件路径。

## 测试职责与隔离

| 测试                                                                                | 主要职责                               |
| ----------------------------------------------------------------------------------- | -------------------------------------- |
| [monitors](../../tests/features/monitors/)                                          | 配置、HTTP/TCP 探测、WAF、调度与统计   |
| [groups](../../tests/features/groups/) / [ordering](../../tests/features/ordering/) | 分组归属、原子排序、冲突与检测状态保留 |
| [events](../../tests/features/events/)                                              | 事件生命周期、阶段、静默、恢复与事务   |
| [settings](../../tests/features/settings/)                                          | 设置校验、密钥、兼容性与并发保存       |
| [status](../../tests/features/status/)                                              | 总状态、维护时间边界与数据错误         |
| [platform](../../tests/platform/)                                                   | API 契约、鉴权、缓存、迁移与部署       |
| [浏览器测试](../../tests/e2e/)                                                      | 页面交互、刷新、表单、排序与响应式布局 |

单元测试使用 HTTP / socket 替身，JWT 使用本地 RSA 密钥；D1 集成测试在本地 workerd 中运行迁移、SQL 和触发器。D1 和浏览器测试需要监听回环端口。

使用 [API 测试客户端](../../tests/support/api-client.ts) 统一身份、请求头和 JSON 请求，将断言放入对应功能测试。浏览器测试聚焦交互，刷新和时间行为使用可控时钟验证。

[浏览器夹具](../../tests/e2e/support/fixtures.ts) 在每个用例前重置数据与设置。各文件须可独立运行；测试串行共用数据库，不要并行启动多个浏览器测试进程。失败截图和 trace 保存到 `test-results/`，由 GitHub Actions 上传。

## 代码组织

代码按 `web / worker / shared` 分层，各层内按监控、分组、事件、设置和状态展示归档。功能职责、依赖方向、请求与检测流程、样式组织及新增功能约定见[架构与代码组织](architecture.md)。

## 部署配置

`npm run deploy:prepare` 校验环境变量，按名称创建或复用 D1，生成不含 API Token 的 `wrangler.deploy.json`。工作流设置 `UPTIME_WRANGLER_CONFIG=wrangler.deploy.json` 重新构建，再运行 `npm run deploy:migrate` 应用远端迁移，成功后发布。变量与操作步骤见[部署指南](deployment.md)。

## 数据库迁移

`0001_initial.sql` 是面向全新数据库的首次发布基线，直接创建完整的监控、分组、事件、设置与调度结构，包括索引和触发器。它初始化全局设置、调度租约行，以及排序值为 `0` 的内部 `__ungrouped__` 记录；未分组节点仍使用 `group_id = NULL`。保留全部现有字段，包括已停用的历史 WAF 域名列。

此基线替代发布前的迁移历史，不提供这些旧数据库的升级路径。验证初始化时使用全新的本地数据库或独立持久化目录；现有本地数据库不会自动重置。

后续数据库变更从 `migrations/0002_description.sql` 开始，按编号递增，不修改已应用到生产的迁移。优先向后兼容，先迁移再部署代码；本地执行 `npm run db:migrate`，远端由部署工作流应用。升级前查看[兼容性说明](#兼容性说明)，回滚前查看[数据库恢复](deployment.md#回滚与数据库恢复)。

迁移测试从空 D1 数据库初始化，检查默认值、约束、索引和外键，并验证检测汇总与级联删除。功能测试覆盖自动事件生命周期与展示排序。测试夹具按编号执行全部 SQL 迁移。

## 兼容性说明

- 回滚性能功能会恢复旧的创建与调度限制，超过 10 个服务的部署应避免回滚。旧设置请求及移除字段见 [API 参考](api.md#全局设置)和[监控配置](api.md#监控配置)。
- 事件进展兼容旧自由标题和无标题的 `resolve` 请求，见[事件兼容规则](api.md#分组与事件)。
- 保存过 1、2、7 分钟等间隔后，回滚代码仍须支持 1–60 分钟校验。
- 旧监控缺少 `wafBypassEnabled` 时按关闭处理；历史 WAF 域名列保留但不使用，此变更无需迁移。旧 GET/HEAD WAF 规则需更新为放行当前支持的全部 HTTP 方法。

## 界面语言

界面使用 React Context 和 `src/web/i18n/messages.ts` 中的类型安全词典。新增文案同时补充中英文，动态值使用命名参数，英文复数使用 `one` / `other`。持久通知保存为 `message(key, params)`，错误通过 `errorMessage` 归一化，在渲染时按当前语言解析。

共享校验与 Worker 错误使用稳定错误码和参数，保留旧中文说明。事件阶段和已识别的自动事件模板只翻译展示文案，API 值、节点名称、用户内容和未知历史文本保持不变。

浏览器测试默认为 `zh-CN`，覆盖范围见[语言测试](../../tests/e2e/platform/i18n.spec.ts)。新增标签、提示、错误、标题和无障碍名称需检查两种语言。

## 文档维护

默认英文文档使用 `README.md` 和 `docs/*.md`，简体中文使用 `README.zh-CN.md` 和 `docs/zh-CN/` 下的同名文件。两版同步更新，保持章节、示例和技术参数一致。

README 概述功能，指南围绕操作；接口契约写入 API 参考，实现细节写入开发或架构文档，避免穷举界面交互行为。

语言切换链接指向同一文档的对应语言版本，其他交叉引用保持当前语言；保留历史标题锚点，中文指南通过 `../../` 引用仓库文件。翻译说明和界面名称，保持命令、API 字段、枚举、错误码、配置值、中文错误响应原文及许可证不变。

检查相对链接、锚点、JSON 示例和 Markdown 展示，再执行：

```sh
npx prettier --check README.md README.zh-CN.md "docs/**/*.md"
```
