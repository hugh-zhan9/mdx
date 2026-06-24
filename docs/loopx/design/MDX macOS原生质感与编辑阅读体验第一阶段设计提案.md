# MDX 第一阶段以 macOS 原生桌面工具质感重塑窗口壳层与编辑阅读基线

Author(s): Codex
Last updated: 2026-06-24
Status: Draft
Discussion: 不涉及
Source requirements: `.loopx/intake/clarify-mdx-macos-native-feel-and-editor-reading-baseline-20260624141632.md`
Support lenses: architecture-designer

## Abstract / 摘要

我们建议把 MDX 第一阶段定义为一次 macOS-first 的桌面外观与阅读体验重塑，而不是排版引擎项目。方案核心是：在不改变 Markdown 作为唯一文档真相、也不改变 Workspace / Document 信息架构的前提下，统一 Tauri 窗口壳层、toolbar、sidebar、tab strip、panel surface 和编辑区版心，让应用整体更接近 Xcode / Finder 一类原生生产工具；同时把正文阅读舒适度提升到稳定可长期写作的基线。对 Knuth–Plass、OpenType MATH 和 TeX 级公式排版的需求，本提案明确作为第二阶段方向保留，不进入本次交付。

## Background / 背景与动机

当前仓库的产品目标已经明确强调“desktop-first Markdown workspace”和“desktop conventions over invented affordances”，并要求界面“calm, precise, local-first” [PRODUCT.md](/Users/zhangyukun/project/mdx/PRODUCT.md:1)。但现有前端壳层仍主要体现为跨平台 Web UI：

- `app/globals.css` 基于 Tailwind + daisyUI token，自定义颜色和边框较多，但没有 macOS 原生窗口与工具栏语气 [app/globals.css](/Users/zhangyukun/project/mdx/app/globals.css:1)。
- Workspace 主壳层是标准三栏 grid + 普通 header，像通用桌面 Web 工具，而不是 macOS document app [features/workspace/components/workspace-shell.tsx](/Users/zhangyukun/project/mdx/features/workspace/components/workspace-shell.tsx:1958)。
- Document Mode 和 Workspace Mode 都使用普通 Tauri window，没有 macOS 标题栏融合、traffic lights 留白或原生 titlebar 风格 [src-tauri/tauri.conf.json](/Users/zhangyukun/project/mdx/src-tauri/tauri.conf.json:1), [src-tauri/src/lib.rs](/Users/zhangyukun/project/mdx/src-tauri/src/lib.rs:497)。
- 标签栏、面板、按钮和正文留白仍偏“工程完成态”，未形成清晰的 macOS 工具感 [features/workspace/components/tab-strip.tsx](/Users/zhangyukun/project/mdx/features/workspace/components/tab-strip.tsx:1), [common/components/ui-controls.tsx](/Users/zhangyukun/project/mdx/common/components/ui-controls.tsx:1)。

用户同时提出了更长远的 Typographic 方向：Knuth–Plass 全局断行、OpenType MATH、接近 TeX 的公式排版。这是合理愿景，但它会直接触及编辑器内核和布局算法，而当前编辑器 spec 已明确 Markdown 仍是唯一真相，且编辑器 DOM 合同和 fallback 机制已经收紧 [docs/loopx/specs/editor.md](/Users/zhangyukun/project/mdx/docs/loopx/specs/editor.md:1)。因此，必须先把第一阶段限定为“视觉与阅读基线工程”，否则范围会失控。

## Goals And Non-Goals / 目标与非目标

### 目标

- 让 MDX 在 macOS 上具有明确、稳定、克制的原生桌面工具质感。
- 统一 Workspace Mode 与 Document Mode 的窗口壳层和视觉语言。
- 提升默认正文编辑/阅读舒适度，包括版心、留白、行高和块级节奏。
- 保持 Markdown 真相模型、编辑器结构边界、文件系统行为和现有工作流不变。
- 为后续更强排版引擎阶段预留演进空间。

### 非目标

- 不实现 Knuth–Plass 全局断行。
- 不实现 OpenType MATH 驱动的公式布局。
- 不替换现有编辑器布局模型。
- 不重做信息架构。
- 不新增阅读模式、专注模式或复杂偏好面板。
- 不把应用改成 macOS-only。

## Proposal / 设计方案

### 1. 以“macOS-first 工具壳层”统一所有窗口

我们将把窗口层视为第一阶段的关键设计对象，而不是单纯 CSS 皮肤。

规则：

- Workspace window、Document window、Document error window 都通过统一的 macOS window appearance helper 配置外观。
- macOS 下启用融合标题栏和顶部拖拽区；非 macOS 保持当前普通窗口行为。
- 不自绘 traffic lights，依赖系统原生窗口按钮。
- 标题栏与顶部 toolbar 在视觉上连成一个 document toolbar 区域。

例子：

- Workspace Mode 顶部左侧保留 traffic lights 空间，左栏从窗口顶部贯通，主工具按钮收敛到更像 Finder/Xcode 的 toolbar。
- Document Mode 采用同一标题栏语气，但保持更轻的单文档布局。

边界：

- 如果某个 macOS 版本或 Tauri 能力不支持理想外观，则回退到 CSS 分层背景和普通标题栏，不阻断功能。

### 2. 保持现有信息架构，只重塑视觉层级

现有三栏工作区结构是合理的，不应在第一阶段重新设计。

规则：

- Workspace Mode 保持左：文件树/搜索，中：标签与编辑器，右：Outline / LLM Wiki / Memory。
- Document Mode 保持主编辑区 + 大纲。
- LLM Wiki / Memory 面板只做视觉语气统一，不改交互模型和状态逻辑。

新行为：

- 面板 header、tabs、surface、empty state、状态块、日志块统一成 macOS 工具面板语气。

不变行为：

- 文件树操作、恢复 banner、冲突 banner、右侧 tab 逻辑、编辑器切换逻辑都保持原语义。

### 3. 用系统字体、版心和块级节奏提升阅读体验

第一阶段的“阅读体验基线”是正文排版风格，不是排版引擎。

规则：

- UI 字体采用 macOS 系统 UI 栈。
- 正文编辑使用系统正文风格，优化中英混排下的行高、字重感受和段落节奏。
- 默认正文版心限制在舒适写作范围。
- 代码块、引用、表格、图片、Mermaid、数学块等保留现有功能，但统一视觉层次。

例子：

- 普通正文在宽屏下不再无限铺开，而是居中在固定最大宽度内。
- 宽表格、代码块、Mermaid 保持可滚动，不因版心限制而被裁切。

边界：

- 不承诺中英文最佳断行算法。
- 不承诺公式视觉接近 TeX。

### 4. 主题与材质采用克制的渐进增强

用户希望 macOS 原生质感，但仓库产品约束又明确反对 heavy glass panels 和装饰性视觉。我们采用折中方式：

- 窗口壳层、toolbar、sidebar 可使用轻量 material 或接近原生的分层色。
- 中央编辑区保持稳定实色背景。
- light / dark / system 三套体验都应成立，默认跟随系统。
- 动效仅限必要 hover/focus/active/toggle 微交互。

### 5. 菜单和快捷键只做轻量统一

现有 Rust 菜单层已经有 Workspace-only item 的启停逻辑 [src-tauri/src/lib.rs](/Users/zhangyukun/project/mdx/src-tauri/src/lib.rs:758)。第一阶段不改命令系统结构，只统一：

- 文案语气
- macOS 预期快捷键和禁用态
- Workspace / Document 窗口角色下的菜单一致性

### 6. 明确把高阶排版引擎留到第二阶段

本提案把“TeX-like typography”降为未来方向约束，而不是本期实现。

规则：

- 第一阶段文档和代码结构应避免把正文样式写死到无法扩展。
- 第二阶段更可能以阅读预览、只读 preview 或独立排版 surface 切入，而不是直接替换主编辑器布局。

## Support Lens Checks / 专项设计检查

| Support lens | Trigger | Design checks applied | Result |
|---|---|---|---|
| `architecture-designer` | 需求涉及 Tauri 窗口边界、跨模式 UI shell、一致性与渐进增强策略 | 检查系统边界、平台隔离、失败回退、NFR、长期演进方向 | 结论是采用 macOS-first + platform-isolated helper + visual baseline，不在第一阶段变更编辑器内核 |

## Boundary Scenarios / 边界场景

- macOS 支持 ideal titlebar style：
  - 现在处理。启用原生外观增强。
- macOS 不支持某项 titlebar/material 能力：
  - 现在处理。回退为普通窗口 + CSS 分层背景。
- 非 macOS 平台运行：
  - 视为 unchanged behavior。功能可用，不追求原生感。
- Workspace / Document / Error window 外观不一致：
  - 现在处理。统一窗口 appearance helper。
- 宽内容超出版心：
  - 现在处理。保留滚动或宽块容器，不压扁内容。
- 右侧面板视觉与主壳层不一致：
  - 现在处理。纳入统一 token 和 surface 体系。
- 用户期待 TeX 级排版：
  - 现在拒绝。明确为第二阶段方向。
- 菜单改造影响现有命令路由：
  - 不现在处理。只做轻量统一，不重构命令系统。
- Markdown round-trip、fallback、mermaid、draft recovery 等行为变化：
  - 视为必须保持不变。
- 不同模式下深浅色观感割裂：
  - 现在处理。建立统一主题 token。

不涉及：

- 权限与租户边界：本地桌面应用，无多租户服务边界。
- 数据迁移与 schema 回填：本期不改持久化结构。

## Rationale / 理由与取舍

这个方向最适合当前约束，因为它把“应用像什么”与“编辑器如何排版”拆开。用户要的是 macOS 应用定位，这个目标首先应在窗口壳层、工具栏、侧栏、surface 和正文留白上成立。先把这些做对，既能快速提升产品观感，又不会破坏已经稳定的 Markdown 编辑器内核合同。

| Alternative | Why Not |
|---|---|
| 直接做 Knuth–Plass + OpenType MATH | 复杂度跨越 UI shell、编辑器布局、光标映射、性能和验证，超出第一阶段风险承受范围 |
| 只改前端 CSS，不改窗口壳层 | 无法形成足够强的 macOS 原生感，顶部区域仍会暴露跨平台 Web 工具气质 |
| 同时重做信息架构 | 会把视觉基线任务变成产品工作流重构，验证面过大 |
| 做强品牌写作应用风格（Bear/Craft） | 不匹配 MDX 作为本地文件工作区和桌面工具的产品定位 |

## Compatibility / 兼容性

这是一个兼容性优先、行为保持不变的加性改造。

- 对现有用户：
  - 工作流、文件系统操作、Markdown 保存与恢复语义保持不变。
- 对现有数据：
  - 不改持久化 schema、Markdown 格式、CLI 协议、Memory / LLM Wiki 数据。
- 对平台：
  - macOS 增强是加性的；非 macOS 保持可用。
- 对编辑器：
  - 不改 Markdown 真相模型，不改 fallback、parser/serializer 或 DOM contract。

因此本提案不是 breaking change。

## Operational And Security Impact / 运行与安全影响

- 运行影响：
  - 主要在前端样式、Tauri 窗口属性和 macOS 渐进增强路径。
- 安全影响：
  - 不新增权限边界，不新增网络或文件写入能力。
- 可运维性：
  - 需要在 macOS 下增加窗口外观回退验证，避免系统差异导致不可拖拽、控件遮挡或无法点击。

## Implementation And Transition / 实现与过渡

高层落地顺序应为：

1. 先建立 macOS-first 主题 token 和窗口 appearance helper。
2. 再重塑 Workspace / Document shell 和共享控件。
3. 最后收敛编辑区版心与内容块视觉层级。

这不是实现计划，而是风险控制顺序：先定壳层和 token，再改 surface，最后调正文，不然容易反复返工。

## Open Questions / 待决问题

无。

## Detailed Design Handoff / 详细设计交接

应立即写详细设计文档。以下决策视为固定约束：

- 第一阶段不做排版引擎。
- 第一阶段覆盖 Workspace Mode 与 Document Mode。
- 第一阶段允许修改 Tauri / Rust 窗口代码，但必须平台隔离。
- 维持现有信息架构与 Markdown 真相模型不变。
- macOS-first，非 macOS 保持可用。
- 验收必须覆盖深浅色、两种窗口模式和典型 Markdown 内容。

## Appendix / 附录

### 关键仓库证据

- [PRODUCT.md](/Users/zhangyukun/project/mdx/PRODUCT.md:1)
- [docs/loopx/specs/editor.md](/Users/zhangyukun/project/mdx/docs/loopx/specs/editor.md:1)
- [src-tauri/tauri.conf.json](/Users/zhangyukun/project/mdx/src-tauri/tauri.conf.json:1)
- [src-tauri/src/lib.rs](/Users/zhangyukun/project/mdx/src-tauri/src/lib.rs:497)
- [features/workspace/components/workspace-shell.tsx](/Users/zhangyukun/project/mdx/features/workspace/components/workspace-shell.tsx:1958)
- [features/document/components/document-shell.tsx](/Users/zhangyukun/project/mdx/features/document/components/document-shell.tsx:1061)
- [features/workspace/components/tab-strip.tsx](/Users/zhangyukun/project/mdx/features/workspace/components/tab-strip.tsx:1)
