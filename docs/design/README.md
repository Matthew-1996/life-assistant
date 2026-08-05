# Life Console UI 设计治理

本目录是 Life Console 前端 UI 的设计管理入口。后续网页、原型、组件和视觉风格变更都应从这里读取约束，再进入 React 实现。

## 三层资产

1. `apple-top-level-design-system/`

   顶层设计系统。它来自已解压的 Apple Copy，包含视觉 token、组件结构、组件预览、网站参考和图标资产。它定义“这个项目的 UI 应该长什么样”：克制、留白、胶囊按钮、轻边框卡片、DM Sans、JetBrains Mono、黑白灰为主、蓝色只做关键强调。

2. `life-console-apple-redesign/`

   已验收的 Life Console 苹果式前端重构方案。它包含四个静态原型页面：工作台、记录、进展、系统。线上 React 版本应优先对齐这里的页面结构、信息层级和视觉比例。

3. `life-console-apple-ui-ue-guidelines.md`

   长期 UI/UE 维护规范。它把 Life Console 的产品原则固化为可执行规则：低认知负担、写入需确认、iCloud 作为真相源、趋势不替代判断、不制造压力型反馈。

## 使用顺序

1. 先读 `apple-top-level-design-system/README.md` 和 `apple-top-level-design-system/usage-guide.md`，确定视觉系统和组件基线。
2. 再读 `life-console-apple-redesign/README.md` 和对应页面原型，确定 Life Console 的页面结构。
3. 最后读 `life-console-apple-ui-ue-guidelines.md`，确认文案、交互、隐私和维护边界。
4. 改 React 前端时，优先保持核心功能不变：保存、刷新、冲突处理、删除确认、状态写入和 API 调用不能因为视觉调整而退化。

## 维护规则

- 若要改视觉 token 或组件原则，先更新 `apple-top-level-design-system/`。
- 若要改页面结构、布局或主要信息层级，先更新 `life-console-apple-redesign/`。
- 若要改产品行为、文案语气、隐私边界或验收标准，同步更新 `life-console-apple-ui-ue-guidelines.md`。
- 若线上实现与原型不同，PR 必须说明差异原因；如果差异不是核心功能约束导致，应优先修正实现或更新原型。
- 所有设计资产只能包含通用规则和合成示例，不得包含真实日记、健康明细、外部账号标识、凭据或机器本地状态。

## 当前验收状态

当前线上 React 版本已经按 `life-console-apple-redesign/` 完成阶段性验收并合入 `main`。后续维护应把本目录视为 UI 管理基建，而不是一次性设计交付物。
