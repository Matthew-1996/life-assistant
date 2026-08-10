# Git 协作约定

本仓库用于多个 Agent 共同维护生活助手的通用架构、代码和方案设计。GitHub
远端必须保持私有；iCloud 项目仍是个人生活数据和个性化配置的唯一真相源。
GitHub 克隆不能单独恢复用户的生活助手实例。

## 产品开发门禁

Git 只负责版本协作，不能替代产品流程。任何产品需求、代码、规则、Prompt、设计、测试、部署或知识库变更，开始分支前必须：

1. 完整读取 `docs/governance/agent-user-project-development-standard.md`；
2. 在 `docs/knowledge-base/README.md` 找到对应版本的 PRD 与 PMO 状态，或明确记录为什么符合“快速维护通道”；
3. 确认当前阶段的必要输入已经存在，并识别仍需用户确认的门禁；
4. 若 PRD、设计、重大技术差异、验收或上线仍待用户确认，只能继续只读调研、可逆草稿和 Draft PR，不得合并、发布或宣称进入下一阶段。

缺失的 PMO、评审、测试或进度文档由 Agent 主动生成并标明事实来源。产品定位、功能范围、优先级、重大取舍、验收与上线可以由 Agent 起草，但必须由用户明确确认；沉默、旧授权、代码完成或 CI 通过都不算确认。

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

首次克隆或新建 worktree 后运行：

```bash
tools/setup_git_collaboration.sh
```

它把仓库级 `core.hooksPath` 指向版本化的 `.githooks/`：本地会阻止直接在
`main` 提交/推送、重新跟踪 iCloud 私有路径或提交高置信凭据。GitHub Actions
会再次运行相同的 `tools/check_git_privacy.sh`。当前账号套餐不支持私有仓库服务端
分支保护，因此这些防线不能替代 Pull Request 纪律。

提交前运行：

```bash
git status --short
git diff --check
python3 tools/validate_project.py
python3 -m unittest discover -s tools -p 'test_*.py'
```

网页变更还需在具备 Node.js `>=22.13.0` 的环境运行；`node_modules` 不在 iCloud 内，先在外部工作区同步源码再装依赖：

```bash
tools/dev_dashboard.sh init ~/Projects/life-dashboard   # 首次或换机后
cd ~/Projects/life-dashboard
npm ci
npm test
```

日常在外部工作区编辑后用 `tools/dev_dashboard.sh push` 回写 iCloud 真相源，脚手架变更再按本文件流程经 PR 提交。

## 多 Agent 工作流

1. 先完成“产品开发门禁”的文档与阶段判断，再创建分支。
2. `main` 只通过 Pull Request 更新；每个 Agent 使用独立的 `agent/<短任务名>` 分支。
3. 并行任务使用独立 `git worktree`；一个 Agent 对应一个分支和一个工作目录。
4. 开始前同步 `origin/main`，提交前再次变基到最新 `origin/main`。
5. 一个提交只处理一个可审阅目标，不混入无关格式化、生成文件或个人数据。
6. 默认先开 Draft Pull Request；PR 必须写明关联产品版本或快速维护理由、当前阶段、用户确认状态与知识库更新。
7. 未通过对应用户门禁的 PR 保持 Draft，不得因 CI 绿灯自动合并；禁止强制推送共享分支和删除他人分支。
8. 冲突必须基于当前 iCloud 真相源人工判断，不得用 checkout/reset 丢弃其他 Agent 的修改。

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

## 历史扫描防线

隐私检查分索引和历史两层，二者都要过；只过索引不能证明历史干净。

- 索引扫描（提交前，pre-commit 自动执行）：`tools/check_git_privacy.sh`
- 历史扫描（推送/合入前）：`tools/check_git_privacy.sh --history <range>`，扫描该
  提交范围内新增或修改过的私有路径与 blob 凭据。例如推分支前：

  ```bash
  tools/check_git_privacy.sh --history origin/main..HEAD
  ```

- CI 的 `privacy` job 用 `fetch-depth: 0` 检出全历史，对 PR 自动执行
  `--history <base>..HEAD`；Python、Node job 都 `needs: privacy`。
- 两种模式共用脚本内 `is_private_path` 判定，新增禁止路径只改这一个函数，
  同时更新 `.gitignore` 保持口径一致。

## 历史清理（应急，一次性仓库维护）

仅当个人数据或凭据已进入历史提交时执行；这是不可逆且改写远端的操作，需用户
当次明确授权。它无法用 PR 完成（PR 改不了既有提交），只能强推 `main`。

1. 先全量备份，记录回滚锚点：

   ```bash
   ts=$(date +%Y%m%d-%H%M%S)
   git bundle create "backups/git-history/pre-history-rewrite-${ts}.bundle" --all
   git bundle verify "backups/git-history/pre-history-rewrite-${ts}.bundle"
   git rev-parse HEAD > "backups/git-history/pre-history-rewrite-${ts}.mainsha.txt"
   ```

2. 列出历史中出现过的个人路径，逐一确认（保留 `*.example.*` 合成示例），
   写入一个待剥离清单，用 `git filter-branch --index-filter` 从全历史移除：

   ```bash
   FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force --prune-empty \
     --index-filter 'while IFS= read -r p; do
        git rm -q --cached --ignore-unmatch "$p"; done < /tmp/strip_paths.txt' -- main
   ```

3. 清理残留引用与对象：删除 `refs/original/`、`refs/codex/` 等锚定旧历史的
   ref，`git reflog expire --expire=now --all` 后 `git gc --prune=now`。

4. 强推前手动过索引+历史隐私检查，再覆盖远端（用 `--force-with-lease` 防并发）：

   ```bash
   tools/check_git_privacy.sh
   root=$(git rev-list --max-parents=0 main | tail -1)
   tools/check_git_privacy.sh --history "${root}..HEAD"
   git push --force-with-lease --no-verify origin main
   ```

5. 黑盒验证：从远端全新 `git clone`，确认个人文件在全历史提交数为 0，
   通用文件数与测试符合预期。

边界：`--no-verify` 仅用于此类一次性历史维护，且必须先手动跑完隐私检查再推，
并如实报告。GitHub 服务端可能短期保留旧对象，彻底清除需联系 GitHub Support 或
删库重建。备份 bundle 含个人历史，只留 iCloud、由 `.gitignore` 排除、不进新仓库。
日常协作不复用此流程，仍走 `agent/*` 分支 + PR。
