# 设计方案：Life Console 2.8.0

状态：Gate 2 已由 PO 于 2026-08-31 确认；首版 Preview 真机反馈后，PO 已确认按招商银行 App 参照修订移动端几何。

## 1. 设计原则

1. **导航是独立控制层**：底栏浮于内容之上，页面可从其下方经过。
2. **与设备形态协调**：外层胶囊使用半高圆角，左右与底部间距由安全区共同决定。
3. **克制模拟原生**：使用 Web 可稳定实现的透明度、模糊、描边和阴影，不伪称原生 Liquid Glass。
4. **始终可预测**：导航常驻，不随滚动隐藏、收起或改变占位。
5. **可读优先**：材质效果服从标签、图标、焦点与触控可用性。

Apple 当前 HIG 将 iPhone Tab Bar 描述为浮于底部内容之上、允许内容从下方透出；本方案采用这一层级原则，但不复制原生专有材质或动画。

## 2. 结构与尺寸

| 项目 | 设计值 |
|---|---|
| 外层导航高度 | 62px |
| 外层圆角 | 31px，与高度保持半径同心 |
| 左右最小间距 | 12px，并叠加横向 safe-area 保护 |
| 距物理屏幕底部 | `max(8px, env(safe-area-inset-bottom) - 13px)`；34px 安全区下为 21px |
| 外层内边距 | 4px |
| 单项可点击高度 | 52px；实际目标不小于 44×44px |
| 图标 | 20px 单色线性 SVG，`aria-hidden` |
| 标签 | 10–11px，单行、持续显示 |
| 当前页 | 系统蓝图标 / 标签 + 轻量内层选中表面 + 较高字重 |

在窄屏或横屏中，左右间距使用 `max(12px, env(safe-area-inset-left/right))`，不允许胶囊进入设备不可交互区域。

## 3. 材质

- 外层背景：偏冷的浅色半透明表面，目标约 `72%–82%` 不透明度。
- 模糊：Safari `-webkit-backdrop-filter` 与标准 `backdrop-filter`，建议 24–28px blur 并提高饱和度。
- 轮廓：约 1px 半透明白色细边，帮助浅色背景下保持边界。
- 阴影：柔和下投影 + 极弱内高光，不使用强发光。
- 回退：不支持背景模糊时提高背景不透明度，保留边界和阴影。
- 当前页内层表面保持低对比，避免形成五层以上的玻璃叠加。

## 4. 内容与滚动关系

- `.workspace` 不再通过 `margin-bottom` 把内容整体推离导航。
- 内容滚动到导航下方时仍可见，形成真实的前后层次。
- `.page-content` 保留足够底部留量，最后一个表单控件、按钮或卡片能滚动到导航顶部以上。
- 滚动容器设置与导航高度一致的 `scroll-padding-bottom`，键盘或程序化聚焦时优先把目标滚到可操作区域。
- 不监听滚动方向，不收起导航，不改变导航高度。

## 5. 图标与标签

| 页面 | 图标语义 |
|---|---|
| 工作台 | 房屋 / 首页 |
| 记录 | 书写 / 记录 |
| 进展 | 趋势 / 上升 |
| 系统 | 设置 / 齿轮 |

图标使用应用内联 SVG，不引入第三方图标字体或网络资源。文字标签保留，因此图标不是唯一语义来源。

## 6. 层级与状态

- 页面内容：基础层。
- 顶部品牌栏：现有顶层导航层。
- 浮动底栏：`z-index` 高于页面内容，低于编辑 Sheet、删除确认和全屏遮罩。
- Toast：移动端锚点移动到浮动底栏上方，不与其重叠。
- 登录 / 启动状态：不展示四页导航的现有语义保持不变。
- 键盘打开：不新增 JS 检测；依靠视觉 viewport、内容留量和浏览器聚焦滚动，真实 iPhone 作为最终验收。

## 7. 全屏与安全区

为让内容真正延伸到屏幕底部和 Home Indicator 背后，设计推荐使用 `viewport-fit=cover`：

- 顶部品牌栏增加 `env(safe-area-inset-top)`，品牌内容保持在安全区内。
- 底栏背景浮于全屏内容之上，并像参照 App 一样进入底部安全区上半部；外壳与 Home Indicator 保持约 8px 视觉间隔。
- 页面背景延伸到物理屏幕四边；文字、表单和导航点击目标仍遵守安全区。
- 普通 Safari 与主屏幕 PWA 共用同一套 CSS，不按安装状态维护两套布局。

该选择会主动取代 2.6.0 “不启用 `viewport-fit=cover`”的最小适配边界，必须作为 Gate 2 的明确评审项。

## 8. 动效与辅助功能

- 页面切换沿用现有即时切换；不新增导航形变。
- 当前页变化只使用现有短时颜色 / 背景过渡。
- `prefers-reduced-motion: reduce` 下禁用非必要过渡。
- 保留 `aria-current="page"`、清晰的 `:focus-visible` 和可点击文字标签。
- 当前页同时使用颜色、字重和选中表面表达。

## 9. 设计验收

1. 390×844 合成页面中，导航为 62px 浮动胶囊，左右 12px，内容在其周围可见。
2. 402×874、34px 底部安全区条件下，导航底距为 21px，外壳与 Home Indicator 保持约 8px 视觉间隔。
3. 四个导航项无折行、重叠或点击目标不足。
4. 白卡片、浅灰背景、蓝色 Hero 内容经过导航下方时均保持可读。
5. 最后一个可操作控件可滚到导航上方；弹层和 Toast 层级正确。
6. 不出现滚动自动收起、动态折射或原生能力宣称。

## 10. 参考

- [Apple Human Interface Guidelines: Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
- [Apple Human Interface Guidelines: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [WebKit: Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
