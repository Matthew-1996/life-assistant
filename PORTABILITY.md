# 迁移与恢复说明

项目背景、规则、目标、日记、状态台账、源码和锁定文件必须只以当前 iCloud 目录为可迁移真相源。Google 表格只是可重建展示，机器本地缓存、虚拟环境、Codex 安装文件和聊天线程都不是可靠备份。但“上下文可迁移”不等于所有编辑和构建能力都零依赖：Python、Node.js、官方校验器、Google 连接器和归档工作簿运行时的边界见下文。

## 项目内已经保存

- 工作区规则：`AGENTS.md`
- 用户稳定偏好：`USER.md`
- 长期决定与事实：`MEMORY.md`
- 动态目标：`GOALS.md`
- 项目背景摘要：`PROJECT_CONTEXT.md`
- 核心 Skill、references、assets 和 UI 元数据：`skills/improve-daily-life/`
- 调研、来源评分和完成审计：`research/`
- 当前计划与记录模板：`plans/`
- 可视化生活计划表及其维护脚本：`outputs/`、`tools/update_life_plan_growth.mjs`、`tools/render_life_plan.mjs`
- 移动端只读看板源码及不含站点标识的发布状态：`web/life-dashboard/`、`web/life-dashboard/PUBLICATION_STATE.json`。后者用部署源码指纹区分“本地已验证”与“已发布”，不能替代联网访问核验。
- 主动回访的可读说明、机器契约与规范提示词：`automations/生活状态回访.md`、`automations/registry.json`、`automations/生活状态回访.prompt.txt`
- 对话回访的同日唯一状态台账，以及带精确确认、revision/内容哈希保护的单日删除工具：`records/daily-checkins.jsonl`（无真实记录时可以不存在）、`tools/daily_checkin.py`、`tools/test_daily_checkin.py`
- 对话式自然周复盘的独立台账，以及 stdin 短摘要、同周幂等、跨年 ISO 周、独立锁和精确单周删除工具：`records/weekly-reviews.jsonl`（无真实记录时可以不存在）、`tools/weekly_review.py`、`tools/test_weekly_review.py`
- 对话式阶段复盘的独立台账，以及固定原复盘日、stdin 去敏短摘要/枚举、幂等更新和精确删除工具：`records/phase-reviews.jsonl`（无真实记录时可以不存在）、`tools/phase_review.py`、`tools/test_phase_review.py`
- 从阶段复盘派生、但不执行外部变更的可恢复动作台账：`records/phase-actions.jsonl`（无派生动作时可以不存在）、`tools/phase_actions.py`、`tools/test_phase_actions.py`。它用来源 etag、revision 和状态保留中断恢复信息；一旦明确回答 `next_track`，互斥门会排除未选分支，而在该字段完全缺失时，另行明确的依赖项会各自独立派生；要锁定互斥分支应先保存 `next_track`。来源漂移会使旧动作 `superseded`。
- 对话式生活日记、索引与周期回顾：`journal/`
- 日记数据流、撤回、永久删除与历史副本边界：`journal/PRIVACY.md`
- 零依赖日记归档/周月回顾工具及测试：`tools/journal_manager.py`、`tools/test_journal_manager.py`。它会区分精确、约略与未知发生时间；机器索引采用严格白名单，列表使用安全投影；内容更正要求完整重建轻量索引；同月撤回/恢复只修改目标条目块；可按 `recorded_at` 原子撤回最近一次隐式保存；`review-plan` 只规划已经结束且缺失、失效或来源变化的完整自然周/月，并为完整 active 来源集合返回 `source_set_etag`，`review` 在锁内重验后才写入。
- 日记索引—原文双向完整性工具及测试：`tools/journal_integrity.py`、`tools/test_journal_integrity.py`。它只输出计数和结构状态；孤立来源、缺失来源、路径错配、重复标识或异常格式都会 fail closed。`journal/review-policy.json` 另存试运行与长期整理节奏，长期未确认时保持待选择。
- 日记候选长期认识确认工具及测试：`tools/journal_insights.py`、`tools/test_journal_insights.py`。状态链是 `pending → awaiting_proposal → proposed → applied`，另有 `rejected/superseded`；accept 只进入待提案。`propose` 用 revision/etag 保存目标文件、精确文字和哈希，中断后 `apply-plan` 可只读恢复并展示同一提案；助手只在用户精确确认后写长期文件，`mark-applied` 还必须验证目标已包含该文字。工具本身不写长期文件，公开状态只输出计数。`journal/insight-decisions.jsonl` 只在有候选时创建，且可能含精确长期文件提案。
- 从 `journal/index.jsonl`、`records/daily-checkins.jsonl` 与可选 `records/weekly-reviews.jsonl` 同时重建生活计划表“日记索引”、“每日记录”D:P 和“每周复盘”I:N 派生区域的脚本：`tools/update_life_plan_journal.mjs`、`tools/life_plan_records.mjs`。同步前会保护表头、自然周和公式，再按完整源台账重写；无周源时 I:N 为空，删除每日或每周源记录后也不会残留旧值。成功同步后同目录的 `生活计划表.sync-state.json` 以 0600 权限绑定最终 XLSX 和三个源的存在性/字节 SHA-256，不保存绝对路径或日记内容。日常调用将预览目录设为 `-`，渲染图仅在权限 0700 的系统临时目录中以 0600 文件存在并在本轮清理；人工指定目录时则保留预览。在新环境由电子表格 Skill 提供 `@oai/artifact-tool` 运行时，不把旧机器依赖路径写入项目。
- 完全隔离的日记到工作簿端到端测试：`tools/test_journal_workbook_e2e.mjs`。它使用系统临时目录和合成内容，验证新增、更正、撤回、恢复、闭合周回顾、两次 XLSX 同步、原文不进入索引/工作簿及真实项目未被测试修改；需要当前环境提供 Node.js 与 `@oai/artifact-tool`。
- 零外部依赖验证器：`tools/validate_project.py`
- 零外部依赖运行状态检查器及测试：`tools/life_assistant_status.py`、`tools/test_life_assistant_status.py`
- 助手运行状态快照：`STATUS.md`。这是可重建的派生文件，不是目标、记忆或日记的真相来源，也不需要为了它单独再生成备份。
- 零外部依赖备份脚本：`tools/create_backup.py`
- 零外部依赖备份校验与安全恢复工具：`tools/verify_backup.py`
- 只读迁移环境 doctor：`tools/portability_doctor.py`
- 独立压缩快照和校验文件：`backups/`
- 真实恢复演练记录：`research/2026-08-01-换机恢复演练.md`

每次备份都会明确提示：ZIP 包含个人生活助手项目数据，且标准 ZIP 没有独立密码。存在真实日记、非空每日状态、周/阶段复盘、候选认识或阶段动作台账时，脚本会分别给出额外敏感数据提示；候选台账可含精确长期文件提案，阶段动作台账可含期望值与执行状态。ZIP 仍只写入当前 iCloud 项目的 `backups/`，但应把它视为额外敏感副本。是否启用独立加密及密钥保管方式需要用户另行决定，不由助手静默设置。

备份脚本在写入前会拒绝高置信的凭据文件名和私钥内容，例如 `.env`、`.npmrc`、`credentials.json`、私钥文件或私钥头。模板用 `.env.example` 可以保留，但不得填入真实凭据。预检失败时应将凭据移出项目并轮换已暴露的秘密，不要仅改文件名绕过。脚本固定本次文件集合、身份、模式、精确字节和哈希，直接在该内存快照上验证日记双向完整性，以及可选的阶段复盘、候选提案与阶段动作台账结构；任一异常都在三件套发布前 fail closed，错误不回显台账内容。ZIP 与 manifest 只用固定字节，发布前再拒绝任何新增、删除、替换或内容漂移。

## 环境依赖分层

- **恢复必需**：Python 3.9 或更高版本。项目内校验、状态检查、备份、日记、候选认识、每日状态、自然周/阶段复盘和阶段动作工具只用 Python 标准库；当前这些读改写链路的并发锁还依赖 macOS/Linux 的 `fcntl`，不能直接在 Windows Python 下运行。
- **可选官方 Skill 校验**：系统提供的 `quick_validate.py` 需要 `PyYAML==6.0.3`，见 `tools/requirements-validator.txt`。PyYAML 缺失不影响项目自带的 `validate_project.py` 或日常使用。
- **日常展示同步**：`tools/google_sheets_payload.mjs` 同时读取日记机器索引、每日状态台账和可选周复盘台账，以源数据重建 Google 表格中的“日记索引”、“每日记录”D:P 和“每周复盘”I:N；这些区域只读，不接受反向录入。脚本只需 Node.js 生成载荷，实际写入需要用户个人 Google Drive/Sheets 连接器。`tools/google_sheets_state.py` 保存不含凭据的绑定配置和源哈希收据。原 `tools/update_life_plan_journal.mjs` 与 `@oai/artifact-tool` 仅用于明确导出、恢复演练或手工 Numbers 备选。
- **移动端本地构建**：`web/life-dashboard/package.json` 当前声明 Node.js `>=22.13.0`。`package-lock.json` 会备份，`node_modules/` 不会；需要构建时在该目录运行 `npm ci`，并需要可用的 npm 源。

换机后先运行 `python3 tools/portability_doctor.py`。它只读检查必需文件和上述能力；`FAIL` 表示恢复核心链路受阻，`ATTENTION` 通常只表示工作簿或网页等可选能力尚未就绪。

## 已验证的真实恢复演练

2026-08-01 使用 `tools/verify_backup.py --extract-to` 把 `backups/生活助手-完整备份-2026-08-01-r18.zip` 解压到一个原本不存在的系统临时目录，实际恢复 93 个普通文件。恢复副本随后通过核心 doctor、`validate_project.py`、232 项 Python 测试、官方 Skill 校验、8 项移动端测试、严格发布状态/源码指纹检查、日记工作簿源映射和完整隔离端到端演练；再从当前 Codex 环境重新定位 Node 与 `@oai/artifact-tool`，成功重新同步工作簿并生成 0600 收据，渲染 8 张工作表且公式错误为零。该演练证据随审计文件进入后续不可覆盖的 `r19` 快照。

这证明 ZIP 中的项目真相源可以独立恢复，但不表示可选运行时已经打包：恢复副本在普通环境下仍会如实提示 PyYAML、网页依赖或工作簿运行时尚未就绪。详细命令、范围与限制见 `research/2026-08-01-换机恢复演练.md`。

当前首轮自动化会在 2026-08-03 和 2026-08-10 的周一检查已经结束的日记自然周；这只是 2026-08-02 至 2026-08-14 试运行契约，不代表 8 月 14 日之后已选择长期频率。长期每周、每月或仅按需整理，必须等待用户明确决定后再保存新契约。移动端最新滚动七日与日记控制源码也只保存在项目内；`PUBLICATION_STATE.json` 明确标记为 `local_changes_unpublished`，因此线上地址仍按此前发布版本处理，重新发布需要当次明确同意。

## 明确不保存

- 密码、API key、访问令牌、完整证件或银行卡信息；
- 已安装的 Python 虚拟环境和包缓存；
- Codex 应用自身的系统 Skill；
- 原始聊天逐字稿。用户明确要求留存的生活日记会单独保存在 `journal/`；其他关键背景压缩进 `PROJECT_CONTEXT.md`、`MEMORY.md` 和研究文件。

## 在旧电脑交还前

1. 运行 `python3 tools/portability_doctor.py`，确认恢复必需项没有 `FAIL`。
2. 运行 `python3 tools/validate_project.py`，结果应为 `PASS`。
3. 运行 `python3 tools/create_backup.py`，确认 `backups/` 中最新 ZIP、ZIP 的 SHA-256 和文件清单都存在；再用 `python3 tools/verify_backup.py --archive "backups/<精确 ZIP 文件名>"` 验证这一组三件套。
4. 运行 `python3 tools/life_assistant_status.py --write STATUS.md`；`FAIL` 必须处理，`ATTENTION` 只表示有复盘或整理事项待助手择机处理。
5. 等待 iCloud 完成同步；在 Finder 中确认没有等待上传图标，最好再从 iCloud.com 或另一台设备打开最新 ZIP。
6. 不要把项目文件、ZIP 或个人计划留在工作电脑的下载目录、桌面、终端历史导出或其他非 iCloud 位置。
7. 在另一台受你控制的设备已验证项目和最新备份后，按公司 IT 流程退出个人 iCloud，并由 IT 清理本机同步缓存或执行规定的整机擦除。不要直接在仍同步的 iCloud 目录中删除项目，否则可能同步回删云端副本；任何实际删除、退出账号或擦除操作都要在当次明确确认后进行。

## 在新电脑恢复

1. 从 iCloud 下载整个项目目录，不要只下载 ZIP；ZIP 是灾备副本。
2. 用 Codex 打开项目根目录。根目录的 `AGENTS.md` 会指引新会话读取正确上下文。
3. 先运行只读环境 doctor，再运行项目校验和状态检查：

```bash
python3 tools/portability_doctor.py
python3 tools/validate_project.py
python3 -m unittest tools.test_journal_manager -v
python3 -m unittest tools.test_journal_integrity -v
python3 -m unittest tools.test_weekly_review -v
python3 -m unittest tools.test_phase_review -v
python3 -m unittest tools.test_journal_insights -v
python3 -m unittest tools.test_phase_actions -v
python3 tools/life_assistant_status.py --write STATUS.md
```

日记、周/阶段复盘、候选认识和阶段动作测试只在系统临时目录创建合成样例，不会写入项目的真实日记或台账。截至 2026-08-01 项目没有真实日记、周/阶段复盘记录、候选确认或阶段动作台账；恢复后相应机器索引/台账不存在或为空都表示尚未记录，不是数据损坏，也不应生成补写任务。

如果当前 Codex 环境已经重新定位 Node.js 与 `@oai/artifact-tool`，再运行 `tools/test_life_plan_records.mjs` 和 `tools/test_journal_workbook_e2e.mjs`。不要把旧电脑的绝对运行时路径写进项目；端到端测试会自行使用临时目录，并校验正式工作簿和真实 `journal/` 未变化。

4. 如果项目目录损坏，用 `backups/` 中的 ZIP 恢复。优先使用项目内的零依赖校验工具；它会自动找同 stem 的 `.zip.sha256` 和 `.files.sha256`，校验 ZIP 本体 SHA-256、CRC、安全路径、普通文件类型、成员集合和每个文件的内容哈希。请明确选中一个 ZIP，不要把不同修订的三个文件混用：

```bash
archive="backups/生活助手-完整备份-YYYY-MM-DD-rN.zip"
python3 tools/verify_backup.py --archive "$archive"
```

需要恢复时，传入一个尚不存在、且父目录已存在的新目录。工具会先全量校验，通过后才创建恢复目录；不会覆盖已有目录：

```bash
python3 tools/verify_backup.py --archive "$archive" --extract-to restore-test
cd restore-test/codex-生活助手
python3 tools/portability_doctor.py
python3 tools/validate_project.py
python3 -m unittest tools.test_journal_manager -v
python3 -m unittest tools.test_journal_integrity -v
python3 -m unittest tools.test_weekly_review -v
python3 -m unittest tools.test_phase_review -v
python3 -m unittest tools.test_journal_insights -v
python3 -m unittest tools.test_phase_actions -v
python3 tools/life_assistant_status.py --write STATUS.md
```

`restore-test` 如果已存在，换一个新名称；不要为了重试而让恢复工具覆盖旧目录。

### macOS 手工备选

只在 `tools/verify_backup.py` 本身也不可用时，可在 macOS 上用系统命令先做基础校验和解压。这个备选不如上述 Python 工具完整，仍要在恢复后运行 doctor 和项目校验：

```bash
cd backups
checksum="生活助手-完整备份-YYYY-MM-DD-rN.zip.sha256"
shasum -a 256 -c "$checksum"
archive=${checksum%.sha256}
unzip -t "$archive"
cd ..
restore_dir="restore-test"
if [ -e "$restore_dir" ]; then
  echo "恢复目录已存在，请换一个新名称" >&2
  exit 1
fi
mkdir "$restore_dir"
unzip "backups/$archive" -d "$restore_dir"
cd "$restore_dir/codex-生活助手"
manifest="../../backups/${archive%.zip}.files.sha256"
shasum -a 256 -c "$manifest"
python3 tools/portability_doctor.py
python3 tools/validate_project.py
```

状态检查会先校验 `automations/registry.json` 的结构、路径安全和规范提示词 SHA-256，再从 `CODEX_HOME/automations/`（未设置时为 `~/.codex/automations/`）只读核对契约指定名称的生活回访是否唯一、已启用，时间与截止日是否一致，以及运行时提示词是否与规范提示词完全一致（只忽略尾部换行）。缺失、重复或运行时漂移会显示为 `ATTENTION`；契约或提示词完整性错误会显示为 `FAIL`。报告不输出提示词、自动化 ID 或任务 ID。它不能证明某次提醒已经实际送达，也不联网核对站点实时访问权限；这两项仍需在相应应用中查看。

## 可选：重新运行系统官方 Skill 校验器

项目内验证器不需要第三方包。若新环境安装了 Codex 且仍提供 `skill-creator`，可另外创建临时虚拟环境，安装 `tools/requirements-validator.txt`，再用该环境运行系统提供的 `quick_validate.py`。

不要依赖旧电脑的缓存路径；在新环境中先让 Codex定位当前 `skill-creator` 的真实位置。

## 更新备份

正式备份、恢复或迁移由用户明确发起，或在已经确认的较长周期维护节点批量执行；普通日记新增和一般元数据变化不逐次生成备份。进入正式流程后，先运行 `python3 tools/validate_project.py`，再运行 `python3 tools/create_backup.py` 创建新的带日期 ZIP，紧接着用 `python3 tools/verify_backup.py --archive "backups/<精确 ZIP 文件名>"` 独立校验，最后运行 `python3 tools/life_assistant_status.py --write STATUS.md`。脚本默认拒绝覆盖同名快照；同一天需要保留新版时使用例如 `--revision r2`，优先保留旧快照而不是 `--force` 覆盖。`STATUS.md` 的变化本身不再次触发备份。
