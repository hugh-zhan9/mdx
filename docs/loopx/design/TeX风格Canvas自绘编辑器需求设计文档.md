# TeX风格Canvas自绘编辑器设计文档

> 关联设计提案：`docs/loopx/design/TeX风格Canvas自绘编辑器设计提案.md`

## 一、修订历史

| 版本号 | 修订内容 | 修订时间 | 修订人 |
|---|---|---|---|
| V1.0.0 | 新建初稿，基于 clarify 结果形成 TeX 风格 Canvas 自绘编辑器详细设计 | 2026-06-24 | Codex |
| V1.1.0 | 重审三条高风险决策：渲染后端从纯 Canvas 改为混合 DOM text runs + Canvas/SVG；旧 view 从直接删除改为保留为测试对照；布局核心里热路径从全 native+IPC 改为编 WASM 在 webview 内运行 + native 字体资产。全文同步修订。 | 2026-06-24 | Claude |

## 二、需求信息

### 2.1 需求背景

- 背景：
  - 当前编辑器仍以 ProseMirror DOM view 为可见编辑表面，数学节点使用 KaTeX HTML 渲染。
  - 仓库长期规则要求 Markdown 为唯一文档真相，unsupported Markdown 必须保真，工作区恢复/冲突检测/保存协议已围绕此建立。
  - 用户当前要求整编辑器迁移到混合 DOM text runs + Canvas/SVG 渲染、Rust 排版核心（WASM 热路径 + native 字体资产）、Knuth-Plass、OpenType MATH，并将 PDF/打印一并纳入首版。
- 需求目的：
  - 获得更接近 TeX 的中英混排质量与数学呈现质量。
  - 让屏幕编辑与 PDF/打印共享同一排版引擎。
  - 保持 Markdown-native 和本地优先编辑模型不变。
- 目标用户/使用方：
  - MDX 桌面应用用户本人。
  - Workspace Mode / Document Mode。
  - `mdx-cli` 与本地 Agent 自动化。
- 需求链接：
  - `.loopx/intake/clarify-tex-like-canvas-editor-20260624172256.md`
- 关联原始材料：
  - `docs/loopx/design/TeX风格Canvas自绘编辑器设计提案.md`
  - `docs/loopx/specs/editor.md`
  - `docs/loopx/specs/testing.md`
  - `.loopx/memory/MEMORY.md`
  - `features/editor/components/editor-pane.tsx`
  - `features/workspace/components/editor-stage.tsx`
  - `packages/mdx-editor/react/mdx-editor-provider.tsx`
  - `packages/mdx-editor/react/mdx-editor-view.tsx`
  - `packages/mdx-editor/react/math-node-view.tsx`

### 2.2 需求范围

- 本期范围：
  - 将当前 ProseMirror DOM 可见编辑器替换为混合渲染表面：正文使用排版引擎计算位置的绝对定位 DOM text runs（非浏览器 CSS 断行），公式/表格网格/代码高亮/图片装饰使用 Canvas/SVG。
  - 保留 ProseMirror 作为文档模型、事务、history、schema、parser/serializer/clipboard 语义层。
  - 新增 Rust 排版核心，负责字体、排版、数学布局、分页和 PDF 输出；热路径（断行/box/math/hit-test/位置映射/选区几何）编 WASM 在 webview 内运行，字体重资产（系统字体发现/OpenType 解析/glyph metric）留 Rust native 一次性取回并缓存。
  - 新增轻量 DOM semantic mirror，仅补齐 Canvas/SVG 块的 ARIA、find/range 协调与可访问性。正文段落的 a11y/find/粘贴/IME 直接复用 DOM 文本层原生能力。
  - 支持复杂块：段落、标题、列表、表格、代码块、图片、Mermaid、HTML fallback、math、unsupported source fallback。
  - 首版验收平台为 macOS Tauri。
  - 首版纳入打印/PDF 输出，要求真实文本和矢量优先。
- 非目标：
  - 不保留旧 DOM 编辑器产品回退路径（代码保留为测试对照，验收后再删）。
  - 不实现完整 TeX / 完整 LaTeX 宏系统。
  - 不支持多光标。
  - 不把文档主存储改为数据库或私有格式。
  - 不承诺复杂脚本首版达到 TeX-like 质量。
  - 不实现高级出版能力，如双栏、复杂浮动、复杂脚注跨页。
  - 不做纯 Canvas 唯一可见表面。
  - 布局核心不全部放 Rust native 逐帧跨 IPC。
- 决策边界：
  - 必须固定：混合 DOM text runs + Canvas/SVG 可见表面、Rust 排版核心（WASM 热路径 + native 字体）、ProseMirror 状态层、Markdown 真相、轻量 DOM mirror（仅 Canvas 块）、PDF 首版范围、旧 view 保留为测试对照。
  - 可由 plan 决定：crate/file 划分、WASM 序列化协议、DOM/Canvas 分层合成方案、模块命名、fixture 编排、具体缓存结构、测试命名、调试 overlay 组织。
  - 必须返回 spec：改变输出质量边界、恢复旧编辑器产品入口、放弃混合可见表面改回纯 Canvas、放弃 PDF 首版、改变平台目标。
- 依赖方：
  - `packages/mdx-editor` parser/schema/serializer/selection/clipboard。
  - `features/editor`、`features/workspace`、`features/document`。
  - Tauri/Rust native。
  - 系统字体、macOS IME、屏幕阅读器能力。
- 约束条件：
  - Markdown 文件仍是唯一持久化真相。
  - unsupported Markdown fallback 必须保真。
  - 草稿恢复、冲突检测、workspace/document 保存流程不能退化。
  - 120fps 滚动是硬目标。
  - 最终断行目标为 Knuth-Plass，全局最优；逐行贪心只作为过渡 fallback。
  - 依赖面要极小、接口隔离、优先纯 Rust。
  - 渲染后端为混合：正文 DOM text runs（位置由引擎决定）+ 公式/复杂块 Canvas/SVG，不做纯 Canvas。
  - 排版核心热路径编 WASM 在 webview 内运行；字体重资产留 native，避免逐帧 IPC。
  - 旧 view 代码保留为回归对照与测试夹具，验收后再删除。
  - 现有无关修改不得被本方案覆盖。
- 触发的辅助 skills：architecture-designer

### 2.3 可行性分析

- 业务可行性：
  - 用户明确接受一次激进迁移，并接受无用户级回退。
  - 项目是本地优先单用户产品，允许为长期体验做较大架构升级。
- 技术可行性：
  - 现有仓库已具备 Markdown parser/serializer/ProseMirror 状态层，可作为稳定内核继续复用。
  - Tauri + Rust + WASM 允许热路径布局在 webview 内运行、字体重资产走 native，兼顾性能与浏览器能力。
  - 混合 DOM text runs + Canvas/SVG 让 a11y/find/粘贴/IME 大部分回到原生路径，工程复杂度显著低于纯 Canvas + 完整 DOM mirror。
  - 保留旧 view 作为测试对照可降低迁移回归风险。
- 团队接受能力：
  - 研发复杂度极高，但设计边界清晰；需依赖强测试和分层模块化。
- 时间成本：
  - 很高。排版、命中、IME、语义 mirror、分页/PDF、复杂块都属于高复杂度领域。
- 资源成本：
  - 新增 Rust crates、缓存、golden fixtures、截图基准和 interaction test 成本。
- 替代方案：
  - 维持 DOM visible editor：不满足 TeX-like 控制目标。
  - 纯 Canvas 唯一可见表面：a11y/find/IME 成本高昂，重审时被否决。
  - 只做只读预览：不满足用户目标。
  - 完全替换 ProseMirror：重写范围过大。
  - 全部 layout 在 Rust native + 逐帧 IPC：无法满足 120fps，重审时改为 WASM 热路径。
  - 用完整 TeX 引擎：依赖面过重，不符合约束。
- 关键风险：
  - 无产品级回退路径下的质量风险（但保留旧 view 测试对照可部分缓解）。
  - DOM text run + Canvas/SVG 混合层的合成与 z-order 协调。
  - WASM layout core 与前端之间的序列化性能需要压测验证。
  - IME 在 DOM 文本层和 Canvas 公式选区之间的跨层命中协调。
  - 120fps 与全局断行、复杂块、PDF 共享引擎同时成立的性能风险。

## 三、概要设计

### 3.1 方案总述

- 设计目标：
  - 用 Rust 排版核心 + WASM 热路径 + 混合 DOM/Canvas 渲染构建统一的 Markdown 编辑/排版/导出引擎。
  - 提升中英混排和数学排版质量。
  - 保持 Markdown-native、fallback 保真和现有保存恢复语义。
- 总体思路：
  - 在 `packages/mdx-editor` 之上引入 layout bridge 和混合 view editor shell。
  - Rust 排版核心（WASM 在 webview 内运行）根据 ProseMirror doc / normalized layout IR 计算 line boxes、glyph runs、hit-test map、caret anchors。
  - 正文以绝对定位 DOM text runs 渲染（位置由 engine 算出的 line box geometry 决定），公式/复杂块以 Canvas/SVG 覆盖在 DOM 层上。
  - DOM/Canvas 的事件与 position 通过 mapping 层映射回 ProseMirror transaction。
  - 轻量 DOM semantic mirror 仅补齐 Canvas 块的 ARIA 与 find/range 协调；正文 a11y/find 直接走 DOM 文本层原生。
  - PDF/打印共享 Rust native 分页和绘制协议。
- 核心模块：
  - WASM paragraph layout（热路径）
  - WASM math layout（热路径）
  - WASM hit-test / position mapping（热路径）
  - WASM selection geometry / caret anchors（热路径）
  - Native font subsystem（字体发现/OpenType 解析/glyph metric 缓存）
  - Native pagination / PDF export
  - DOM text run renderer（引擎定位）
  - Canvas/SVG renderer（公式/复杂块）
  - 轻量 DOM semantic mirror（仅 Canvas 块 ARIA/find 协调）
  - Clipboard / find / accessibility bridge（正文走 DOM 原生）
  - Complex block adapters
- 主要难点：
  - viewport 增量布局与 120fps。
  - Knuth-Plass 与 CJK/Latin break model。
  - OpenType MATH 数学布局。
  - WASM layout 与前端之间的序列化/反序列化性能。
  - DOM 文本层与 Canvas 层的合成、z-order 与命中协调。
  - IME 在 DOM 文本层和 Canvas 公式选区之间的跨层命中。
- 技术指标：
  - 滚动目标 120fps。
  - 普通输入到可见更新目标 < 50ms。
  - 首屏可交互目标 < 500ms，允许后台补全布局。
  - PDF 输出文本可选、公式矢量优先。

### 3.2 整体架构设计

- 业务模式：
  - 本地优先 Markdown 编辑器，混合 DOM text runs + Canvas/SVG 为可见表面，Markdown 为唯一持久化真相。
- 系统边界：
  - `packages/mdx-editor`：继续负责 Markdown parser、schema、serializer、selection snapshot、clipboard 语义。
  - `packages/mdx-editor-view` 或等效前端模块：负责混合 view shell（DOM text run 渲染 + Canvas/SVG 层）、事件桥接。
  - `src-tauri` 新布局模块：负责 Rust 排版核心编译为 WASM（webview 内运行热路径）和 native（字体/分页/PDF）两目标。
  - `features/editor` / `features/workspace` / `features/document`：负责应用接入。
- 上下游系统：
  - 上游：Markdown 文件内容、用户输入事件、IME、clipboard、screen reader、browser find。
  - 下游：workspace/document save、draft recovery、conflict detection、PDF 文件输出、CLI/Agent selection 与插入。
- 应用架构：
  - `EditorStage` 对 Markdown tab 不再挂载旧 `EditorPane` DOM editor，而是挂载新混合 editor host。
  - Host 内部管理 ProseMirror state、layout subscription、DOM text run 层、Canvas/SVG 层、命中和 selection bridge。
  - Rust WASM 模块以内联资源或 worker 形式在 webview 内运行，通过平坦消息协议与前端交换 layout 结果；字体资产通过 Tauri command 从 native 侧一次性获取后缓存。
- 技术架构：
  - `Markdown -> ProseMirror doc -> normalized layout IR -> WASM layout core -> line boxes + glyph runs + draw list + hit-test map + caret anchors`
  - `DOM text run 层: line box geometry -> 绝对定位 DOM text runs（正文/列表/标题/表格文本）`
  - `Canvas/SVG 层: draw list -> Canvas/SVG 绘制（公式/表格网格/代码高亮/图片/Mermaid/装饰）`
  - `轻量 mirror: Canvas 块的 ARIA + 可搜索文本 + find range 协调`
  - `Pointer/keyboard/IME/find/clipboard event -> mapping layer -> ProseMirror transaction -> WASM incremental relayout`
  - `layout data -> native pagination -> PDF writer / print pipeline`
- 数据流转：
  - 打开文件：读 Markdown -> parse -> ProseMirror doc -> normalize IR -> WASM 首屏布局 -> 放置 DOM text runs + Canvas/SVG 绘制。
  - 编辑：transaction -> invalidate affected blocks -> WASM 增量布局 -> patch DOM text run 位置 + Canvas/SVG 增量绘制。
  - 查找：正文直接命中 DOM 文本层；Canvas 块由轻量 mirror 补位 -> range map -> Canvas selection/highlight。
  - 粘贴：HTML/plain text 走 DOM 原生 clip 入口 -> parse/sanitize -> transaction。
  - 导出：文档 IR -> native pagination -> PDF。

### 3.3 核心流程设计

| 流程 | 触发条件 | 参与系统/模块 | 主流程 | 异常/补偿 | 输出 |
|---|---|---|---|---|---|
| 打开 Markdown 文档 | 用户打开 tab / document | EditorStage、ProseMirror、WASM layout bridge、native font | 读取 Markdown，parse 成 doc，WASM 首屏布局，放置 DOM text runs 和 Canvas/SVG 层 | 布局失败时显示诊断层，但仍保留文档和源码真相 | 可编辑画面 |
| 普通编辑输入 | 键盘输入、删除、换行 | Editor host、mapping layer、ProseMirror、WASM layout | 事件映射到 selection/transaction，WASM 增量重排受影响 block，重新定位 DOM text runs、patch Canvas/SVG 块 | 长段/复杂公式可临时 fallback 到贪心或旧 snapshot | 新布局 |
| 中文 IME 输入 | composition start/update/end | DOM text run 层原生 IME、mapping layer、ProseMirror、WASM layout | 组合输入在 DOM 文本层原生完成，结束后触发布局重排 | composition 异常时保持文本不丢失并重建 selection | 正确文本与光标 |
| 浏览器查找 | 用户触发浏览器 find | DOM 文本层原生 find；轻量 mirror 补齐 Canvas 块 | 正文段落直接由 DOM find 命中；Canvas 块由 mirror 文本补范围映射 | 映射失败时保留文本命中但报告诊断 | 高亮与定位 |
| HTML 富文本粘贴 | paste 事件 | DOM 原生 clip 入口、sanitizer、parser、ProseMirror | 读取 HTML/plain text，sanitize，映射成 Markdown-safe 节点和 transaction | 不支持结构 fallback 为源码/纯文本 | 文档变更 |
| PDF 导出/打印 | 用户触发导出 | Native pagination、PDF writer、font subsystem | 共享排版数据分页，输出真实文本和矢量元素 | 缺字体或复杂块降级时给出明确诊断 | PDF/打印结果 |

### 3.4 功能模块

| 模块 | 职责 | 关键功能 | 依赖 | 备注 |
|---|---|---|---|---|
| Layout IR Normalizer | 将 ProseMirror doc 转成稳定布局输入 | block/inline 抽象、语义分段、source mapping | `packages/mdx-editor` | 断开布局层与编辑层耦合 |
| WASM Layout Core | 布局热路径，在 webview 内运行 | Knuth-Plass 断行、box/glue/penalty、math box tree、hit-test、position mapping、selection geometry、caret anchors | Rust core → WASM | 避免逐帧 IPC |
| Native Font Subsystem | 字体重资产，native 侧 | 系统字体发现、fallback chain、OpenType MATH 常量缓存、glyph metric 缓存 | Rust crates | 极小依赖面，一次性取回 |
| Native Pagination / PDF | 分页和导出（native） | page model、text embedding、vector drawing | layout core | 屏幕与导出一致 |
| DOM Text Run Layer | 引擎定位的可见文本层 | 绝对定位 DOM text runs(line box geometry→DOM), inline style 应用 | WASM layout snapshot | 正文/标题/列表/表格文本 |
| Canvas/SVG Layer | 复杂块可见绘制 | 公式/表格网格/代码高亮/图片/Mermaid 绘制；selection/caret 高亮 | WASM + layout snapshot | 覆盖在 DOM 文本层之上 |
| Hit-Test Mapper | 命中与几何 | point→position、position→rects、line navigation | WASM geometry anchors | 编辑体验核心 |
| 轻量 DOM Semantic Mirror | Canvas 块语义桥接 | Canvas 块的 ARIA、可搜索文本、find/range 协调 | mapping layer | 仅补齐 Canvas 块，正文走 DOM 原生 |
| Complex Block Adapters | 复杂块布局协议 | table/code/image/mermaid/html/fallback | layout core + frontend | 减少 block 特判 |

### 3.5 新增/调整功能说明

- 删除当前 `packages/mdx-editor/react/mdx-editor-view.tsx` 暴露的 DOM visible editor 路径（产品入口），保留代码作为回归对照。
- 新增混合 editor host 组件（DOM text run 层 + Canvas/SVG 层），替代当前 `EditorPane` 主体视图。
- 新增 WASM layout bridge 协议（布局热路径在 webview 内运行，不跨 IPC）：
  - `layout_initialize_document`
  - `layout_update_document`
  - `layout_get_viewport_snapshot`
  - `layout_hit_test`
  - `layout_get_selection_geometry`
- 新增字体资产 Tauri command（一次性取回，前端缓存）：
  - `font_init_subsystem`
  - `font_get_glyph_metrics`
  - `font_get_math_constants`
- 新增 native PDF export Tauri command：
  - `layout_export_pdf`
- 新增轻量 mirror contract（仅 Canvas 块）：
  - block range ids
  - ARIA structure
  - DOM range -> ProseMirror position mapping
- 调整 `visible-text-search`、find/replace、Mermaid layer、selection scope、outline scroll 等依赖 DOM 结构的集成逻辑。

### 3.6 专项设计检查

| 辅助 skill | 触发原因 | 检查内容 | 设计结论 |
|---|---|---|---|
| architecture-designer | 该需求涉及长期系统边界、NFR、WASM+native 协作、混合 DOM/Canvas 渲染、无产品回退迁移 | 系统边界、失败模式、性能、兼容性、可运维性 | 采用 ProseMirror 状态层 + WASM layout core + native 字体资产 + DOM text runs(CSS free) + Canvas/SVG 公式/复杂块 + 轻量 mirror 的分层方案 |

## 四、详细设计

### 4.1 文档标准化与布局输入详细设计

#### 4.1.1 需求内容

- 入口：ProseMirror doc 变更后触发布局更新。
- 操作人/调用方：Canvas editor host、Rust layout bridge。
- 前置条件：`packages/mdx-editor` 已生成稳定 doc 和 selection。
- 输出结果：稳定的布局输入 IR 和 source/position 映射。

#### 4.1.2 方案设计

- 核心逻辑：
  - 引入 normalized layout IR，显式表达段落、内联文本 run、公式 token、图片、表格、代码块和 fallback block。
  - 每个 IR 节点带：
    - `nodeId`
    - `pmFrom` / `pmTo`
    - `blockKind` / `inlineKind`
    - style token
    - source metadata
    - export / mirror hints
  - IR 生成阶段不做最终排版，只做语义标准化。
- 状态流转：
  - ProseMirror transaction -> affected PM node ranges -> affected IR blocks -> 布局引擎 invalidation set。
- 数据变更：
  - 仅内存快照，不落盘。
- 计算公式：
  - 不涉及具体几何计算，只做数学语义切分。
- 幂等设计：
  - 同一 doc 和 style context 产生稳定 IR。
- 权限/越权控制：
  - 不涉及。
- 异常处理：
  - 语义不支持的结构走 fallback IR block。
- 补偿/重试：
  - IR 生成失败时保留上次稳定 snapshot，并报告诊断。
- 日志与审计：
  - 开发态输出 block invalidation、IR diff 统计，不打印完整正文。

#### 4.1.3 流程步骤

1. 读取 ProseMirror doc 和 theme/style context。
2. 按 block 遍历生成 layout IR。
3. 为每个 block 记录 PM range、semantic mirror hints、export hints。
4. 生成 invalidation set。
5. 发送到 Rust layout engine。

#### 4.1.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| unsupported Markdown | 生成 fallback block，保留源码编辑入口 | 用户看到源码 fallback | block fallback 指标 |
| 巨型表格或巨型代码块 | 分块 IR，按 viewport 渲染 | 滚动可用，可能延迟细节 | block layout 耗时 |
| PM node 到 IR 失败 | 保留旧 snapshot，显示诊断 | 临时显示旧布局 | layout normalize error |

#### 4.1.5 不变行为

| 行为/表面 | 保持不变的原因 | 验证方式 |
|---|---|---|
| Markdown 保存语义 | Markdown 是唯一文档真相 | roundtrip fixtures |
| unsupported fallback 保真 | 长期编辑器规则 | serializer fixtures |

### 4.2 Rust 字体与正文排版详细设计

#### 4.2.1 需求内容

- 入口：layout IR 中的文本 block / inline runs。
- 操作人/调用方：Rust layout engine。
- 前置条件：已拿到字体配置、viewport/paper constraints 和 style tokens。
- 输出结果：line boxes、glyph runs、break decisions、caret anchors。

#### 4.2.2 方案设计

- 核心逻辑：
  - 字体子系统负责系统字体发现、fallback chain、font metrics 和 glyph cache。
  - 文本 shaping 与 metrics 输出统一 run abstraction。
  - CJK/Latin break model 为每个可断点分配 penalty、glue、stretch/shrink。
  - 首版允许贪心断行 fallback，但最终质量基线以 Knuth-Plass 结果为准。
  - 生成 caret positions、word boundaries、selection geometry anchors，供前端命中和键盘导航复用。
- 状态流转：
  - text runs -> shaped runs -> paragraph candidate breaks -> chosen lines -> viewport lines。
- 数据变更：
  - 缓存为可重建数据，不写文档。
- 计算公式：
  - `paragraph_badness`、`demerit` 等算法细节在实现中固定，设计层不写公式常数。
- 幂等设计：
  - 同文档、同样式、同宽度下输出稳定断行结果。
- 权限/越权控制：
  - 不涉及。
- 异常处理：
  - 字体缺失时走 fallback；break model 异常时退到贪心。
- 补偿/重试：
  - viewport 宽度变化或字体切换时重排。
- 日志与审计：
  - 记录 paragraph layout time、fallback count、greedy fallback count、glyph cache hit rate。

#### 4.2.3 流程步骤

1. 收到文本 block IR。
2. 按 style 和字体 fallback 做 shaping。
3. 生成 break opportunities 和 penalties。
4. 运行 Knuth-Plass 或 fallback 贪心。
5. 输出 line boxes、glyph runs、geometry anchors。

#### 4.2.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 缺字 | fallback 字体补位 | 文字继续显示 | missing glyph metric |
| 复杂脚本 shaping 质量不足 | 保证可显示，不承诺 TeX-like 质量 | 质量可能一般，但不丢内容 | script fallback metric |
| 超长 URL / 长 token | 应用降级断点策略 | 可断行但质量较弱 | token overflow metric |
| Knuth-Plass 超时 | 回落到贪心并标记 paragraph | 可继续编辑 | greedy fallback counter |

#### 4.2.5 不变行为

| 行为/表面 | 保持不变的原因 | 验证方式 |
|---|---|---|
| 普通英文/中文输入输出文本内容 | 排版不能改写正文 | text fixture + manual IME |
| 保存时字符内容不被重新编码 | Markdown 文件格式兼容 | save/reopen tests |

### 4.3 OpenType MATH 数学排版详细设计

#### 4.3.1 需求内容

- 入口：行内和块级数学 IR。
- 操作人/调用方：Rust math layout subsystem。
- 前置条件：公式已从 Markdown/ProseMirror 语义化，拿到字体和 display context。
- 输出结果：math box tree、baseline、paint ops、selection anchors、export geometry。

#### 4.3.2 方案设计

- 核心逻辑：
  - 从目标数学字体读取 OpenType MATH 常量和 glyph assembly 信息。
  - 数学 parser 首版只需覆盖约定的核心语法域，而不是完整 LaTeX 宏系统。
  - 构建 math box tree：ord、op、bin、rel、open、close、punct、inner、fraction、radical、scripts、matrix 等。
  - 依据 MATH 常量计算 baseline shift、script placement、fraction gap、radical clearance、delimiter extension。
  - 输出可被 Canvas 和 PDF 共享的向量/字形绘制命令。
- 状态流转：
  - latex string -> math AST -> math box tree -> resolved geometry -> draw ops。
- 数据变更：
  - 不落盘。
- 幂等设计：
  - 同 LaTeX、同字体、同 display mode 结果稳定。
- 权限/越权控制：
  - 不涉及。
- 异常处理：
  - 不支持语法可回落为错误 box 或源码 fallback，不阻断整篇文档。
- 补偿/重试：
  - 字体变更、字号变更、display mode 变更时重排。
- 日志与审计：
  - 记录公式解析失败、MATH fallback、unsupported syntax counters。

#### 4.3.3 流程步骤

1. 读取 LaTeX 字符串。
2. 解析为受支持的 math AST。
3. 读取 MATH 常量和 glyph assembly。
4. 构建并求解 math box tree。
5. 输出 Canvas/PDF 共用 draw ops 和 hit anchors。

#### 4.3.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| unsupported 宏或环境 | 错误 box 或源码 fallback | 公式局部降级，不影响全文 | unsupported math syntax |
| MATH 表缺失 | 回退字体或保守布局 | 质量下降但可显示 | math font fallback |
| 超复杂矩阵 | 可分步布局，必要时延后重排 | 可能略有延迟 | math layout time |

#### 4.3.5 不变行为

| 行为/表面 | 保持不变的原因 | 验证方式 |
|---|---|---|
| Markdown 中 LaTeX 源字符串保存方式 | 不能引入私有格式 | roundtrip fixtures |
| 行内/块级数学语义边界 | 现有 parser/serializer 需要延续 | parser/serializer tests |

### 4.4 混合渲染层详细设计

#### 4.4.1 需求内容

- 入口：WASM layout snapshot、用户 pointer/keyboard/scroll 事件。
- 操作人/调用方：Editor host。
- 前置条件：WASM 布局快照（line box geometry、glyph runs、hit-test anchors、selection anchors、Canvas draw ops）可用。
- 输出结果：可见编辑画面、selection/caret、hit-test 结果、scroll 定位。

#### 4.4.2 方案设计

- 核心逻辑：
  - **DOM text run 层**：正文/标题/列表/表格单元格文本以绝对定位的 DOM text runs 渲染，每个 run 的位置（left、top、width、height）映射自 WASM 产出的 line box geometry。浏览器不参与断行或间距决策，严格服从排版引擎计算结果。IME 和选区渲染通过 DOM range 映射复用原生浏览器能力。
  - **Canvas/SVG 层**：公式、表格网格、代码语法高亮、图片装饰、Mermaid 使用 Canvas 或 SVG 绘制，覆盖在 DOM 文本层之上，通过 z-index / clip / pointer-events 策略协调命中。
  - **Selection/caret 绘制**：正文选区利用原生 DOM 高亮；Canvas 块的选区由 geometry anchors 在 Canvas 层绘制自定义高亮。
  - **Canvas 块内命中**：Canvas 几何锚点与 DOM 文本层的 hit-test 自动分开；跨层命中（如从公式到两侧文本）由 WASM hit-test 统一汇总。
  - 仅渲染 viewport + buffer，不对全篇逐帧重绘。
  - 键盘上下移动复用 WASM 产出的 line box / caret anchors。
- 状态流转：
  - layout snapshot -> 更新 DOM text run 位置 + Canvas/SVG draw ops -> frame draw。
- 数据变更：
  - draw cache 和 atlas 可重建。
- 幂等设计：
  - 相同 snapshot 生成稳定绘制结果。
- 权限/越权控制：
  - 不涉及。
- 异常处理：
  - snapshot 缺失时保留上一帧并显示加载/诊断层。
- 补偿/重试：
  - scroll/resize/invalidate 后重绘。
- 日志与审计：
  - 记录 frame time、redraw region、snapshot age、hit-test failures。

#### 4.4.3 流程步骤

1. 获取 viewport snapshot（WASM）。
2. 根据 invalidation region 更新 DOM text run 的位置和 Canvas/SVG 内容。
3. 定位 DOM text runs（绝对定位），绘制 Canvas/SVG 复杂块。
4. 绘制 selection/caret（正文走原生 DOM、Canvas 块走 Canvas 绘制）。
5. 响应 pointer/keyboard 事件并回映射到 PM positions。

#### 4.4.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 快速滚动 | 先保留已有 DOM text runs 位置，后台补齐新的 | 视觉平滑 | dropped frame metric |
| DPI/缩放变化 | 失效 atlas 并重排 | 短暂重绘 | resize metric |
| 命中映射失败 | 保守定位到最近 anchor | 偶发定位误差 | hit-test error |
| DOM text run 与 Canvas 覆盖 | Canvas 层指针事件通过 pointer-events 策略传递到下方 DOM 文本或专门拾取 | 无感知 | 不涉及 |

#### 4.4.5 不变行为

| 行为/表面 | 保持不变的原因 | 验证方式 |
|---|---|---|
| 选择内容对应的 Markdown 语义范围 | CLI/用户选择行为不能漂移 | selection snapshot tests |
| 外部滚动定位标题/查找结果 | 工作区已有行为依赖 | integration tests |

### 4.5 轻量 DOM Semantic Mirror 详细设计

#### 4.5.1 需求内容

- 入口：Canvas/SVG 块（公式、表格网格、代码高亮、Mermaid、图片装饰等）的文档变更、find、剪辑板、screen reader 焦点移动。
- 操作人/调用方：Editor host、浏览器、屏幕阅读器。
- 前置条件：Canvas 块的 layout IR 和 PM range 可用。
- 输出结果：Canvas 块的隐藏 DOM 语义树、range 映射、find/accessibility 桥接。
- 设计原则：**正文段落不依赖 mirror**。正文的 a11y、find、粘贴、IME 直接复用 DOM text run 层的原生浏览器能力。Mirror 仅补齐 Canvas 块无法被浏览器原生识别的部分。

#### 4.5.2 方案设计

- 核心逻辑：
  - Mirror 以 Canvas 块的 block/inline 语义（而非视觉断行）为单位组织 DOM，只包含公式、表格、代码块、Mermaid、图片装饰等 Canvas 绘制块。
  - 为每块建立稳定 block id 和 PM range。
  - browser find 可以命中正文的 DOM text run 层原生；当 find 需要跨越 Canvas 块时，由 mirror 补充这些块的文本范围，最后通过 range id -> PM range -> Canvas geometry 完成 Canvas 块的高亮。
  - clipboard/paste：正文走 DOM 文本层原生剪切板；Canvas 块的复制粘贴由 mirror 补充文本表示。
  - screen reader 读取 DOM text run 层的原生语义结构 + mirror 的 Canvas 块 ARIA。
- 状态流转：
  - PM/IR change -> mirror patch (仅 affected Canvas blocks) -> range map refresh。
- 数据变更：
  - DOM mirror 为可重建派生层，只对 Canvas 块有效。
- 幂等设计：
  - 同文档语义应生成稳定 mirror block ids。
- 权限/越权控制：
  - 不涉及。
- 异常处理：
  - mirror patch 失败时 Canvas 块暂时丢失可访问性描述但保留视觉，不影响正文。
- 补偿/重试：
  - partial mirror rebuild（仅失效的 Canvas 块）。
- 日志与审计：
  - 记录 mirror rebuild time、Canvas block find bridge misses、screen reader coverage metric。

#### 4.5.3 流程步骤

1. 识别 layout IR 中的 Canvas-only blocks（公式、表格、代码高亮、Mermaid 装饰等）。
2. 为这些块生成或更新 mirror DOM node + ARIA。
3. 维护 Canvas block DOM range -> PM range -> Canvas geometry map。
4. 监听 find / paste / copy / accessibility focus 事件，仅影响 Canvas 块范围。
5. 将 Canvas 块的桥接事件回映射到 ProseMirror 和 Canvas 层。

#### 4.5.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 浏览器 find 跨越文本层→Canvas 块 | text run 层原生 find + mirror 补充 Canvas 块文本 | 用户体验连续 | Canvas find bridge metric |
| 屏幕阅读器读取数学公式 | 用语义标签（MathML/ARIA math）描述，而非视觉等价 | 可读但可能不完全等价视觉 | accessibility coverage metric |
| Canvas 块发生编辑变更 | patch 对应 mirror DOM 和 range map | 无感知 | mirror rebuild count |
| 大块公式或表格的完整 mirror 文本 | 按语义结构组织，不复制视觉布局细节 | 可搜索、可读即可 | 不涉及 |

#### 4.5.5 不变行为

| 行为/表面 | 保持不变的原因 | 验证方式 |
|---|---|---|
| 可搜索文本不包含 Mermaid 生成预览垃圾文本 | 现有 editor spec 已明确 | find tests |
| unsupported raw source 可被复制和阅读 | fallback 保真要求 | mirror/clipboard tests |
| 正文查找/朗读不经过 mirror | 正文直接使用 DOM 文本层原生能力 | a11y/find smoke tests |

### 4.6 复杂块与应用集成详细设计

#### 4.6.1 需求内容

- 入口：块级节点进入 viewport 或被编辑。
- 操作人/调用方：layout engine、Canvas host、features/editor integration。
- 前置条件：已有对应 PM node 和 normalized IR。
- 输出结果：可见 block、自定义编辑交互、导出表示和 mirror 语义。

#### 4.6.2 方案设计

- 核心逻辑：
  - 图片：Rust 提供 box 尺寸，前端加载和绘制 bitmap，PM 命令更新 alt/title/src。
  - 表格：layout engine 负责网格尺寸与单元格文本块布局，前端处理 cell 命中和基础行列操作。
  - 代码块：自绘等宽文本和高亮，保留源码编辑能力。
  - Mermaid：源码块保持 Markdown 真相，渲染产物作为嵌入图像或矢量块。
  - HTML：白名单内转 layout block，其他内容转 fallback。
  - unsupported fallback：以源码 block 呈现，可直接编辑原文。
- 状态流转：
  - block node edit -> IR invalidation -> localized relayout。
- 数据变更：
  - 保持在 Markdown 语义层。
- 幂等设计：
  - 相同 Markdown 结构输出稳定 block 表示。
- 权限/越权控制：
  - HTML、SVG、图片资源继续走既有安全边界和资源读取策略。
- 异常处理：
  - 渲染失败时回到源码 fallback。
- 补偿/重试：
  - 用户可继续编辑源码或重试渲染。
- 日志与审计：
  - 记录 block render failures、image load failures、Mermaid render failures。

#### 4.6.3 流程步骤

1. block IR 进入布局。
2. 生成 block geometry 和 draw instructions。
3. 前端绘制 block，并绑定命中/编辑 affordance。
4. block 变更后局部重排。

#### 4.6.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 图片加载失败 | 显示占位与错误态，不改 Markdown | 仍可编辑 | image load error |
| Mermaid 渲染失败 | 显示源码和错误态 | 不丢源码 | mermaid render error |
| HTML 不安全 | 进入 fallback | 用户看到源码 | html fallback counter |
| 大表格滚动 | viewport virtualize | 可用但可能局部延迟 | table layout time |

#### 4.6.5 不变行为

| 行为/表面 | 保持不变的原因 | 验证方式 |
|---|---|---|
| 图片资产保存到既有工作区路径 | 不能破坏现有资源引用 | image integration tests |
| Mermaid 源码仍保存在 Markdown fence 中 | 语义与现有文档兼容 | roundtrip fixtures |

## 五、存储类设计

### 5.1 库表设计

#### 5.1.1 数据库模型图

不涉及。该方案不新增持久化数据库模型。

#### 5.1.2 表结构

不涉及。文档真相仍为 Markdown 文件。

### 5.2 数据迁移/初始化

- DDL：不涉及。
- DML：不涉及。
- 数据回填：不涉及。
- 老数据兼容：
  - 现有 Markdown 文档必须直接兼容。
  - 现有 draft recovery、workspace state、selection snapshot 协议应继续可用或平滑迁移。
- 新老系统读写关系：
  - 无新旧双写；直接迁移到新编辑器实现。

### 5.3 缓存设计

| 场景 | Key | Value | 数据结构 | 过期时长 | 容量预估 | 失效/刷新策略 |
|---|---|---|---|---|---|---|
| 字体 glyph 缓存 | font id + glyph id + size | glyph metrics / outline handle | LRU / arena | 进程内 | 中高 | 字体变更、内存压力驱逐 |
| paragraph layout 缓存 | block id + width + style hash | line boxes / anchors | LRU | 进程内 | 中高 | block 内容或宽度变更失效 |
| viewport snapshot 缓存 | doc rev + viewport key | draw-ready snapshot | ring buffer | 短期 | 中 | scroll/resize/invalidate |
| PDF export cache | doc rev + export options | paginated layout | temporary | 导出生命周期 | 中 | 导出后释放 |

## 六、其他组件设计

### 6.1 消息设计

不涉及外部消息队列。

### 6.2 配置设计

| 配置项 | 环境 | 默认值 | 是否动态生效 | 说明 | 风险 |
|---|---|---|---|---|---|
| text_layout_mode | app runtime | `knuth-plass` | 是 | 允许内部调试切 greedy fallback，不暴露用户级开关 | 调试配置误入生产需谨慎 |
| semantic_mirror_debug | app runtime | `false` | 是 | 显示 mirror/range overlay 的开发开关 | 泄露调试层 |
| pdf_font_embed_mode | export runtime | `subset` | 否 | PDF 字体嵌入策略 | 文件体积与兼容性权衡 |

### 6.3 定时任务/批处理

不涉及。

### 6.4 技术组件

- 分布式锁：不涉及。
- 唯一 ID：layout block ids / run ids 由本地稳定生成策略提供。
- 加解密/验签：不涉及。
- 字典转换：style token / block kind enums。
- Excel/文件处理：PDF 文件输出。
- 用户信息透传：不涉及。
- 限流/熔断：布局与导出错误通过局部 fallback 和诊断处理。

## 七、接口设计

### 7.1 接口设计原则

- 前后端接口以稳定结构化数据为主，不传大段非结构化渲染命令字符串。
- 布局接口必须显式说明幂等性、增量更新边界和错误返回。
- 重要接口必须能报告性能指标和诊断摘要。
- 不允许接口把 Markdown 真相替换为私有序列化格式。

### 7.2 接口清单

| 接口 | 调用方 | 服务方 | 协议 | 是否跨 IPC | 幂等 | 文档地址 | 备注 |
|---|---|---|---|---|---|---|---|
| `layout_initialize_document` | 前端 Editor host | WASM layout core | 内存调用 | 否 | 是 | 本文档 | WASM 热路径，初始化文档上下文 |
| `layout_update_document` | 前端 Editor host | WASM layout core | 内存调用 | 否 | 是 | 本文档 | 增量重排与 invalidation |
| `layout_get_viewport_snapshot` | 前端 Editor host | WASM layout core | 内存调用 | 否 | 是 | 本文档 | 拉取 viewport 布局快照 |
| `layout_hit_test` | 前端 Editor host | WASM layout core | 内存调用 | 否 | 是 | 本文档 | 点坐标到 PM position |
| `layout_get_selection_geometry` | 前端 Editor host | WASM layout core | 内存调用 | 否 | 是 | 本文档 | PM range 到几何高亮 |
| `font_init_subsystem` | 前端 Editor host | Tauri Rust native | Tauri command | 是 | 是 | 本文档 | 初始化字体子系统并返回初始 metrics |
| `font_get_glyph_metrics` | 前端 Editor host | Tauri Rust native | Tauri command | 是 | 可缓存 | 本文档 | 获取指定字体的 glyph metrics 缓存 |
| `font_get_math_constants` | 前端 Editor host | Tauri Rust native | Tauri command | 是 | 可缓存 | 本文档 | 获取 OpenType MATH 常量 |
| `layout_export_pdf` | 前端 Editor host | Tauri Rust native | Tauri command | 是 | 以参数为幂等键 | 本文档 | 导出 PDF |

### 7.3 接口明细

#### 7.3.1 `layout_initialize_document`（WASM 热路径，不跨 IPC）

- 协议：WASM 内联函数调用（flatbuffer/msgpack 序列化输入输出）
- 请求参数：
  - `documentId`
  - `layoutIr`
  - `styleContext`
  - `viewport`
  - `platform`
- 响应参数：
  - `documentRevision`
  - `initialSnapshot`（含 line boxes、glyph runs、selection anchors、caret anchors、Canvas draw ops）
  - `diagnostics`
- 错误返回：
  - `IR_UNSUPPORTED`
  - `LAYOUT_INIT_FAILED`
- 业务校验：
  - `documentId` 必填
  - `layoutIr` 必须结构完整
- 数据变更：
  - 建立 WASM layout context
- 日志字段：
  - `documentId`
  - `irBlockCount`
  - `layoutMs`
  - `fontFallbackCount`

#### 7.3.2 `layout_update_document`（WASM 热路径，不跨 IPC）

- 协议：WASM 内联函数调用
- 请求参数：
  - `documentId`
  - `documentRevision`
  - `updatedBlocks`
  - `removedBlockIds`
  - `viewport`
- 响应参数：
  - `nextRevision`
  - `invalidatedRegions`
  - `snapshotHints`
  - `diagnostics`
- 错误返回：
  - `DOCUMENT_NOT_FOUND`
  - `REVISION_MISMATCH`
  - `LAYOUT_UPDATE_FAILED`
- 业务校验：
  - revision 单调递增
- 数据变更：
  - 更新 WASM 内布局缓存
- 日志字段：
  - `updatedBlockCount`
  - `layoutMs`
  - `greedyFallbackParagraphs`

#### 7.3.3 `layout_get_viewport_snapshot`（WASM 热路径，不跨 IPC）

- 协议：WASM 内联函数调用
- 请求参数：
  - `documentId`
  - `revision`
  - `viewport`
  - `devicePixelRatio`
- 响应参数：
  - `snapshot`（含 DOM text run 定位数据、Canvas draw ops、mirror block 语义段）
  - `selectionAnchors`
  - `caretAnchors`
- 错误返回：
  - `SNAPSHOT_NOT_READY`
  - `DOCUMENT_NOT_FOUND`
- 业务校验：
  - viewport 必须合法
- 数据变更：
  - 无
- 日志字段：
  - `snapshotAgeMs`
  - `viewportBlockCount`

#### 7.3.4 `layout_hit_test`（WASM 热路径，不跨 IPC）

- 协议：WASM 内联函数调用
- 请求参数：
  - `documentId`
  - `revision`
  - `x`
  - `y`
  - `granularity`
- 响应参数：
  - `pmPosition`
  - `bias`
  - `blockId`
- 错误返回：
  - `HIT_TEST_FAILED`
  - `DOCUMENT_NOT_FOUND`
- 业务校验：
  - 坐标必须在 viewport/页面空间内
- 数据变更：
  - 无
- 日志字段：
  - `hitLatencyMs`
  - `fallbackUsed`

#### 7.3.5 `layout_get_selection_geometry`（WASM 热路径，不跨 IPC）

- 协议：WASM 内联函数调用
- 请求参数：
  - `documentId`
  - `revision`
  - `pmFrom`
  - `pmTo`
- 响应参数：
  - `rects`
  - `lineRects`
  - `caretRect`
- 错误返回：
  - `SELECTION_MAP_FAILED`
- 业务校验：
  - range 必须有效
- 数据变更：
  - 无
- 日志字段：
  - `geometryLatencyMs`

#### 7.3.6 `font_init_subsystem`（Tauri command，跨 IPC）

- 路径/方法：Tauri command
- 请求参数：
  - 缺省或平台标识
- 响应参数：
  - `defaultFonts`
  - `fallbackChain`
  - `systemMetrics`
  - `diagnostics`
- 错误码：
  - `FONT_INIT_FAILED`
- 业务校验：
  - 不涉及
- 数据变更：
  - 建立原生字体缓存上下文
- 日志字段：
  - `fontCount`
  - `initMs`

#### 7.3.7 `font_get_glyph_metrics`（Tauri command，跨 IPC，可缓存）

- 路径/方法：Tauri command
- 请求参数：
  - `fontId`
  - `glyphIds`
  - `fontSize`
- 响应参数：
  - `glyphMetrics`（glyph id → advance, bounds, bearing）
  - `cacheHint`
- 错误码：
  - `FONT_NOT_FOUND`
  - `GLYPH_METRIC_FAILED`
- 业务校验：
  - fontId 必须来自已初始化的字体
- 数据变更：
  - 无（读取缓存）
- 日志字段：
  - `requestGlyphCount`
  - `cacheHitRate`

#### 7.3.8 `font_get_math_constants`（Tauri command，跨 IPC，可缓存）

- 路径/方法：Tauri command
- 请求参数：
  - `fontId`
- 响应参数：
  - `mathConstants`（MATH 表结构化常量）
  - `mathGlyphAssemblies`
- 错误码：
  - `FONT_NOT_FOUND`
  - `MATH_TABLE_MISSING`
- 业务校验：
  - fontId 必须来自已初始化字体
- 数据变更：
  - 无（读取缓存）
- 日志字段：
  - `mathConstantCount`

#### 7.3.9 `layout_export_pdf`（Tauri command，跨 IPC）

- 路径/方法：Tauri command
- 请求参数：
  - `documentId`
  - `pageSize`
  - `margins`
  - `outputPath`
  - `fontEmbedMode`
- 响应参数：
  - `pageCount`
  - `warnings`
- 错误码：
  - `PDF_EXPORT_FAILED`
  - `FONT_EMBED_FAILED`
  - `OUTPUT_WRITE_FAILED`
- 业务校验：
  - 输出路径可写
- 数据变更：
  - 生成 PDF 文件
- 日志字段：
  - `pageCount`
  - `exportMs`
  - `embeddedFontCount`

## 八、系统发布

### 8.1 灰度方案

- 灰度范围：不涉及用户可见灰度。
- 灰度开关：无产品开关。
- 验证指标：
  - roundtrip 通过率
  - layout golden pass rate
  - 120fps 滚动达标率
  - IME / clipboard / find / accessibility smoke pass rate
  - PDF 导出成功率
- 放量节奏：
  - 仅通过开发/测试阶段分层验证后直接替换主编辑器。

### 8.2 降级方案

- 降级触发条件：
  - paragraph layout 超时
  - 字体缺失
  - unsupported math syntax
  - 复杂块渲染失败
- 降级行为：
  - paragraph 临时使用 greedy fallback
  - block 回退到源码 fallback 或占位绘制
  - PDF 导出给出 warning 并采用可接受的低保真局部策略
- 用户影响：
  - 局部质量下降，但不应丢文档内容。
- 恢复方式：
  - 修复后重排或重导出。

### 8.3 关联系统/功能影响

| 系统/功能 | 影响 | 依赖动作 | 负责人 | 验证方式 |
|---|---|---|---|---|
| `features/editor` | 主编辑视图更换 | 迁移 EditorPane/bridge | 待定 | integration tests |
| `features/workspace` | Markdown tab 入口变更 | 迁移 EditorStage | 待定 | workspace smoke |
| `features/document` | 文档模式主编辑视图更换 | 迁移 document shell | 待定 | document smoke |
| `packages/mdx-editor` | 保留状态层，产品删除 DOM visible 入口（代码保留为测试对照） | 增补 bridge 契约 | 待定 | unit + integration |
| `src-tauri` | 新增 WASM layout core（热路径）+ native 字体/PDF 模块 | 编 WASM 目标、暴露 Tauri commands | 待定 | Rust tests + WASM tests |

### 8.4 回滚方案

- 回滚条件：
  - 产品层无运行时回滚；旧 view 代码保留为测试对照，但无产品可见入口。
- 回滚步骤：
  - 不提供运行时回滚，只能通过代码修复后重新发版。
- 数据回滚：
  - 不涉及；Markdown 文件格式未改。
- 配置回滚：
  - 不涉及产品级开关。
- 风险：
  - 无回退路径使发布风险显著上升，旧 view 测试对照可部分缓解回归风险。

## 九、系统监控与维护

### 9.1 监控与告警

- 系统异常：
  - layout engine init failure
  - snapshot generation failure
  - PDF export failure
- 业务异常：
  - IME composition failure
  - find bridge miss
  - clipboard conversion failure
  - accessibility mirror rebuild failure
- 重试异常：
  - repeated paragraph relayout fallback
- 超时：
  - paragraph layout timeout
  - viewport snapshot timeout
  - PDF export timeout
- 关键接口指标：
  - `layout_ms`
  - `snapshot_ms`
  - `frame_ms`
  - `hit_test_ms`
  - `pdf_export_ms`
  - `greedy_fallback_count`
  - `glyph_cache_hit_rate`
  - `mirror_rebuild_ms`
- 告警渠道：
  - 本地开发诊断 UI + 日志；正式渠道待产品后续定义。

### 9.2 性能与容量

- TPS/吞吐：不涉及服务型 TPS。
- CPU/内存/磁盘 IO/网络 IO：
  - 重点关注 CPU 布局耗时、GPU/Canvas 绘制时间、内存缓存占用。
- 数据容量：
  - 文档规模目标为常见编辑场景，首版以 5 万字以内、数百公式为主。
- 缓存容量：
  - glyph/layout snapshot 缓存预计中高，占用需可观测。
- 跑批耗时：
  - PDF 导出按文档规模波动。
- 是否压测：
  - 需要，尤其是滚动 120fps 与大段落数学文档。

### 9.3 可靠性与兜底

- 幂等击穿：
  - layout 接口按 revision 幂等处理。
- 并发失效：
  - 使用 revision 和 documentId 保证 snapshot/geometry 不混线。
- 冷热备：
  - 不涉及。
- 关键任务独立性：
  - 导出与屏幕布局共享引擎，但实例上下文应隔离。
- 字段兜底：
  - mirror / geometry 缺失时可以 full rebuild。
- 老新数据兼容：
  - 仅 Markdown 真相，无新持久化格式。

## 十、排期与规划

### 10.1 任务拆分与工作量评估

| 任务 | 范围 | 负责人 | 工作量 | 依赖 | 备注 |
|---|---|---|---|---|---|
| Rust 排版核心（WASM 目标） | IR、paragraph layout、math layout、position mapping、hit-test、selection geometry | 待定 | 高 | spec 完成 | 编 WASM，在 webview 内运行 |
| Rust 排版核心（native 目标） | 字体子系统（发现/OpenType 解析/glyph metric 缓存）、分页、PDF | 待定 | 高 | WASM 目标 | 跨 IPC 调用 |
| 混合 view layer（DOM text runs + Canvas/SVG） | 渲染、合成、命中、selection、scroll | 待定 | 高 | WASM snapshot 协议 | 前端核心 |
| 轻量 DOM mirror（Canvas 块） | Canvas 块的 ARIA/find/range 协调 | 待定 | 中 | PM range map | 仅补齐 Canvas 块 |
| 复杂块迁移 | table/code/image/mermaid/html/fallback | 待定 | 高 | host + layout | 集成面广 |
| PDF/打印 | pagination + export writer | 待定 | 中高 | 排版核心 | 首版硬范围 |
| 旧 view 测试对照 | 保留旧代码、构建 golden fixture 对比例行 | 待定 | 中 | 全模块 | 无产品入口 |
| 验证体系 | unit/golden/interaction/perf | 待定 | 高 | 全模块 | 发布门槛 |

### 10.2 计划时间

- 数据方案评审：待定
- 开发开始/结束：待定
- CR：待定
- 联调完成/提测：待定
- 测试用例评审：待定
- 测试开始/结束：待定
- 预发布：不涉及用户灰度
- 上线：待定
- 线上验证：待定

### 10.3 发布计划

1. 先完成设计评审与接口冻结
2. 建立 Rust 排版核心的 WASM/native 双目标和 golden fixtures
3. 分层实现混合 view 层并保持旧 view 代码作为回归对照
4. 通过全量验收（roundtrip、golden、IME、find、accessibility、性能、PDF）后切换产品默认编辑器为新实现
5. 全量运行稳定后删除旧 view 测试对照代码

### 10.4 遗留问题与后续规划

| 问题 | 影响 | 处理计划 | 负责人 | 截止时间 |
|---|---|---|---|---|
| Windows/Linux 跨平台 | 首版不阻塞 | 后续平台适配 | 待定 | 待定 |
| 复杂脚本高质量 shaping | 首版仅保内容 | 后续专项优化 | 待定 | 待定 |
| 高级出版能力 | 不在首版 | 后续分页增强 | 待定 | 待定 |

### 10.5 Planning Handoff

- `plan-to-exec` 可以决定：
  - 具体 crate / package / file 结构。
  - WASM 序列化协议选择（flatbuffer/msgpack/etc.）。
  - 先做段落布局 path、math path、mirror path 还是 PDF path 的实施顺序。
  - DOM text run 层与 Canvas/SVG 层的具体分层合成方案。
  - 具体测试文件命名、fixture 拆分、命令组织。
  - 具体性能计数器、调试 UI 和内部开发开关形态。
- 必须返回 `spec` 的事项：
  - 改变混合 DOM text runs + Canvas/SVG 的可见表面核心边界。
  - 改回纯 Canvas 唯一可见或纯 DOM text run 无 Canvas。
  - 改变 WASM layout core + native 字体资产的双目标分工。
  - 改变 PDF 首版范围、无产品回退发布策略、Markdown 真相规则。
  - 改变 accessibility / browser find / HTML paste 三项硬要求（正文已由 DOM 原生满足）。
- 必须返回 `clarify` 的事项：
  - 用户改口接受旧编辑器产品回退或将旧 view 测试对照代码也删除。
  - 用户放弃 Knuth-Plass 最终目标。
  - 用户拒绝保留旧 view 测试对照代码。
- 推荐下一步：

```text
$plan-to-exec docs/loopx/design/TeX风格Canvas自绘编辑器需求设计文档.md
```

## 十一、QA

### 11.1 评审记录

| 评审时间 | 评审人 | 评审问题 | 处理进展 | 结论 |
|---|---|---|---|---|
| 待定 | 待定 | 待补充 | 待处理 | 待定 |

### 11.2 待确认问题

| 问题 | 需要谁确认 | 阻塞阶段 | 推荐答案 | 状态 |
|---|---|---|---|---|
| Rust layout engine 的 crate 边界和依赖选择 | 设计评审人 | plan | 优先纯 Rust，接口隔离，按 font/layout/pdf 分层 | open |
| semantic mirror 的 ARIA 结构和浏览器 find 兼容策略 | 设计评审人 | plan | 以 block/inline 语义为主，维护稳定 range ids | open |
| PDF 输出具体库与文本嵌入策略 | 设计评审人 | plan | 文本可选与矢量优先，避免整页位图 | open |
| 120fps 的基准 fixture 与硬件基线 | 设计评审人 | plan | 在固定 macOS 测试环境下建立性能基线 | open |
