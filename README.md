# Codex 生活助手

这是一个以“提升生活质量、减少认知负担、尊重用户自主权”为目标的个人生活助手工作区。

项目设计为可随整个目录迁移，不依赖创建它的电脑。换电脑或恢复环境时先阅读 [迁移与恢复说明](PORTABILITY.md) 和 [项目背景摘要](PROJECT_CONTEXT.md)。

第一阶段已完成公开网络调研，并产出一份可执行的核心 Skill 草案和 Prompt 包。当前版本不连接银行、医疗、发信或购买等高风险写权限。

## 核心结论

一个真正有用的生活助手应先具备八个闭环能力：最小化建档、可纠正记忆、动态目标维护、现实日计划、低打扰简报、每周复盘、对话式生活日记、行动风险审批。健康、饮食、财务、关系、家庭和出行能力应在这个底座上逐步增加。

第三方 Skill 应视为软件供应链依赖。当前方案只借鉴公开实现的模式，不直接安装未经审计的社区 Skill。

## 产物

- [工作区运行规则](AGENTS.md)
- [项目背景与交接摘要](PROJECT_CONTEXT.md)
- [迁移与恢复说明](PORTABILITY.md)
- [可审阅的用户资料](USER.md)
- [动态生活目标台账](GOALS.md)
- [长期决定与进度记忆](MEMORY.md)
- 助手运行状态快照：`STATUS.md`（可重建）
- [两周睡眠与生活恢复计划](plans/2026-07-31-两周睡眠与生活恢复计划.md)
- [健身、生活体验与职业探索扩展路线](plans/2026-08-01-生活扩展路线图.md)
- [睡眠与状态记录模板](plans/睡眠与状态记录模板.md)
- [对话式生活日记说明](journal/README.md)
- [生活日记隐私与删除边界](journal/PRIVACY.md)
- [生活日记索引](journal/INDEX.md)
- [可视化生活计划表](outputs/019fb832-be4f-74f1-add5-58cb6fb6fc09/生活计划表.xlsx)
- [工作簿同步状态收据](outputs/019fb832-be4f-74f1-add5-58cb6fb6fc09/生活计划表.sync-state.json)
- [移动端生活看板（此前私密发布版本；不等于当前本地源码）](https://life-compass-cn-2026.ycy19821817850.chatgpt.site)
- [移动端生活看板源码](web/life-dashboard/)
- [对话式定时回访规格](automations/生活状态回访.md)
- [每日状态、自然周与阶段复盘台账说明](records/README.md)
- [零依赖项目验证器](tools/validate_project.py)
- [零依赖生活助手状态检查器](tools/life_assistant_status.py)
- [零依赖备份脚本](tools/create_backup.py)
- [零依赖备份校验与安全恢复工具](tools/verify_backup.py)
- [生活计划表更新脚本](tools/update_life_plan_growth.mjs)
- [生活计划表渲染检查脚本](tools/render_life_plan.mjs)
- [日记归档工具](tools/journal_manager.py)
- [日记索引—原文双向完整性工具](tools/journal_integrity.py)
- [日记整理节奏选择工具](tools/journal_review_policy.py)
- [日记候选认识确认工具](tools/journal_insights.py)
- [同日幂等回访记录与精确删除工具](tools/daily_checkin.py)
- [自然周幂等复盘记录与精确删除工具](tools/weekly_review.py)
- [阶段复盘幂等记录与精确删除工具](tools/phase_review.py)
- [阶段复盘动作恢复台账](tools/phase_actions.py)
- [日记索引、每日状态、周复盘与工作簿同步工具](tools/update_life_plan_journal.mjs)
- [全网调研与推荐方案](research/2026-07-31-生活助手Skill与Prompt全网调研.md)
- [公开来源评分表](research/2026-07-31-公开来源评分表.md)
- [初始目标完成审计](research/2026-07-31-初始目标完成审计.md)
- [对话式生活日记完成审计](research/2026-08-01-对话式日记完成审计.md)
- [换机恢复演练](research/2026-08-01-换机恢复演练.md)
- [核心 Skill](skills/improve-daily-life/SKILL.md)
- [生活助手主 Prompt](skills/improve-daily-life/references/core-system-prompt.md)
- [14 个可直接使用的工作流 Prompt](skills/improve-daily-life/references/workflow-prompts.md)
- [分阶段 Skill 目录](skills/improve-daily-life/references/skill-catalog.md)
- [记忆与行动安全规则](skills/improve-daily-life/references/memory-and-safety.md)
- [低压力行为支持规则](skills/improve-daily-life/references/behavior-support.md)
- [对话式日记工作流](skills/improve-daily-life/references/journaling.md)
- [触发、失败与越权评估集](skills/improve-daily-life/references/evals.md)
- [用户资料模板](skills/improve-daily-life/assets/user-profile-template.md)
- [七天试运行模板](skills/improve-daily-life/assets/seven-day-trial-template.md)

## 下一阶段

先完成当前两周睡眠与生活恢复实验。2026-08-14 只在健身、职业或都先不聊中做一次选择；同一阶段至多启用一条分支。未选中的分支不排期、不提醒，也不会因日期到达自动开始；2026-08-31 只复盘已启用分支或由用户重新选择。

生活日记已经具备“对话触发 → iCloud 项目归档 → 可审计更正/撤回/恢复 → 工作簿索引 → 已结束周期回顾 → 候选长期认识确认”的可迁移链路。未知或约略发生时间不会被伪造成精确时刻；内容更正会完整重建轻量索引；“不要记刚才那条”可按真实记录时间撤回最近一次隐式保存；同月多条记录的撤回与恢复互不串扰。机器索引采用严格白名单和索引—原文双向完整性检查，列表只输出安全投影，含原文输入走非 PTY stdin。回顾计划绑定完整来源 ID 与 `source_set_etag`，来源变化时不会写入半份回顾。首轮回访会在周一回补已经结束且有素材的自然周，长期采用每周、每月、仅按需还是暂停仍由用户在 2026-08-14 选择；未选择就不续期。

候选确认工具每次最多展示 3 项，可恢复状态链是 `pending → awaiting_proposal → proposed → applied`；拒绝进入 `rejected`，回顾来源漂移则进入 `superseded`。accept 只进入 `awaiting_proposal`；`propose` 保存目标文件、精确拟写文字及哈希，`apply-plan` 才只读返回这份提案供再次确认。助手完成获批的长期文件写入后，`mark-applied` 只有在目标字节已包含该精确提案时才标记 `applied`。全链使用 revision/etag 防陈旧；工具本身不写 `USER.md`、`MEMORY.md` 或 `GOALS.md`，`list/status` 也不输出候选或提案内容。`journal/insight-decisions.jsonl` 可因尚未完成的精确提案而较敏感。永久删除日记不自动清除这份审计台账、旧 ZIP、聊天或 iCloud/设备历史。真实日记为空时不生成回顾，也不要求补写。

每日状态同样支持当前项目单日删除：先只读预览并冻结 revision/内容哈希，取得当次精确确认后删除源记录，再由工作簿全量派生同步清空 D:P 旧值。工作簿不再作为每日状态的手填真相来源；旧 ZIP、聊天和 iCloud/设备历史仍需另行处理。

周日轻复盘已有独立的 `records/weekly-reviews.jsonl` 与零外部依赖工具：只把用户对周一至周日完整自然周的明确回答经 stdin 保存为短摘要，同周补充幂等合并，缺项保持未知；它不复制日记回顾、每日状态，也不凭 `goal_intent` 自动改变 `GOALS.md`。生活计划表“每周复盘”I:N 从该台账完整派生，无源记录时保持空白。整周删除同样先只读预览、冻结 revision/内容哈希并取得精确确认，之后同步清空派生值；聊天、日记、目标、旧 ZIP 和 iCloud/设备历史不在该命令范围内。截至 2026-08-01 尚无真实周复盘记录，空白不是失败，也不要求补写。

2026-08-14 的阶段复盘另有 `records/phase-reviews.jsonl` 与严格幂等工具：仅保存用户明确的去敏短摘要、枚举和布尔值，延迟回复仍归原复盘日。`tools/phase_actions.py` 只从明确且非中性的回答派生可恢复动作；一旦回答 `next_track`，它就是互斥门：选健身时不产生职业时点动作，选职业时不产生健身对话动作，选未定或都不选时两者都不产生。若 `next_track` 完全未回答，另行明确的依赖项会各自独立产生动作；要锁定互斥分支应先保存 `next_track`。来源 etag 变化会使旧动作 `superseded`，新动作再经 `pending → applied/failed/dismissed` 记录执行结果。`plan/apply-plan/mark` 不自动修改目标、整理策略、提醒或网页；这些变更仍分别按精确变更或日程细节的审批边界应用。`records/phase-actions.jsonl` 可包含期望值与执行状态，也是可选敏感台账。截至 2026-08-01 两份阶段台账均无真实记录。

工作簿同步会生成一份权限为 0600 的 `生活计划表.sync-state.json`，精确绑定最终 XLSX 字节及日记/每日/每周三个源的存在性和 SHA-256。状态检查不再使用文件修改时间猜测是否同步。

`STATUS.md` 由助手在实质变化后重建，只汇总结构、日期、数量和完整性，不复制日记原文。它是便于发现遗漏的派生快照；目标、日记、提醒规格和长期记忆仍分别以各自源文件为准。

移动端看板的滚动七日路线、阶段确认门和日记控制说明已经在本地源码通过构建与测试：日期只能推进已确认阶段，8 月 15 日若没有新决定就显示等待复盘，不自动启动 phase 02。新版尚未再次发布；再次发布仍需当次明确同意。最新恢复演练与快照证据见上方恢复演练记录。
