# 技术可行性草案 · Life Console 2.10.0

状态：设计阶段草案；接口和数据结构均未实现，无数据库迁移或真实日历绑定。

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

本轮只核查公开官方说明并制作模拟 UI，未部署 ICS 服务，未验证上述探针。
