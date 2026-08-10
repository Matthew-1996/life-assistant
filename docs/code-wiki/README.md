# Life Assistant Code Wiki

> 基线：`455d4e0`（2026-08-06）
> 读者：开发者、维护者、代码审查者与迁移负责人
> 隐私体检：**B（良好）** · 报告：[privacy-review-2026-08-10.json](../privacy-review-2026-08-10.json) · Code Wiki 门禁：**已通过**

## 项目定位

Life Assistant Agent Toolkit 是一套以本地文件为真相源的个人生活助手工程。仓库同时包含三类能力：

1. `skills/improve-daily-life/` 定义助手的判断规则、工作流和审批边界。
2. `tools/` 提供日记、状态、复盘、健康摘要、外部展示和备份等原子能力。
3. `apps/life-console/` 提供 Mac 本机工作站，通过 localhost Hub 调用原子工具。

Git 仓库只保存通用代码、合成测试数据和设计规范。真实用户资料、日记、状态、健康数据、服务绑定和机器运行态位于私有 iCloud 工作区，不属于可移植代码仓库。

## Wiki 导航

| 文档 | 内容 |
|---|---|
| [整体架构](architecture.md) | 系统边界、组件关系、写入链路、语义整理链路 |
| [模块与关键符号](modules.md) | 主要目录、模块职责、关键类与函数 |
| [接口与数据](interfaces-and-data.md) | `/api/v1` 接口、数据真相源、并发与一致性机制 |
| [运行与维护](operations.md) | 环境、启动、测试、打包、校验、备份和协作 |

## 仓库地图

| 路径 | 角色 | 是否持有真实数据 |
|---|---|---|
| `apps/life-console/` | React 桌面 UI、Python Life Hub、OpenAPI、macOS 打包 | 否，测试仅使用合成数据 |
| `skills/improve-daily-life/` | 主 Skill、领域规则、Prompt、评估集 | 否 |
| `tools/` | 原子 CLI、校验器、同步与备份工具 | 代码本身不持有；运行时读写私有工作区 |
| `web/life-dashboard/` | 移动端展示脚手架与日期逻辑 | Git 中只保存通用源码 |
| `docs/design/` | 顶层设计系统、验收原型、UI/UE 规范 | 否 |
| `integrations/` | 外部展示同步协议与 SOP | 配置绑定留在私有工作区 |
| `research/` | 调研、审计与验收记录 | 只允许通用、去敏内容 |
| `journal/`、`records/` | 私有运行时真相源位置 | 是，因此真实内容被 Git 排除 |
| `outputs/`、`backups/` | 派生导出与恢复快照 | 是，因此不进入 Git |

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面前端 | React 19、TypeScript、Vite、Vitest、Testing Library |
| 本机 Hub | Python 3 标准库、`ThreadingHTTPServer` |
| API 契约 | OpenAPI 3.1、`openapi-typescript`、AJV |
| 移动展示 | Next.js、React、vinext、Vite、Cloudflare Wrangler、Drizzle ORM |
| 原子工具 | Python 标准库为主，少量 Node.js ESM 工具 |
| 数据存储 | Markdown、JSON、JSONL、XLSX/ZIP 派生物，无中心数据库 |
| macOS 运行 | LaunchAgent 生成器、专用本机 `.app` 启动器 |

## 隐私与安全防线速览

> 事实：以下防线都经过源码审查和测试验证；完整评级、证据与复现命令见 [隐私体检报告](../privacy-review-2026-08-10.json)。

| 防线 | 源码位置 | 验证结果 |
|---|---|---|
| Git 索引 + 历史双防线 | [check_git_privacy.sh](../../tools/check_git_privacy.sh) + [test_git_privacy.py](../../tools/test_git_privacy.py#L16-L203) | PASS · 10/10 用例 |
| 凭据硬编码正则扫描 | 等效 SAST（sk-/AKIA/PRIVATE KEY/ghp_/Bearer/xox/AIza） | 0 命中 · 全仓库 |
| DeepSeek Key 来源 | [keychain.py](../../apps/life-console/hub/semantic/keychain.py#L15-L54) · 仅 macOS Keychain，`shell=False` | PASS · 无降级路径 |
| 外发端点白名单 | [deepseek_client.py](../../apps/life-console/hub/semantic/deepseek_client.py#L23-L116) · 仅 `https://api.deepseek.com` | PASS · 非 allowlist 直接抛错 |
| 原始日记/状态日志泄露 | 生产路径 `print/console.*(raw|entry|content|body)` 扫描 | 0 命中 |
| 绝对路径/用户名泄露 | `/Users/*` 排除合成 fixture 后的源码扫描 | 0 命中 |
| `.env` / 凭据持久化文件 | find `.env` `.npmrc` `credentials.json` `*.pem` `*.key` | 0 files |
| 项目结构 + 引用校验 | [validate_project.py](../../tools/validate_project.py) | PASS · 私有用户文件缺失为预期 |
| 通用工具测试 | `python3 -m unittest discover -s tools -p 'test_*.py'` | 310 OK · 1 skip |
| Life Console Hub + Enrichment 测试 | `PYTHONPATH=. python3 -m unittest tests.hub.*` | 67 OK · 合成 Fixture |

**评级结论**：B（良好）。核心硬防线全部通过；待补项为 privado.ai 语义 PII 追踪和外部开发工作区的 npm audit，均不阻塞 Code Wiki。

## 设计原则

- **iCloud 是真相源**：UI、Google 表格和网页是投影，不反向定义个人数据。
- **写入走原子工具**：Hub 不直接编辑日记或台账文件，而是通过固定 CLI 适配器调用 `tools/`。
- **先预览再确认**：永久删除、长期认识和云端语义整理都保存可复核的中间状态。
- **并发失败关闭**：revision、etag、来源指纹、文件锁和原子替换共同防止丢失更新。
- **最小暴露**：日志、状态页和审计文件只输出状态、计数、哈希与通用错误码。
- **契约驱动**：OpenAPI 是本地 API 与 TypeScript 类型的共同来源。

## 阅读顺序

新维护者先阅读本页和[整体架构](architecture.md)，再按任务进入对应文档：

- 修改 Life Console：阅读[模块与关键符号](modules.md)中的 Life Console 章节和[接口与数据](interfaces-and-data.md)。
- 修改日记或复盘工具：阅读原子工具章节和一致性模型。
- 部署或换机：阅读[运行与维护](operations.md)。
- 修改界面：先读 `docs/design/README.md`，再读已验收原型与长期 UI/UE 规范。

## 文档边界

本 Wiki 根据仓库中的通用源码、OpenAPI、README、测试和设计规范生成。它不读取或复述真实日记、健康台账、个人目标、外部服务标识和机器凭据。实现细节变更后，应同步更新对应 Wiki 页面，并以源码与契约为最终依据。
