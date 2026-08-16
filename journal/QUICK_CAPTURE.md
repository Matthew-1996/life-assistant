# 日记快速入库

只用于新增一篇普通日记。更正、撤回、恢复、删除、回顾、发布或隐私问题改走完整日记工作流。

1. 使用用户明确日期；只有“今天/昨天”时按当前 `Asia/Shanghai` 日期换算。没有事件时刻就保存 `time=null`、`time_precision=unknown`；约略时刻标为 `approximate`。
2. 原话作为 `content` 优先保存。Agent 同步生成的整理结果必须严格符合 [`journal-normalization-v1.json`](../apps/life-console/contracts/journal-normalization-v1.json)，包括标题、摘要、事实、感受、人物、地点、主题、规划线索、待确认推断与标签；每条事实性整理都要带原文证据。只允许使用已确认且带 revision 的个人档案补充人物关系，不做人格、关系或健康诊断。
3. 明显秘密不落盘；当前云端日记固定 `privacy=owner-only`，不公开发布到网页或其他连接器。
4. 通过 stdin 调用 `python3 tools/life_console_cloud.py journal --input -`，传入原文及已校验的 `normalization`。工具先保存原文，再以 Agent 身份异步状态机写入整理结果；整理失败不影响已经保存的原文，并返回 `normalization_status=pending|failed`。
5. 只有收到 `status=saved` 才表示 Supabase 唯一真相源已保存；`unavailable` 或 `unauthenticated` 必须回复“未保存”，不得回退调用本地日记工具。
6. iCloud 日记目录只作切源前历史快照和恢复校验；`journal_manager.py add` 在在线主源标记存在时拒绝活跃写入。
7. 云端原文成功后立即用一句话回执日期与已保存结果，并区分“整理完成”或“整理稍后继续”。普通新增不自动刷新 Google/XLSX，也不触发全量备份。
8. 若云端原文写入失败，只说明未保存并给出通用失败原因，不声称成功，也不输出日记原文。

隐式归档的回执再补一句：“如果你只是想聊聊，说‘不要记刚才那条’即可撤回。”
