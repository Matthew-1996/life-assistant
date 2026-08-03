# Git 协作约定

本仓库用于多个 Agent 共同维护生活助手的通用架构、代码和方案设计。GitHub
远端必须保持私有；iCloud 项目仍是个人生活数据和个性化配置的唯一真相源。
GitHub 克隆不能单独恢复用户的生活助手实例。

## 数据边界

允许提交：

- 不含真实个人数据的工具、测试、Skill、Prompt 和通用方案设计；
- `AGENTS.md`、公开研究、协作规范与通用模板；
- 不含真实个人记录的模板、示例和说明。

禁止提交：

- `USER.md`、`MEMORY.md`、`GOALS.md`、`PROJECT_CONTEXT.md`、个性化计划与迁移背景；
- 日记原文、日记索引与日记回顾；
- 每日、每周或阶段状态台账及 Apple Health 文件；
- 当前自动化、硬编码个人安排的看板/工作簿实现、ZIP 备份、XLSX 导出、同步收据、服务标识、凭据和令牌；
- `node_modules`、构建产物、缓存和机器本地状态。

如果通用代码与个人内容混在同一文件，先留在 iCloud；拆出无真实数据的通用配置层后再提交。
仓库私有不能替代数据最小化。

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

1. `main` 只通过 Pull Request 更新；每个 Agent 使用独立的 `agent/<短任务名>` 分支。
2. 并行任务使用独立 `git worktree`；一个 Agent 对应一个分支和一个工作目录。
3. 开始前同步 `origin/main`，提交前再次变基到最新 `origin/main`。
4. 一个提交只处理一个可审阅目标，不混入无关格式化、生成文件或个人数据。
5. 默认先开 Draft Pull Request；禁止强制推送共享分支和删除他人分支。
6. 冲突必须基于当前 iCloud 真相源人工判断，不得用 checkout/reset 丢弃其他 Agent 的修改。

示例：

```bash
git fetch origin
git worktree add .worktrees/task-name -b agent/task-name origin/main
cd .worktrees/task-name
git push -u origin agent/task-name
gh pr create --draft --base main --head agent/task-name
```

任务合并后，由确认没有未提交修改的人移除对应 worktree 和分支。

## 冲突高风险区

- `AGENTS.md`、核心 Skill、公共 Prompt 和验证器：同一时间只安排一个 Agent 主改。
- iCloud 私有文件：Git 不提供并发保护，继续使用项目内原子工具与 revision/etag，禁止手工批量覆盖。
- 发现陌生修改时先停止暂存并确认归属；不要默认执行 `git add -A`。
