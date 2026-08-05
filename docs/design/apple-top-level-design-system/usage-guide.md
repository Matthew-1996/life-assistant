# Apple 顶层设计系统使用说明

本目录是 Life Console UI 的顶层设计系统资产，用于约束后续网页、组件、原型和前端实现。

## 使用顺序

1. 先读取 `README.md`，理解整体视觉语言、文案语气、颜色、字体、间距、圆角和阴影原则。
2. 再读取 `colors_and_type.css` 与 `css.json`，确认可复用 token。
3. 根据需求读取 `components/index.json` 和对应 `components/{slug}.json`。
4. 用 `preview/component-*.html` 和 `ui_kits/website/index.html` 校准视觉比例与组件状态。
5. 具体到 Life Console 线上前端时，以 `../life-console-apple-redesign/` 的已验收原型为页面结构基准，以 `../life-console-apple-ui-ue-guidelines.md` 作为长期 UI/UE 规范。

## 维护边界

- 本目录是顶层视觉与组件系统，不写入个人生活数据。
- 若要变更 token、组件或视觉原则，应同步更新 `README.md`、相关 component JSON、预览 HTML，并说明对 Life Console 原型与 React 实现的影响。
- 若线上实现因为核心功能约束无法完全贴合原型，应在 PR 中说明差异原因，并优先补充设计规范。
