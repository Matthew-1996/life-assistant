# 上线证据：Life Console 2.7.0

状态：Production 已完成，Todo 2.7.0 范围的稳定域名、Owner 会话与只读交互验收通过。

## 1. 发布范围

- 功能 PR：[PR #79](https://github.com/Matthew-1996/life-assistant/pull/79)，Todo 状态筛选。
- Production 构建门禁修复：[PR #80](https://github.com/Matthew-1996/life-assistant/pull/80)。
- 最终发布提交：`feb5c2e3be985b0dc69f89d9144d233391d2cbfc`。
- 稳定域名：[project-wpabq.vercel.app](https://project-wpabq.vercel.app/)。
- 无数据库迁移、Owner 数据写入、Supabase 项目重启、Cron 调用或模型调用。

## 2. 事故、回滚与修复

1. 首次 Production 使用本地 `--prebuilt` 制品，Vercel 拉取的敏感 Supabase 公钥被替换为字面占位符 `[SENSITIVE]`，导致现有 Owner 会话无法读取工作台。
2. 正式域名立即回滚到上一已知可用制品；同一 Owner 会话无需重新登录即可恢复工作台，证明账号、会话与数据库未损坏。
3. PR #80 以失败测试证明占位符此前可完成 Production 构建，再增加编译前公钥校验；占位符必须失败，合法合成公钥仍完成 130 模块构建。
4. PR #80 三项 GitHub CI 全绿后合并；最终制品由 Vercel 远端从准确 `main` 构建，不再使用本地预构建输出。

## 3. 技术验收

- Vercel 远端构建调用新增环境门禁，130 个模块完成转换，部署状态为 Ready、target 为 Production。
- 稳定域名解析到最终远端构建制品；上一已知可用制品继续保留为回滚锚点。
- 首页返回 200；严格 `script-src 'self'`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY` 与 `Referrer-Policy: no-referrer` 均保留。
- 未知 `/api/*` 探针返回 404；现有五个 Functions 与 07:00 上海时间 Cron 注册保持不变，验收未调用它们。
- Production bundle 不包含 Candidate Preview 的合成 Todo 内容。

## 4. Owner 真实浏览器只读验收

- 稳定域名刷新后，既有 Owner 会话直接进入工作台，Supabase 状态为在线，浏览器无控制台错误。
- “今日”默认显示“项目状态：未开始、进行中”；已完成 Todo 不出现在列表或甘特图。
- “全部”保持同一默认筛选；已完成 Todo 同样不出现在列表或甘特图。
- 点击“已完成”选项的行内文字后，已完成项目可被回捞且浮层保持展开；再次点击恢复默认后，可见列表中的已完成项目数量回到零。
- 验收结束时已恢复“今日”Tab、默认两个状态与关闭的筛选浮层，没有提交表单或改变 Todo 状态。

## 5. 非本版本范围

- 每日新闻卡片仍显示既有读取失败；本次没有点击其重试按钮，也没有把该既有问题计入 Todo 2.7.0 的通过证据。
- `validate_project.py` 的私有真相源缺失、既有旧链接和测试夹具启发式命中均为本次差异前已存在的工作区债务。

## 6. 结论

Life Console 2.7.0 的 Todo 状态筛选已在 Production 完成发布与 Owner 真实浏览器验收。首次错误制品已被替代，新增构建门禁可阻止同类 Vercel 敏感占位符再次进入标准 Production 构建流程。
