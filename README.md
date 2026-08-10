# Life Assistant Agent Toolkit

这是一个用于构建生活助手 Agent 的私有代码与方案设计仓库，目标是减少用户认知负担，
并在健康、时间、关系、生活环境、财务安全与乐趣之间形成现实平衡。

仓库主要包含：

- 核心 Skill、Prompt、评估集和安全边界；
- 日记、每日状态、周复盘与阶段复盘的原子工具；
- 隐私、删除、迁移、备份和派生展示的通用机制；
- 自动化、测试与多 Agent 协作规范。

当前只有 `apps/life-console/` 是活跃产品代码。iCloud 私人台账是唯一真相源，Life Console 是主要入口；Google 表格和 XLSX 都只按需生成且不得反向写回。原移动网页已归档，仓库不再维护其源码或执行新部署，生命周期见 [`docs/operations/product-surfaces.json`](docs/operations/product-surfaces.json)。

## 隐私边界

GitHub 只保存通用方案和代码，不保存某位用户的个人生活助手实例。真实用户资料、记忆、
目标、日记、状态台账、Apple Health、个性化计划、当前自动化、外部服务绑定、导出和备份
只保存在用户自己的 iCloud 工作区，并由根目录 `.gitignore` 排除。

因此，单独克隆本仓库不能恢复个人数据或个性化展示。

## 多 Agent 协作

所有任务使用 `agent/<短任务名>` 分支和独立 worktree，通过 Pull Request 合并到 `main`。
开始修改前请阅读 [Git 协作约定](GIT_WORKFLOW.md) 和 [工作区规则](AGENTS.md)，并运行：

```bash
tools/setup_git_collaboration.sh
```

## 主要目录

- `skills/improve-daily-life/`：生活助手核心 Skill 与引用资料；
- `tools/`：可迁移的数据工具、校验器与测试；
- `apps/life-console/`：唯一活跃应用，包含 React UI、localhost Life Hub、OpenAPI 和合成测试；
- `docs/knowledge-base/`：按产品版本维护 PRD、评审、设计、技术、工程验收和 PMO；
- `docs/design/`：一套顶层设计系统、一套当前交互稿和长期 UI/UE 规范；
- `docs/operations/`：展示层等跨模块生命周期契约；
- `journal/`、`records/`：只提交通用说明和示例，真实数据不进入 Git；
- `research/`：不可变调研与验收证据，不承担当前方案说明；
- `plans/`：只提交无真实个人信息的通用模板。
