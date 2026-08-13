# Career Planner 1.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可直接浏览的 iCloud 职业知识库、专业职业指导规则和五次首周提醒，不建设 App 或前后端。

**Architecture:** 私人内容只写入根工作区的 `career/` 文件夹；Git 分支只保存通用 Skill、空白模板、测试和去敏知识库。提醒唤醒当前生活助手对话，按日程读取安全元数据并发起一次专业咨询。

**Tech Stack:** Markdown、YAML、Codex Skill、Codex heartbeat automation、Python unittest（仅结构与隐私合成测试）。

## Global Constraints

- 不读取或导入尚未逐份授权的真实工作材料。
- 不建设 App、前端、后端、API、数据库或云端同步。
- `career/` 仅留在 iCloud 且不得进入 Git。
- 首周仅 2026-08-17 至 2026-08-21 每日 14:30 触达一次；周末无提醒。
- 提醒必须给完整输入、输出、时长、完成标准与停止条件，但不得复述敏感内容。
- 单个连续工作块不超过 4 小时；21:30 后停止职业任务。

---

### Task 1: 私人职业知识库骨架

**Files:**
- Create: `career/README.md`
- Create: `career/01-原始资料/来源清单.md`
- Create: `career/02-职业证据/能力与成果索引.md`
- Create: `career/02-职业证据/待确认事实.md`
- Create: `career/03-职业分析/职业画像.md`
- Create: `career/03-职业分析/路径分析.md`
- Create: `career/03-职业分析/假设与验证.md`
- Create: `career/04-咨询记录/README.md`
- Create: `career/05-离职交接/离职交接主文档.md`
- Create: `career/06-简历与求职/主简历.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 已确认的目录与原文优先规则。
- Produces: 用户可直接浏览的唯一私人职业知识库。

- [x] **Step 1:** 在结构测试中声明 `career/` 必须被 Git 排除，并运行测试确认失败。
- [x] **Step 2:** 将 `career/` 加入 Git 排除规则，同时在根仓库本地 exclude 中立即生效。
- [x] **Step 3:** 用空白 Markdown 文件建立目录，内容只含填写说明、字段和状态，不写虚构经历。
- [x] **Step 4:** 验证所有入口可读、`git check-ignore career/README.md` 成功且根工作区不显示 `career/`。

### Task 2: 职业规划师 Skill

**Files:**
- Create: `skills/plan-career/SKILL.md`
- Create: `skills/plan-career/agents/openai.yaml`
- Create: `skills/plan-career/references/consultation.md`
- Create: `skills/plan-career/references/evidence-management.md`
- Create: `skills/plan-career/references/career-analysis.md`
- Create: `skills/plan-career/references/resume-and-handover.md`
- Create: `skills/plan-career/references/evals.md`
- Create: `tools/test_career_planner.py`

**Interfaces:**
- Consumes: `career/` 的固定分层、生活助手目标约束和用户逐份授权。
- Produces: `$plan-career` 的触发、咨询、归档和安全行为契约。

- [x] **Step 1:** 先写触发、反触发、原文保护和一主两辅路径的失败测试并确认 RED。
- [x] **Step 2:** 使用官方 `init_skill.py` 初始化 `plan-career`。
- [x] **Step 3:** 写最小 SKILL 和五份单层 reference，使测试转绿。
- [x] **Step 4:** 运行 `quick_validate.py`、聚焦单元测试和项目治理检查。

### Task 3: 生活目标与首周提醒

**Files:**
- Modify private: `GOALS.md`
- Create private: `plans/2026-08-17-职业整理首周计划.md`
- Create private: `automations/职业规划首周提醒.md`
- Create private: `automations/职业规划首周提醒.prompt.txt`
- Modify private: `automations/registry.json`

**Interfaces:**
- Consumes: 首周五日安排、14:30 上海时间、完整提醒卡片契约。
- Produces: 生活目标中的唯一主项、可迁移提醒规格和五个到期 heartbeat。

- [x] **Step 1:** 更新目标和计划，明确睡眠护栏、周末自由与可降级动作。
- [x] **Step 2:** 写提醒规范 Prompt 和注册表契约，不含私人材料正文。
- [x] **Step 3:** 创建一个包含五次限定日期运行的 heartbeat，并读回时间与 Prompt。
- [x] **Step 4:** 验证工作日覆盖、周末为零、到期后无继续触发。

### Task 4: 验收与项目记录

**Files:**
- Modify: `docs/knowledge-base/README.md`
- Modify: `docs/knowledge-base/职业规划师-CareerPlanner-1.0.0/README.md`
- Modify: `docs/knowledge-base/职业规划师-CareerPlanner-1.0.0/工程评审与验收-职业规划师-CareerPlanner-1.0.0.md`
- Modify: `docs/knowledge-base/职业规划师-CareerPlanner-1.0.0/项目管理-职业规划师-CareerPlanner-1.0.0.md`

**Interfaces:**
- Consumes: 前三项的测试、目录检查和自动化读回结果。
- Produces: 去敏验收证据和准确项目状态。

- [x] **Step 1:** 运行聚焦测试、全量 tools 测试、项目校验、隐私与差异检查。
- [x] **Step 2:** 只把真实通过项写入验收和 PMO；真实材料导入保持未授权。
- [x] **Step 3:** 提交通用文件；私人 `career/`、目标、计划和提醒规格不进入 Git。
- [x] **Step 4:** 打开 `career/` 给用户检查，并报告提醒状态与未完成项。
