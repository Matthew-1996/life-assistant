# 生活助手 Agent：核心 Skill 与 Prompt 全网调研

调研日期：2026-07-31  
范围：公开官方文档、开放规范、成熟开源项目、研究论文、安全资料和生活质量框架。这里的“全网”指跨来源的系统检索与筛选，不声称穷尽互联网上的每个 Skill。

## 结论先行

最优起点不是安装最多的插件，而是建立一个单一主助手和七个可验证闭环：

1. 最小化用户建档与权限约定；
2. 可查看、可纠正、可删除的个人记忆；
3. 可新增、排序、暂停、完成和替换的动态生活目标；
4. 日程、任务、精力和缓冲合并后的今日计划；
5. 只在重要且可行动时出现的每日简报；
6. 从一周事实中选出一个改进实验的复盘；
7. 对外部、资金、隐私、健康和难恢复动作的分级审批。

生活助手的核心不是“知道很多”，而是能在正确时机读取最少必要信息，给出小而现实的下一步，并在有外部影响时把决定权交还用户。

## 调研方法

候选方案按六项筛选：生活质量影响、使用频率、是否能形成行动闭环、数据是否可获得、错误是否可恢复、隐私与权限风险。

来源分级：

- A 级：官方产品文档、开放规范、政府/国际组织资料；
- B 级：维护活跃且文档透明的开源项目；
- C 级：论文和新 benchmark，用于发现前沿问题；
- D 级：社区 Skill/Prompt，只取设计灵感，不直接信任或安装。

逐项来源、可借鉴模式和不采用部分见 [公开来源评分表](2026-07-31-公开来源评分表.md)。

## 从公开资料得到的关键设计原则

### 1. Skill 与工具必须分开

[Agent Skills 开放规范](https://agentskills.io/specification)把 Skill 定义为含 `SKILL.md` 的可移植工作流包，并推荐渐进加载：启动时只加载名称与描述，触发后才读取主体，需要时再读取引用和脚本。[OpenClaw 工具说明](https://github.com/openclaw/openclaw/blob/main/docs/tools/index.md)也明确区分：工具负责读取或改变外部系统，Skill 负责可重复的工作流、评审标准和约束。

因此，“Google Calendar”本身不是生活规划 Skill；它是日历工具。真正的 Skill 是“结合日历、任务、精力和缓冲制定现实的今日计划”。

### 2. 第一版应是单一主助手，而非多 Agent 拼盘

[OpenAI 的 Agent 构建实践指南](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)将 Agent 的基础归纳为模型、工具和指令，并建议先最大化单一 Agent 的能力；只有复杂条件逻辑或工具重叠已导致稳定失败时再拆分多 Agent。[OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)提供工具、会话、guardrails、人类审批和 tracing 等基础能力。

对个人用户而言，一个统一入口更容易建立信任、管理记忆和保持口径一致。领域专家可以作为按需 Skill 或后台工具，而不应让用户面对多个互不知情的助手。

### 3. Prompt 要分层，不要写成一个无限增长的“超级提示词”

[OpenClaw Agent workspace](https://github.com/openclaw/openclaw/blob/main/docs/concepts/agent-workspace.md)把人格、用户资料、工具说明、长期记忆和主动检查拆成不同文件。其官方 [AGENTS.md 模板](https://raw.githubusercontent.com/openclaw/openclaw/main/docs/reference/templates/AGENTS.md)、[SOUL.md 模板](https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/SOUL.md)与 [USER.md 模板](https://raw.githubusercontent.com/openclaw/openclaw/main/docs/reference/templates/USER.md)提供了有价值的结构：身份与工作规则分离，用户资料与长期事实分离，主动检查保持短小。

[OpenAI 最新模型提示建议](https://developers.openai.com/api/docs/guides/latest-model)强调删除重复规则、只暴露相关工具并通过代表性 eval 验证；[Google 的 Prompt 设计指南](https://ai.google.dev/gemini-api/docs/prompting-strategies)建议把关键约束放在系统指令前部、用一致结构分隔角色/上下文/任务，并明确输出格式。

本方案因此采用：精简主 Prompt + 按需 Skill + 结构化用户资料 + 分层记忆 + 工作流 Prompt。

### 4. 记忆不等于保存全部聊天

[OpenAI Sessions 文档](https://openai.github.io/openai-agents-python/sessions/)区分多轮会话历史与持久化存储，[Agent memory 文档](https://openai.github.io/openai-agents-python/sandbox/memory/)进一步区分会话记忆与从历史任务中提炼的长期经验。OpenClaw 模板也区分每日原始记录、用户稳定指令和长期事实。

生活助手应只长期保存会影响未来协助的稳定信息，并让用户能查看、更正和删除。密码、令牌、完整证件/银行卡信息、第三方秘密和未经确认的健康/人格推断不进入长期记忆。

### 5. 主动性要有阈值

OpenClaw 的官方模板建议把主动检查限制为短清单，并设置安静时间和“无变化则沉默”。社区 [daily-briefing Skill](https://raw.githubusercontent.com/openclaw/skills/main/skills/antgly/daily-briefing/SKILL.md)展示了天气、日历、提醒、生日和重要邮件的聚合模式，值得借鉴其紧凑输出与失败降级，但其脚本、依赖与邮箱访问不应未经审计直接采用。

新近的 [ProAgentBench](https://arxiv.org/abs/2602.04482)与 [π-Bench](https://arxiv.org/abs/2605.14678)都把时机判断、长期上下文和长周期任务视为主动个人助手的关键难题。这支持一个保守规则：只有“重要、及时、可信、可行动”同时满足时才打扰。

### 6. 生活质量必须是多维的

[WHOQOL](https://www.who.int/tools/whoqol)把生活质量视为个人相对于文化、目标、期望和关切的主观感受，常用维度包括身体、心理、社会关系与环境。[OECD Better Life Index](https://www.oecd.org/en/data/tools/well-being-data-monitor/better-life-index.html)进一步强调工作生活平衡、健康、社区、安全和主观满意度等因素。[CFPB 财务福祉框架](https://www.consumerfinance.gov/consumer-tools/educator-tools/financial-well-being-resources/)把日常可控、抗冲击、目标进展和选择自由作为财务福祉的核心。

因此生活助手不应只优化生产力。它还应保护睡眠、恢复、关系、生活环境、财务安全和自由时间。

### 7. 行为支持应先找阻力，再做计划

[COM-B 原始研究](https://pubmed.ncbi.nlm.nih.gov/21513547/)把行为发生所需条件归纳为能力、机会和动机。这对生活助手很重要：不知道怎么做、环境不允许、精力不足和目标并非本人选择，需要完全不同的帮助，不能都归因于“不够自律”。

[自我决定理论健康行为元分析](https://pubmed.ncbi.nlm.nih.gov/32437175/)及相关研究强调支持自主性、胜任感与关系，而非控制式施压。方向确定后，[实施意图元分析](https://www.tandfonline.com/doi/abs/10.1080/10463283.2024.2334563)显示带明确条件的 if–then 计划对多类结果有帮助，但效果会受目标动机和计划形成方式影响。

因此本方案使用两阶段流程：先确认目标属于用户本人，并定位主要阻力；再将选定行动写成可观察触发、最小动作、低精力版本和中断恢复规则。它不是治疗，也不应使用羞耻、惩罚或无限提醒。

### 8. 目标必须允许调整，而不是永久累积

[目标调整与生活质量元分析](https://pubmed.ncbi.nlm.nih.gov/31131441/)汇总 31 个样本，发现从不可行目标中适当脱离以及重新投入其他目标，都与更高生活质量存在关联；其中重新投入与正向及负向福祉指标均有关。该结果是相关性证据且效应受人群影响，不能变成机械的“放弃规则”，但支持生活助手把继续、缩小、暂停、完成和替换都视为正常选项。

因此当前重点不应被写成永久身份。新目标加入或现实条件变化时，助手需要重新比较收益、紧迫性、精力成本与冲突，并让用户决定排序，而不是把所有目标和提醒持续叠加。

## 推荐的核心 Skill 栈

### P0：先做

| Skill | 为什么是核心 | 最小可用输出 |
|---|---|---|
| 用户建档与权限 | 没有目标和边界，个性化会变成猜测 | 用户画像草案、安静时段、权限矩阵 |
| 动态目标维护 | 防止旧重点固化和新目标无限叠加 | 当前/辅助/候选/暂停/完成状态与复盘日期 |
| 个人记忆整理 | 让跨会话协助连续且可纠错 | 新增/修改/删除记忆的确认清单 |
| 今日现实规划 | 最高频、最直接降低认知负担 | 硬日程、三项以内重点、缓冲、可放弃项 |
| 每日简报 | 把多个信息源压缩成可行动摘要 | 60 秒简报；无重要变化则静默 |
| 每周生活复盘 | 防止只救火、不改系统 | 趋势、摩擦、下周一个实验 |
| 行动风险审批 | 让 Agent 能做事但不越权 | A–E 风险级别、批准点与审计记录 |

### P1：第二批

健康与精力、饮食与采购、个人财务整理、关系维护、家庭维护、跑腿与旅行。这些领域价值很高，但需要更多敏感数据或外部动作，应在权限和记忆底座稳定后接入。

### P2：按个人需求

数字整理、学习与兴趣、就医准备、家庭照护、本地生活发现。是否建设取决于用户真实痛点，避免为“完整”而制造系统负担。

完整触发示例、工具映射和权限要求见 [Skill 目录](../skills/improve-daily-life/references/skill-catalog.md)。

## 对公开 Skill 与 Prompt 的取舍

| 来源/模式 | 结论 | 原因 |
|---|---|---|
| Agent Skills 规范与 Anthropic 官方仓库 | 采用格式与渐进加载 | 可移植、触发清晰、易版本化 |
| OpenAI 单 Agent + tools + guardrails + HITL | 采用运行架构 | 易评估，能按风险暂停 |
| OpenClaw `SOUL/USER/MEMORY/HEARTBEAT` 分层 | 改造采用 | 身份、用户、记忆、主动性职责清楚 |
| OpenClaw daily briefing | 只借鉴输出结构 | 聚合模式好，但依赖和邮件权限需审计 |
| 社区 advanced-calendar 等 Skill | 只借鉴用例 | 质量、依赖和权限声明不一 |
| 随机 Prompt 合集 | 不作为主依据 | 通常缺少权限、记忆、失败和评估设计 |

## 安全结论：不要直接批量安装社区 Skill

[OpenClaw 官方 Skills 文档](https://github.com/openclaw/openclaw/blob/main/docs/tools/skills.md)要求把第三方 Skill 当作不可信代码并建议沙箱运行。[OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)强调 prompt injection、最小权限、隐私保护和工具控制。

[Snyk ToxicSkills 调研](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)在其 2026 年扫描的 3,984 个公开 Skill 中报告 13.4% 存在至少一个 critical 问题，并确认了恶意载荷。该结果来自供应商研究，应结合方法局限理解，但足以否定“高星/市场上架即可信”的假设。

本项目的策略是：先读源码、固定版本、扫描依赖、最小权限、隔离试运行；优先把有价值的工作流重新实现为本地可审计 Skill。

## Prompt 设计蓝图

主 Prompt 只保留长期稳定规则：北极星、工作循环、主动阈值、权限矩阵、记忆原则、健康/财务边界和沟通风格。具体的晨间简报、晚间收尾、周复盘、习惯、决策、关系、饮食和跑腿流程放在按需 Prompt 中。

可直接使用：

- [生活助手主 Prompt](../skills/improve-daily-life/references/core-system-prompt.md)
- [13 个工作流 Prompt](../skills/improve-daily-life/references/workflow-prompts.md)
- [记忆与行动安全规则](../skills/improve-daily-life/references/memory-and-safety.md)

## 建议实施顺序

1. 用“初次建档 Prompt”做一次 10–15 分钟的最小访谈；
2. 建立动态目标台账，只选择一个当前重点并设置复盘日期；
3. 只接入日历和任务的只读权限；
4. 运行一周今日规划与每日简报，记录误报、漏报和打扰感；
5. 加入每周复盘和可纠正记忆；
6. 通过真实案例校准审批等级；
7. 再从健康、饮食、财务、关系、家庭、出行中选择一个领域接入；
8. 每个 Skill 用触发、反触发、缺数据、冲突、失败和越权案例做回归测试。

## 本轮交付判断

本轮不建议安装任何外部社区 Skill。已经形成一份符合 Agent Skills 结构的本地核心 Skill 草案，以及可直接测试的 Prompt 包。下一步最有价值的工作不是继续收集模板，而是了解用户真实生活约束，并用一周试运行数据迭代。
