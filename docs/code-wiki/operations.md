# 运行与维护

## 环境要求

| 能力 | 要求 |
|---|---|
| 通用 Python 工具 | Python 3，主要依赖标准库 |
| Life Console 前端 | Node.js `>=22.13.0`、npm |
| 移动 Web 构建 | Node.js `>=22.13.0`、npm、Wrangler 工具链 |
| macOS 后台运行 | macOS、`clang`、`codesign`、launchd |
| 语义整理 | macOS Keychain 中的 API Key、显式授权配置、网络访问 |
| XLSX 重建 | 按 `PORTABILITY.md` 安装可选 Node 依赖 |

先运行便携性检查以区分核心缺失与可选运行时：

```bash
python3 tools/portability_doctor.py
```

## 克隆与协作初始化

```bash
tools/setup_git_collaboration.sh
git fetch origin
git worktree add .worktrees/<task> -b agent/<task> origin/main
```

所有通用代码变更都在 `agent/*` 分支和独立 worktree 中完成。真实个人文件不得暂存或提交。

## 运行 Life Console

### 安装与验证前端

```bash
cd apps/life-console
npm ci
npm run check:contracts
npm run build
npm test
```

`npm run check:contracts` 重新生成 TypeScript 契约，并在生成结果与 Git 中版本不一致时失败。

### 前端开发模式

```bash
cd apps/life-console
npm run dev
```

Vite 开发服务器只用于合成或本地 UI 开发。它不是生产 Life Hub，不应作为个人数据 API 暴露。

### 启动本机 Hub

先构建前端，再从 `apps/life-console/` 运行：

```bash
python3 -m hub.server --root /path/to/private/icloud-project
```

省略 `--root` 时使用包含 `apps/life-console` 的仓库根目录。Hub 默认在 `127.0.0.1:47321` 提供静态资源和 API。

常见启动状态参数：

- `--icloud-status readable|writable|partial|unavailable`
- `--automation-status ready|attention|unknown`

`writable` 和 `ready` 只能在目标机器完成真实、可逆的读写验收后使用。合成测试通过只证明适配器行为。

## macOS 打包与 LaunchAgent

### 构建专用启动器

```bash
cd apps/life-console
python3 packaging/build_macos_app.py \
  --output '/path/to/private/runtime/Life Console.app'
```

已有 bundle 需要显式 `--replace`。生成器拒绝不匹配的 app 名称，编译 C launcher，写入 `Info.plist` 并执行 ad-hoc 签名。

### 生成运行文件

```bash
python3 packaging/generate_launch_agent.py \
  --output-dir /path/to/private/runtime \
  --app-root /path/to/staged/life-console \
  --project-root /path/to/private/icloud-project \
  --program '/path/to/private/runtime/Life Console.app/Contents/MacOS/LifeConsoleLauncher' \
  --python-executable /absolute/path/to/python3
```

命令只生成 plist 和 `.command`，不自动安装或加载。文件包含当前机器绝对路径，必须留在权限受限的私有 runtime 目录。

## 运行原子工具

### 日记

敏感 JSON 推荐从 stdin 传入：

```bash
python3 tools/journal_manager.py add --root /path/to/project --input -
python3 tools/journal_manager.py amend --root /path/to/project --input -
python3 tools/journal_manager.py list --root /path/to/project --start 2026-08-01 --end 2026-08-31
```

删除与回顾先运行只读计划：

```bash
python3 tools/journal_manager.py purge-plan --root /path/to/project --id <entry-id>
python3 tools/journal_manager.py review-plan --root /path/to/project --type weekly
```

执行命令必须使用计划返回的完整 revision、etag、来源 ID 和确认信息，不应手工重建参数。

### 每日与复盘台账

```bash
python3 tools/daily_checkin.py upsert --root /path/to/project --date 2026-08-06
python3 tools/daily_checkin.py week-summary --root /path/to/project --week-start 2026-08-03
python3 tools/weekly_review.py upsert --root /path/to/project --week-start 2026-08-03 --input -
python3 tools/phase_review.py upsert --root /path/to/project --review-date 2026-08-14 --input -
python3 tools/phase_actions.py plan --root /path/to/project --review-date 2026-08-14
```

`phase_actions.py apply-plan` 是只读操作。实际目标、提醒或外部动作完成并验证后，才通过 stdin 调用 `mark`。

### Apple Health

```bash
python3 tools/apple_health_sleep.py resolve \
  --summary records/apple-health-latest.txt \
  --details records/apple-health-sleep-latest.txt \
  --target-date 2026-08-06

python3 tools/apple_health_history.py ingest \
  --root /path/to/project \
  --source records/apple-health-latest.txt \
  --expect-date 2026-08-06
```

睡眠解析是只读校准；历史归档按日幂等。两者都不推断主观评分。

## 语义整理配置

配置状态由 `tools/journal_enrichment_state.py` 管理：

```bash
python3 tools/journal_enrichment_state.py status --root /path/to/project
python3 tools/journal_enrichment_state.py enable --root /path/to/project
python3 tools/journal_enrichment_state.py pause --root /path/to/project
python3 tools/journal_enrichment_state.py disable --root /path/to/project
```

`enable` 的授权内容通过 stdin 提交，并要求明确确认外部发送范围。配置只保存生命周期、模型 allowlist 和授权版本，不保存 API Key。

密钥必须写入 macOS Keychain 的受控 service/account。代码通过 `security find-generic-password` 读取；不要使用 `.env`、命令行参数或日志传递。

`pause` 是 kill switch，会撤销当前授权版本。恢复后会生成新版本，旧 preview token 不能提交。

## 移动 Web 开发

`web/life-dashboard/` 的依赖和构建产物不留在 iCloud。使用外部工作区：

```bash
tools/dev_dashboard.sh init ~/Projects/life-dashboard
cd ~/Projects/life-dashboard
npm ci
npm test
```

在外部工作区完成修改后：

```bash
tools/dev_dashboard.sh status
tools/dev_dashboard.sh push
```

源码回写后，部署前必须更新 `PUBLICATION_STATE.json` 为本地未发布状态并刷新指纹。只有托管部署明确成功后才能标记为 `published_current`。

## Google 表格派生

同步协议位于 `integrations/README.md`。本地先生成确定性载荷：

```bash
node tools/google_sheets_payload.mjs
```

仅当私有配置为 `lifecycle_state=active` 且 `sync_cadence=every_record` 时自动刷新。外部连接器应按载荷顺序：

1. 应用表格属性与格式。
2. 清空指定范围。
3. 批量写入值。
4. 读回验证范围。
5. 调用 `google_sheets_state.py mark-success` 保存收据。

`paused` 和 `on_demand` 保留绑定和历史，不自动产生待同步任务。

## 测试体系

### 根工具测试

```bash
python3 -m unittest discover -s tools -p 'test_*.py'
```

覆盖重点包括：

- 幂等与并发合并；
- revision/etag 冲突；
- symlink、hardlink、路径穿越和权限；
- 删除计划与中断恢复；
- 日记索引双向完整性；
- 敏感内容不进入输出；
- 备份源漂移与恢复验证；
- 自动化、外部展示和发布状态。

### Life Console 测试

```bash
cd apps/life-console
npm test
```

该命令依次执行契约生成检查、Vitest 和 Python Hub/packaging/e2e 测试。Fixture 必须是合成数据。

### 移动 Web 测试

```bash
cd ~/Projects/life-dashboard
npm test
```

脚本先构建，再运行 Node 测试。

## 项目级验证

提交前运行：

```bash
git status --short
git diff --check
tools/check_git_privacy.sh
python3 tools/validate_project.py
python3 -m unittest discover -s tools -p 'test_*.py'
```

推送或合入前再检查分支历史：

```bash
tools/check_git_privacy.sh --history origin/main..HEAD
```

`validate_project.py` 检查结构、必需文件、Skill frontmatter、工具能力、设计治理、发布状态、自动化契约和私有路径。`check_git_privacy.sh` 同时扫描禁止路径、凭据模式和机器绝对路径。

## 隐私体检与复现命令

本仓库在写 Code Wiki 前按门禁要求执行了隐私体检，评级为 **B（良好）**。完整 JSON 报告与证据集合在 [docs/privacy-review-2026-08-10.json](../privacy-review-2026-08-10.json)。

### 可复现的内建防线

```bash
# 1) Git 索引 + 历史双防线（禁止路径 + 凭据正则 + 绝对路径）
bash tools/check_git_privacy.sh
bash tools/check_git_privacy.sh --history origin/main..HEAD

# 2) 结构与引用校验；报告中 USER.md/MEMORY.md 等用户私有文件缺失为设计预期
python3 tools/validate_project.py

# 3) 10 项隐私防线单测 + 全量工具测试（310）
python3 -m unittest tools.test_git_privacy -v
python3 -m unittest discover -s tools -p 'test_*.py'
```

### 等效 SAST（未安装 privado.ai 时使用）

```bash
# 高置信凭据硬编码（模式与 privado secret-detector 核心正则子集等效）
grep -rInE '(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN.*PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9_\-\.]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z\-_]{35})' \
  . --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
  --exclude-dir=node_modules --exclude-dir=.git

# 外发端点 / subprocess 注入面（生产代码排除 tests/）
grep -rInE 'requests\.(post|get|put)|urllib\.request\.urlopen|fetch\(|axios\.|https?://|subprocess\.|child_process|os\.system' \
  . --include='*.py' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.git
```

### 如已安装 privado.ai

```bash
privado scan . --overwrite --output docs/privado-output
# 对照：docs/privado-output/privacy-threat-model.json 与 privacy-review-*.json 的 findings 做 union
```

### Life Console Hub 测试（合成数据）

```bash
cd apps/life-console
PYTHONPATH='.:tests:$PYTHONPATH' python3 -m unittest \
  tests.hub.test_semantic_d1 tests.hub.test_semantic_worker_d2 \
  tests.hub.test_hub_read tests.hub.test_hub_write tests.hub.test_hub_enrichment_d3
```

预期 67 OK；测试全程不读取真实日记、状态或健康数据。

## 运行状态

```bash
python3 tools/life_assistant_status.py
python3 tools/life_assistant_status.py --write STATUS.md
```

状态分为：

- `PASS`：结构和当前状态符合合同。
- `ATTENTION`：存在待处理但不等于数据损坏的事项。
- `FAIL`：结构、完整性或安全合同被破坏。

`STATUS.md` 是可重建快照，不是目标、日记或记忆的真相源。

## 备份与恢复

### 创建备份

```bash
python3 tools/create_backup.py
```

工具生成 ZIP、归档校验和与 manifest。备份包含个人数据时会给出明确提示；标准 ZIP 没有独立密码保护。

### 验证和解压

```bash
python3 tools/verify_backup.py /path/to/archive.zip
python3 tools/verify_backup.py /path/to/archive.zip --extract-to /new/empty/directory
```

恢复目标必须不存在。验证在任何解压前完成。

## 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| Hub 返回 `403` | session 过期、Origin 或 CSRF 不匹配 | 让客户端刷新 `/api/v1/session`；不要放宽同源策略 |
| 返回 `REVISION_CONFLICT` | 同一记录已被其他入口更新 | 读取最新投影，合并用户明确字段后重试 |
| 返回 `SOURCE_INVALID` | 源文件损坏、未知字段、路径异常或来源漂移 | 运行完整性和项目校验，不直接覆盖源文件 |
| 写入成功但 `pending_refresh` | 真相源已更新，Dashboard 重建失败 | 修复只读投影问题后刷新，不重放写请求 |
| 语义整理 `PREVIEW_EXPIRED` | token 超过 10 分钟或已消费 | 重新生成预览 |
| 语义整理未授权 | 配置暂停、禁用或授权版本变化 | 重新展示外发范围并取得明确授权 |
| Keychain 不可用 | 密钥未配置或权限不足 | 修复 Keychain 项；不要降级到明文配置 |
| Google 状态 stale | 外部写入、读回或源一致性未完成 | 保留本地成功，下一次按 SOP 重试 |
| Web 状态未发布 | 指纹显示本地源码领先托管版本 | 取得发布同意并完成真实部署 |
| 隐私检查失败 | 私有路径、凭据或机器路径进入变更 | 移出 Git 变更并重新扫描，不绕过 hook |

## 变更规则

- 修改 OpenAPI 后重新生成 TypeScript 类型并运行契约测试。
- 修改原子工具时增加同域测试，覆盖并发、漂移和输出隐私。
- 修改 UI 时同步核对 `docs/design/` 三层设计依据。
- 修改真相源格式时提供显式迁移、幂等重试和旧版本拒绝策略。
- 修改发布源码后同步维护发布状态指纹。
- 不在不相关变更中格式化大文件或重写私有派生物。
