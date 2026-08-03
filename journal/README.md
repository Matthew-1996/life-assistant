# 对话式生活日记

这里是生活助手的私密日记库。日记由对话触发和整理，用户不需要在文档里重复填表。

## 会保存什么

- `entries/YYYY/YYYY-MM.md`：按月保存用户原话与助手整理。
- `index.jsonl`：供助手检索、周回顾和月回顾的轻量元数据，不重复保存原文；字段采用严格白名单，出现 `raw` 或其他未知字段时停止读取，不把异常内容透传到列表输出。
- `INDEX.md`：自动生成的可读索引，新记录在前。
- `reviews/YYYY/YYYY-Www.md`：每周轻回顾；同一周重复生成时刷新原文件。
- `reviews/YYYY/YYYY-MM.md`：每月生活回顾；同一月重复生成时刷新原文件。
- `review-policy.json`：日记整理节奏的可迁移真相。2026-08-02 至 2026-08-14 是已确认的试运行周整理窗口；长期节奏当前保持 `pending_user_choice`，不会因日期到达而自动续期。
- `insight-decisions.jsonl`：可选的“候选长期认识/规划启示”确认与应用台账；只在已有受管回顾产生候选时创建。它保存二次去敏摘要、决策状态，以及在已接受后拟写入 `USER.md` / `MEMORY.md` / `GOALS.md` 的精确文字、目标、哈希和应用状态。它不保存日记原文，也绝不自动改写长期文件。

## 对话触发

用“日记：”、“日记记录：”、“生活记录：”、“记录一下：”等开头，或明确说“帮我记下来”、“写进日记”，助手就会整理并归档。没有内容时不会创建空日记。

## 隐私边界

- 默认且当前只支持 `local-only`：归档工具只写当前 iCloud 项目，不主动把原文发布到网页或连接器；原文不进入工作簿，但轻量索引会同步到同一项目的生活计划表。它不表示离线或只有一份副本。完整数据流、备份和删除边界见 [生活日记隐私与删除边界](PRIVACY.md)。
- 日记原文不会自动发布到网页，也不会因为曾经授权发布其他生活数据而一并公开。
- 密码、令牌、完整证件号、完整银行卡号和第三方秘密不写入日记。
- 从多篇日记推断出的长期偏好或结论，在进入 `USER.md` 或 `MEMORY.md` 前会先请用户确认。

## 工具用法

助手通常会代为调用，无需用户手动执行。

```bash
python3 tools/journal_manager.py add --input -
python3 tools/journal_manager.py amend --input -
python3 tools/journal_manager.py list --start 2026-08-01 --end 2026-08-07
python3 tools/journal_manager.py list --tag 恢复 --limit 10
python3 tools/journal_manager.py withdraw --id 20260801-2235-xxxxxxxxxxxx
python3 tools/journal_manager.py withdraw-latest-implicit
python3 tools/journal_manager.py restore --id 20260801-2235-xxxxxxxxxxxx
python3 tools/journal_manager.py purge-plan --id 20260801-2235-xxxxxxxxxxxx
python3 tools/journal_manager.py purge --id 20260801-2235-xxxxxxxxxxxx --confirm 20260801-2235-xxxxxxxxxxxx --acknowledge-historical-copies
python3 tools/journal_manager.py review-plan --type weekly --as-of 2026-08-10
python3 tools/journal_manager.py review --input -
python3 tools/journal_integrity.py --json
python3 tools/journal_review_policy.py show
python3 tools/journal_insights.py plan --input -
python3 tools/journal_insights.py decide --input -
python3 tools/journal_insights.py propose --input -
python3 tools/journal_insights.py apply-plan --input -
python3 tools/journal_insights.py mark-applied --input -
python3 tools/journal_insights.py status --input -
```

`add`、`amend` 和 `review` 优先通过非 PTY、`shell=False` 子进程从 stdin 读取，避免把含原文的 JSON 留在命令参数、终端历史或 PTY 回显日志；如果工具环境只能使用 PTY，输入敏感正文前必须先关闭回显。必须用临时文件时放在系统临时目录，并在完成后清理。

`add` 输入的必填字段是 `date`（`YYYY-MM-DD`）、`title` 和 `raw`。知道具体时刻时传 `time`（`HH:MM`），默认 `time_precision=exact`；只知道大约时刻时传 `time_precision=approximate`；不知道具体时刻时省略 `time` 或传 `null`，并使用 `time_precision=unknown`。工具另存真实 `recorded_at`，不会拿它冒充事件时间。`source` 可为 `explicit` 或 `implicit`，`privacy` 默认为 `local-only`。可选轻量字段包括 `summary`、`facts`、`feelings`、`people`、`places`、`themes`、`tags`、`planning_clues` 和 `inferences`；省略新字段的旧输入仍然可用。

`amend` 输入至少包含 `id`、非空 `note` 和 `privacy: "local-only"`，不能覆盖 `raw`。只更正日期/时间时，可以只更新 `date`、`time`、`time_precision`；任何内容更正都必须同时提交 `title`、`summary` 以及全部轻量数组字段，即使其中一些是空数组。工具会拒绝 note-only 或部分索引更正，避免旧摘要、人物或事实继续进入工作簿和回顾。有效时间更新后仍保留首次值为 `original_date`、`original_time`、`original_time_precision`，原文及其初始月度文件位置不移动。工具追加更正痕迹，机器索引只保存更正 ID 和时间，不保存 `note`。旧回顾会被标记失效，刷新前不得用于规划。

普通 `add` 成功后立即短回执，不逐篇运行工作簿、完整校验、状态或备份流程。`tools/update_life_plan_journal.mjs` 会在周/月回顾、用户要求查看或同步工作簿，以及备份、迁移、恢复或交接前，从 `index.jsonl` 批量重建生活计划表的“日记索引”；同步只读取轻量字段，从不读取 `raw`。更正、撤回、恢复和删除仍按对应完整流程处理。

`review` 输入示例：

```json
{
  "type": "weekly",
  "start": "2026-07-27",
  "end": "2026-08-02",
  "title": "8 月第一周生活回顾",
  "entry_ids": ["20260801-2235-xxxxxxxxxxxx"],
  "source_set_etag": "<review-plan 返回的 64 位来源集合指纹>",
  "events": ["晚饭后散步"],
  "replenishing": ["户外的风"],
  "draining": ["交接任务叠加"],
  "recurring": ["轻活动后更放松"],
  "open_threads": ["继续观察入睡时间"],
  "planning_implications": ["下周只保留一个轻量实验"],
  "candidate_memories": ["可能喜欢低压的户外活动"],
  "privacy": "local-only"
}
```

- `type` 可为 `weekly` 或 `monthly`。周回顾必须完整覆盖同一 ISO 自然周的周一至周日；月回顾必须完整覆盖自然月的首日至末日。
- `entry_ids` 中的每篇日记必须存在、未撤回，且日期位于回顾范围内。
- `source_set_etag` 必须原样使用同一次 `review-plan` 为该周期返回的值，不能手工计算或沿用旧值。`review` 会在文件锁内重新读取该周期全部 active 来源，并同时精确核对 ID 集合、数量和指纹；若计划后出现补记、撤回或更正，本次不写入，重新运行计划后再生成。
- 同一周或月的回顾可安全重复运行：内容未变时不重复写入，内容变化时刷新原文件；`index.jsonl` 的 `weekly_reviews` / `monthly_reviews` 会同步更新。
- `candidate_memories` 在回顾中始终标为“待用户确认”，不会自动进入长期记忆或目标台账。

`review-plan` 是只读的周期补漏计划：周计划只列出检查日之前已经结束的周一至周日，月计划只列出已经结束的自然月。它比较当前全部 active 日记与受管回顾来源；周日晚间新增或后来补记到旧周期的条目会使该周期再次变为 due。输出只含周期、完整条目 ID 集合、`source_set_etag`、数量、受管文件和原因，不含原文或摘要。定时周整理应在下一个周一执行，定时月整理应在次月 1 日执行；是否实际提醒由 `review-policy.json` 决定，长期采用每周、每月、仅按需还是暂停，等用户明确选择后再改变。

`journal_integrity.py` 是只读的双向完整性检查：索引中的每个稳定 ID 必须在约定月度原文中恰好出现一次，每个原文标识也必须被索引覆盖。它只输出计数和结构状态，不输出 ID、标题、摘要或原文；状态检查、项目验证和备份都会使用同一约束。缺索引但残留原文、缺原文、路径错配、重复或格式异常都 fail closed。

`journal_review_policy.py` 用于保存用户明确选择的长期整理节奏。先 `show` 读取当前值；只有用户明确选择后才用 `set`，并携带刚读取的 `--expect-current`、决定日期和晚于试运行窗口的生效日期。工具支持 `weekly`、`monthly`、`on_demand` 与 `paused`，不把漏答变成默认选择；陈旧状态会拒绝覆盖。它只更新可迁移策略，不会自行创建或修改运行时提醒。

`journal_insights.py` 把受管周/月回顾中的“待用户确认”候选认识和规划启示变成一个可审阅、可中断恢复且不重复骚扰的流程。`plan` 每次最多返回 3 个 pending 候选；已决策候选不会再反复出现，回顾内容或失效标记变化时旧候选自动变为 `superseded`。为避免把个人内容放进命令参数，所有 JSON 均通过非 PTY stdin 传入；`plan/list/status` 接收空对象 `{}`。

accept 后的状态链是 `awaiting_proposal → proposed → applied`：

1. `decide` 只记录 accept/reject；accept 进入 `awaiting_proposal`，不写长期文件。
2. 助手选择一个白名单目标文件，用 `propose` 保存精确拟写文字；提案可用最新 revision/etag 修订。
3. 必须用纯只读的 `apply-plan` 取回并向用户展示目标文件与精确文字。这是唯一允许返回提案内容的命令；不得从台账、旧对话或记忆猜回。
4. 只在用户对该精确变更再次确认后，助手才真正编辑目标文件；成功验证后再调用 `mark-applied`。`mark-applied` 只核验当前目标字节已精确包含提案并写应用状态，绝不代替编辑。

`propose/apply-plan/mark-applied` 都要使用最新 `revision` 与 `candidate_etag`，`mark-applied` 还要校验 `proposal_sha256`。reject 只记录不再询问，不删除原回顾。`list`、`status` 和状态 inspector 只输出计数与状态，不输出候选摘要、提案、目标、回顾路径/哈希或日记来源 ID。缺失或空台账是正常状态，不应为此创建空文件。

工具会在落盘前遮蔽明显的完整银行卡/证件号码、验证码、密码、完整或截断的常见私钥块、云访问密钥、JWT、分组恢复码、中英文凭据赋值和常见访问令牌；引号中含空格的凭据也按整个值遮蔽。自然语言比喻（如“我们关系的密码是坦诚沟通”）不会因为出现“密码是”就自动删去。这仍只是高置信防线，不能代替用户避免发送秘密。`list` 只返回 `status=active` 的日记。

`withdraw` 是可恢复的逻辑撤回，不是删除：条目会从可读索引、工作簿同步来源和后续回顾中隐藏，但原文与机器索引中的撤回记录仍保留。撤回状态行只在目标条目的 Markdown 块内增删；同月其他日记不会被误判、撤回或恢复。用户说“不要记刚才那条”时，`withdraw-latest-implicit` 会在同一文件锁内按 `recorded_at` 选择最近一次 active 隐式记录并撤回；它不会因为一篇补记的旧经历事件日期更早而选错。若条目已被周/月回顾使用，相关回顾会标记“来源日记已撤回，本回顾需刷新后再用于规划”，并从该共享回顾的所有来源条目中移除有效引用；`restore` 可恢复条目，但不会自动复用这些旧回顾。更正也采用相同的整份共享回顾失效规则。

永久删除前先运行只读的 `purge-plan`，查看日期、标题、受影响回顾、可识别的历史 ZIP 和当前状态；它不会修改文件，也不输出原文。`purge` 才会从当前项目永久删除：它只接受已撤回条目，要求 `--confirm` 与 ID 完全一致，并要求显式确认历史副本边界。受影响回顾必须具有匹配路径的 `journal-review` 受管标记，且在“来源日记”中精确引用目标 ID；异常索引不会导致一份无关回顾被删除。

开始删除前会先写入不含原文、标题或摘要的恢复契约：它冻结条目原文块 SHA-256、索引回顾引用，以及每份受管回顾的路径和 SHA-256，最后一步才移除。存在 pending purge 时，除同一 ID 的 `purge` 收尾外，其他日记写操作都会停止；`list` 和 `purge-plan` 仍可只读使用。若原文块、回顾内容、来源引用或路径集在中断后漂移，工具会保持操作冻结并 fail closed：不自动扩大范围，也不宣称完成。当前没有自动 replan/abort 命令；需人工核对并恢复原冻结契约后，再用同样确认重跑 `purge`。契约未漂移时，`purge-plan` 会显示 `resume`，重跑可幂等收尾。

工具会删除该条目的整段原文和机器索引记录；由于回顾可能含有无法逐句溯源的衍生内容，受影响的整份回顾也会删除，其他有效来源之后可以重新生成回顾。旧 ZIP、聊天历史、iCloud 版本或设备备份不会随之自动删除，不能把 `purge` 回执说成全局彻底删除。

所有命令会通过 `journal/.journal.lock` 串行化整个读改写区间，避免同时写入时出现“两个命令都成功但其中一条丢失”。锁文件不是日记内容，也不会进入备份；获取锁超时时本次不写入，并提示安全重试。

工作簿日常同步时把 `tools/update_life_plan_journal.mjs` 的预览目录参数设为 `-`：脚本会在权限为 0700 的系统临时目录渲染校验图，文件权限为 0600，并在成功或失败后清理。只有确实需要人工查看时才传入明确目录；这类显式预览会保留，属于敏感派生文件。
