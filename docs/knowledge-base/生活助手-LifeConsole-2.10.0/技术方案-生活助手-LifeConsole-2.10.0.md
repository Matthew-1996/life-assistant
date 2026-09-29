# 技术方案（评审候选） · Life Console 2.10.0

状态：draft.2 技术路线已获 PO 确认，批准实施 A（合成库与接口）。A 已完成，PO 随后回复“继续”授权 B；站内界面候选已获 PO 确认；继续开发时优先推进 E1 预约业务备份，C/D 订阅延后。详见 A/B 工程验收。

## 当前基线

基于 2.9.0：React/Vite 工作台，兼容 PostgreSQL、Auth、PostgREST 的自托管后端，现有 Owner 隔离、原子 RPC、revision 与幂等写入机制。沿用当前数据源，不能按旧 Supabase 托管实例设计真实绑定。公开应用仓库只保存通用方案；服务器运行配置由独立私有项目承接。

新增 FitnessAppointment 模型，最小字段为 id、owner、title、start_at、end_at、time_zone、location、notes、revision、deleted_at 和审计时间。UTC 存储时刻，保留 IANA 时区，首版默认 Asia/Shanghai；不能因设备旅行时区静默改约定时间。只允许同日且结束晚于开始的预约。

新增 FitnessRepositoryPort：listRange、create、update、softDelete。更新与删除必须携带 expectedRevision，新建携带幂等键。认证/RLS 由服务端执行，不依赖前端传入 owner。读取按日历可见日期范围，包含跨月补齐格，不使用截断后伪装完整的结果。

## Apple 订阅可行性

2026-09-28 核查官方资料：

1. [Apple：Add calendar subscriptions in iCloud](https://support.apple.com/en-ie/102301)，页面标示更新于 2026-05-27。支持在 iPhone、iPad 或 Mac 添加订阅并选择 iCloud，使同一账户设备可见。
2. [Apple：Share calendars on Mac](https://support.apple.com/guide/calendar/share-calendars-icl32362/mac)。订阅可设置自动刷新；订阅事件由提供方维护，不能在订阅端编辑。
3. [Apple：Refresh calendars on Mac](https://support.apple.com/en-asia/guide/calendar/icl1024/mac)。支持手动与自动刷新；不能据此承诺 iPhone 更新时延。

结论：单向可刷新订阅在平台层面成立；Life Console 的服务端可达性、认证方案、删除传播和实际客户端表现尚未验证。没有开展真实账号测试。直接写入 iCloud 和双向同步不属于已选方案。

## ICS 服务方案

后续在现有私有后端增加只读 HTTPS ICS 服务，不在浏览器持有数据库管理凭据。订阅地址不依赖浏览器登录 Cookie，而是使用高熵、可撤销的独立令牌；数据库只存令牌哈希。令牌不得包含 owner ID 或可猜测信息；该入口绝不授予写权限。

认证后的控制接口负责启用、停用、更换令牌、修改备注输出偏好。首次启用明确显示输出字段并确认。拿到链接即可读取数据，因此必须在公网反代、应用日志、错误上报及分析系统中验证完整 URL 的脱敏，避免通过重定向或 Referer 外传。订阅入口不使用共享 CDN 缓存；撤销或更换后旧链接立即不能读取。撤销不能抹除 Apple 已缓存的副本，用户可在 Apple 日历取消订阅。

ICS 输出事件标题、开始/结束和地点，备注默认为无；可选备注作为纯文本转义输出，校验 CRLF、换行、UTF-8 折行，防止插入额外 ICS 属性。通过持久 id 构造稳定 UID，revision 对应递增 SEQUENCE，提供 DTSTAMP/LAST-MODIFIED；变更同一事件不生成新 UID。带明确 UTC 时刻，避免浮动时间误读。

软删除从活动订阅集合移除，删除传播必须通过 Apple 客户端探针验证，不能假定单靠 CANCELLED 就会生效。读取源故障返回明确错误，不能返回 200 空日历导致客户端错误清空。任何缓存策略都须证明撤销和更新不被绕过。

首版不引入训练统计、数据仓库、双向合并或新的定时任务。订阅通过客户端拉取最新内容，不依赖后台向 Apple 推送。

## 后续可行性探针与退出条件

只在获得真实连接范围确认后，使用独立合成日历验证：添加一条事件 → 修改标题、时间、地点 → 删除 → 手动刷新与自动刷新 → 多设备观察；额外验证中文、长备注、令牌更换/撤销、未认证与跨 Owner 访问。

记录设备/OS、操作时间、观察时间和实际时延；不承诺固定 SLA。必须确认修改不重复、删除收敛、撤销阻断读取、日志无令牌、服务故障不清空、没有写入其他日历。任一关键条件不满足即不发布订阅入口，仍可独立推进站内日历；不拿一次性导入冒充同步。

设计阶段已核查公开官方说明；当前 A 实现不包含 ICS 服务，仍未验证上述探针。

## 评审候选：模块与交付边界

主线先实现独立站内预约，订阅为默认关闭的附加能力。应用仓库负责预约 domain、repository、UI、通用迁移、合成测试及 ICS 序列化契约；私有后端项目负责订阅 HTTP 服务、反代路由、受限数据库身份及运行配置，各自独立 PR。公有仓库不保存服务器绑定或运行记录。

前端在 TodayPage 的现有完整 Todo 区域之后挂载 FitnessPanel，不改 Todo 的范围、过滤、新建、列表、甘特和原有响应式规则。移除工作台锚点展示及仅服务于该展示的局部状态，不删共享 checkin API、数据库列、记录页输入或历史数据；不删除其他已批准功能。不以合成稿的静态 Todo 替换真正的 TodoPanel。

FitnessPanel 内部分为 MonthCalendar、DayAppointments、AppointmentEditor 和 CalendarSubscriptionSettings。生产与合成 repository 分离；生产缺配置/缺迁移时显示暂不可用，禁止自动回退演示数据。沿用现有认证会话；原型不参与生产 bundle。

## 数据与写入协议

`fitness_appointments` 使用 UUID 主键与 user_id 外键，title 1–120 字，location 最多 240 字、notes 最多 4000 字，空值用空字符串。start_at/end_at 为 timestamptz，time_zone 首版固定 Asia/Shanghai；数据库校验上海日历日一致且结束晚于开始。revision 从 1 起，另含 created_at/updated_at/deleted_at。活动记录以 (user_id,start_at,id) 索引，不加训练完成状态。

幂等回执唯一键为 (user_id, operation_key)，保存规范化输入指纹与 appointment_id；相同键同输入返回原记录，键同但输入不同返回冲突。新建事务一次完成记录、回执、仅元数据审计。更新/删除以 owner+id 行锁和 expected_revision 校验，成功时递增 revision；软删除重复请求返回已删除结果，不恢复、不重复创建。状态未知的写入不得盲目自动重试：新建复用同一幂等键，更新失败读取最新 revision 后让用户核对。

所有写 RPC 使用不可由用户自行修改的 Owner 授权登记；仅“已登录”不等于 Owner。user_id 由 auth.uid() 得出，拒绝客户端指定/更换 owner。默认拒绝 anon；非 Owner 有效账号同样拒绝。表 RLS 允许 Owner 读自己的记录；authenticated 无直接 INSERT/UPDATE/DELETE，写入仅走受限 RPC。definer 函数固定空 search_path，完整限定表名，撤销 PUBLIC/anon 执行权限。参照 [Supabase 数据库函数安全说明](https://supabase.com/docs/guides/database/functions)，实际以自托管 PostgreSQL 权限测试验收。

### 前端接口约定

| 操作 | 输入 | 输出/行为 |
|---|---|---|
| listRange | from、to（上海业务日，左闭右开）、cursor | 按 start_at、id 升序，每页 100，返回 items/nextCursor；取完可见范围后展示 |
| create | operationKey、title、startAt、endAt、location、notes | 保存后的 Appointment；时区固定，不由设备时区解释 |
| update | id、expectedRevision、上述可编辑字段 | 新 revision；过期返回 conflict，绝不静默覆盖 |
| softDelete | id、expectedRevision | deleted_at 非空记录；失败仍保留界面原预约 |
| getSubscription | 无 | enabled、includeNotes、revision；不返回令牌或旧链接 |
| rotateSubscription | expectedRevision、includeNotes | 新私密链接仅在本次成功响应出现一次 |
| updateSubscription | expectedRevision、enabled/includeNotes | 新状态；停用后重新启用必须换令牌 |

listRange 限一次最多 62 天，覆盖最多 42 格月历；按页读取，不静默截断。分页失败保留上次已成功读取内容并提示未刷新，不显示“暂无预约”。页面快速切月/登出时使旧请求失效，避免异步结果覆盖当前月份或跨会话显示。

错误统一区分 unauthorized、forbidden、validation、conflict、transient。编辑冲突保留草稿，读取最新记录后展示差异；如果另一端已删除，只能放弃草稿或用户明确另建，不能复活原记录。选择新日期、更新后回跳日期均按上海业务时区计算。

## 订阅令牌与读取服务

每个 Owner 一条 `fitness_calendar_subscription`：user_id、token_hash、enabled、include_notes、revision、feed_revision、updated_at。令牌由受控后端安全随机生成 32 字节，base64url 编码；数据库仅存 SHA-256。明文仅在创建/更换成功响应出现一次，不持久化到前端、日志或备份。响应丢失时只显示状态，用户主动更换取得新链接，不自动轮换多次。

管理操作通过 Owner 会话认证的原子 RPC 完成。浏览器只持有现有会话，不接收后台管理身份。ICS 为独立 GET/HEAD 路由 `/calendar/fitness/<opaque-token>.ics`；不复用设备消息令牌、不接收任意 user_id、不提供日历写入。私有后端用仅能执行指定只读 feed 函数的角色取得数据；该函数只接受哈希，校验订阅 enabled，限定 Owner 后返回允许的投影。HTTP 服务不使用超级用户或全表写权限。

读取单个一致性快照，输出该订阅全部未软删除预约，不以滚动窗口静默删除旧事件；10,000 条或 5 MiB 输出预算超限返回 503 并记录无内容指标，不返回半份日历。使用流量/并发限制并返回 Retry-After；实际阈值在私有部署配置维护，不能按 IP 误将共享 Apple 拉取节点长期封禁。

GET 成功为 200 text/calendar; charset=utf-8；HEAD 同权限校验但无正文；无效/停用令牌统一 404；数据库/序列化故障 503；不重定向，不将错误伪装成 200 空日历。所有响应 Cache-Control: private, no-store；首版不做 304/CDN 缓存。URL 令牌必须在反代和应用日志入口被移除，响应体、备注和授权头不进入监控。服务有日志脱敏测试通过前，不开放真实订阅。

ICS 使用 [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545) 格式：VCALENDAR + VEVENT，稳定 UID，DTSTART/DTEND 为 UTC，SUMMARY/LOCATION 和可选 DESCRIPTION。文本转义反斜线、逗号、分号与换行，CRLF 分隔，75 octet 折行不拆开 UTF-8 字符。不输出 ATTENDEE、ORGANIZER、附件或 VALARM；不产生邀请和提醒副作用。

首次预约写入时若无订阅元数据则原子初始化为 disabled、token_hash 为空；不生成外部访问能力。每次预约增改删或订阅字段偏好变更，在同一事务内递增 feed_revision；序列号取订阅 feed_revision，使备注显示开关变化也能传播。DTSTAMP/LAST-MODIFIED 取事件和订阅内容设置变更的较晚时刻，不使用每次拉取时间。UID 不含真实域名、用户标识或数据库环境；基于事件 UUID 固定形成。软删除从订阅集合移除，其 Apple 客户端传播必须实测。

## 备份、恢复与回退

新业务表、幂等回执和订阅哈希/状态纳入受控数据库备份，并加入隔离恢复核对。若仍使用应用层业务快照，则升级版本与解析白名单以包含预约，旧快照继续可读，缺少预约字段仅表示旧版未收录，不能反向覆盖新表。订阅哈希属于服务访问材料，不加入用户可下载的普通业务导出。

隔离恢复中先停用全部订阅，不允许测试恢复库提供可用 feed。灾难恢复后也默认撤销订阅令牌，再经 Owner 主动重建，防止旧备份恢复已撤销令牌。正常备份不改变线上订阅状态。

采用新增迁移，不回填虚构预约。上线前备份、隔离迁移、权限检查与回滚演练；真实迁移需独立授权。停用订阅先于服务下线；应用回退到旧版本时保留新表及已产生记录，不以 DROP TABLE 回滚。订阅失败不会回滚已成功保存的站内预约。

## 分阶段实现建议（待 PO 确认）

每个工作块不超过 4 小时，超出则停在独立可验收边界继续拆分，不承诺总工期。

| 阶段 | 可验收产物 | 门禁 |
|---|---|---|
| A 数据契约 | 合成库迁移、Owner/RLS、原子 CRUD 与并发测试、备份覆盖方案 | 技术方案确认后开展；不连接生产 |
| B 站内界面 | 保留 Todo、新增月历与编辑、移除工作台锚点展示；合成联调 | A 通过；PO 验收可用候选 |
| C 订阅服务 | ICS 序列化、令牌管理、最小权限读取、日志/缓存/撤销测试 | 独立私有后端 PR，不部署 |
| D 订阅探针 | 获批合成日历在 Apple 客户端的增改删/刷新观察记录 | 真实连接及测试入口另行授权 |
| E 发布准备 | 端到端测试、数据恢复、去敏证据、发布/回退清单 | PO 验收与上线分别确认 |

唯一主项是站内日历；订阅是可独立停用的次项。D 不通过则隐藏订阅入口并说明未提供同步，B 可独立验收。当前技术评审只请求确认上述实现路线，不请求开启真实数据访问。

## 阶段 A 实施补充

公开 schema 中 profiles 可由登录用户维护，不能充当 Owner allowlist。新增 `life_console_private.fitness_owners`，默认空表，仅受控管理员可登记；迁移不授予任何真实用户访问。预约表在 public，回执、Owner 登记和订阅元数据在私有 schema，不向 authenticated 开放数据权限；RLS helper 仅提供当前用户是否获准的布尔结果。

同 Owner 的写事务先取得相同 advisory lock，再执行行锁/revision/回执/审计与 feed_revision 更新，保证小型个人日历的写入原子性。幂等重试返回原预约的当前状态（可已改期或软删），不会重新插入或复活；get(id) 包含软删记录以供后续冲突界面使用。订阅元数据默认 disabled/token_hash=null，本阶段没有签发令牌或提供 feed。

## 阶段 B 实施补充

FitnessPanel 将来源对象或 sessionScope 变化视为新会话重新挂载；退出/卸载后不应用旧异步结果。月历完整取完可见日期范围的所有游标页后才更新，失败保留可用同月数据并显式未刷新。编辑侧栏另查目标日期以提示重叠，不阻断提交；不保存到浏览器持久层。

首次新建生成 operationKey，响应未知时锁定该次内容、重试复用原键；后续认证拒绝不能清除曾经未知的请求键。关闭未知结果的草稿须确认并提示先刷新核对。编辑冲突先 get 最新记录，展示当前值/本次草稿，再明确按最新 revision 重提；已删不能复活。成功改期选中新业务日，删除冲突可取消并用常驻刷新入口核对。原生 modal 使用 showModal 后显式焦点，取消回触发按钮，保存/删除回稳定新增按钮。
