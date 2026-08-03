# Git 协作约定

本仓库用于多个 Agent 共同维护生活助手的代码、规则和必要上下文。GitHub
远端必须保持私有；iCloud 项目仍是个人生活数据的真相源。

## 数据边界

允许提交：

- 工具、测试、Skill、Prompt、自动化规格和网页源码；
- `AGENTS.md`、`USER.md`、`MEMORY.md`、`GOALS.md` 与计划文档；
- 不含真实个人记录的模板、示例和说明。

禁止提交：

- 日记原文、日记索引与日记回顾；
- 每日、每周或阶段状态台账及 Apple Health 文件；
- ZIP 备份、XLSX 导出、同步收据、服务标识、凭据和令牌；
- `node_modules`、构建产物、缓存和机器本地状态。

提交前运行：

```bash
git status --short
git diff --check
python3 tools/validate_project.py
python3 -m unittest discover -s tools -p 'test_*.py'
```

网页变更还需在具备 Node.js `>=22.13.0` 的环境运行：

```bash
cd web/life-dashboard
npm ci
npm test
```

## 多 Agent 工作流

1. 每个 Agent 使用独立分支，命名为 `agent/<任务名>`。
2. 并行任务使用独立 `git worktree`，不要让多个 Agent 同时改同一工作目录。
3. 开始前同步 `main`，提交前再次变基或合并最新 `main`。
4. 一个提交只处理一个可审阅目标，不混入无关格式化或生成文件。
5. 通过 Pull Request 合并；不要强制推送共享分支。
6. 冲突必须基于当前真相源人工判断，不得丢弃其他 Agent 的修改。

示例：

```bash
git fetch origin
git worktree add ../life-assistant-task -b agent/task-name origin/main
```

任务合并后再移除对应 worktree 和分支。
