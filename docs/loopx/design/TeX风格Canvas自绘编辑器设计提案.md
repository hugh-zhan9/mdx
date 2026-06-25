# 我们将 Markdown 编辑器迁移为以 Rust 排版引擎驱动的 TeX 风格 Canvas 自绘编辑器

Author(s): Codex
Last updated: 2026-06-24
Status: Draft (V1.1 — 2026-06-24 复审修订：混合渲染、保留旧 view 测试对照、WASM 热路径+native 字体)
Discussion: 不涉及
Source requirements: `.loopx/intake/clarify-tex-like-canvas-editor-20260624172256.md`
Support lenses: architecture-designer

## Abstract / 摘要

我们将把当前基于 ProseMirror DOM view 的 Markdown 编辑器迁移为以 Rust 排版引擎驱动、混合 DOM text runs + Canvas/SVG 公式/复杂块的自研编辑表面。ProseMirror 保留为文档模型、事务、history、schema 和 Markdown 往返层；Rust 核心负责字体解析、Knuth-Plass 全局断行、OpenType MATH 公式布局、分页和 PDF 输出；热路径（断行/box/math/位置映射/命中测试/选区几何）编 WASM 在 webview 内运行避免逐帧 IPC，字体重资产（系统字体发现/OpenType 解析/glyph metric）留 Rust native 一次性取回并缓存。正文使用排版引擎计算位置的绝对定位 DOM text runs 渲染（非浏览器 CSS 断行），以复用浏览器原生的 a11y、find、粘贴、IME 能力；公式/表格网格/代码高亮/图片装饰使用 Canvas/SVG。产品唯一暴露新编辑器，旧 ProseMirror DOM view 代码保留为回归对照与测试夹具，全量验收通过后删除。该方案保持 Markdown 文件格式、草稿恢复、冲突检测和 unsupported Markdown fallback 的长期兼容承诺。

## Background / 背景与动机

当前仓库中的编辑器仍以 DOM 为可见表面：

- `packages/mdx-editor/react/mdx-editor-provider.tsx` 直接创建 `EditorView`。
- `packages/mdx-editor/react/mdx-editor-view.tsx` 暴露的是 `div[data-mdx-editor-root]`。
- `packages/mdx-editor/react/math-node-view.tsx` 使用 KaTeX 把 LaTeX 渲染为 HTML。
- `features/editor/components/editor-pane.tsx`、`features/workspace/components/editor-stage.tsx` 已把 find/replace、Mermaid、图片插入、selection bridge 等能力绑在当前 DOM 形态上。

这条链路的优势是复用浏览器编辑能力，但它天然受限于：

- 断行由浏览器逐行处理，无法获得 Knuth-Plass 全局最优。
- CJK/Latin 混排只能做 CSS 级修饰，难以达到 TeX-like 质量。
- 数学公式依赖 KaTeX HTML 输出，无法按 OpenType MATH 常量和真实字体 metrics 统一处理。
- 屏幕布局和打印/PDF 输出缺少同一排版引擎，难以保证一致性。

用户当前需求不是修小补，而是明确要求：

- 全编辑器优化，而不是只读预览。
- 混合渲染：正文 DOM text runs（位置由引擎决定）+ 公式/复杂块 Canvas/SVG。
- Rust 布局核心，热路径编 WASM。
- Knuth-Plass 仍是最终目标。
- 完整支持 HTML 富文本粘贴、浏览器查找、屏幕阅读器（复用 DOM 文本层原生能力）和 PDF/打印。

这使本次工作成为编辑器架构更换，而不是单一功能增强。

## Goals And Non-Goals / 目标与非目标

### Goals

- 让混合 DOM text runs + Canvas/SVG 成为 Markdown 编辑器唯一可见表面，正文位置由排版引擎决定。
- 用 Rust 排版核心（WASM 热路径 + native 字体资产）统一屏幕编辑和 PDF/打印输出。
- 以 Knuth-Plass 为最终断行算法，提高中英混排质量。
- 用 OpenType MATH 驱动数学布局，覆盖常见 LaTeX 数学结构。
- 保持 Markdown 作为唯一持久化真相，并保持 unsupported Markdown fallback 保真。
- 在不保留旧编辑器回退的前提下，接住当前工作区编辑、恢复、冲突检测、CLI/Agent 等既有产品能力。

### Non-Goals

- 不实现完整 TeX 引擎或完整 LaTeX 宏生态。
- 不做多光标。
- 不把文档真相迁移到数据库或私有格式。
- 不承诺首版对复杂脚本达到 TeX-like 排版质量。
- 不在首版覆盖高级出版能力，如复杂脚注跨页、双栏排版、浮动图表、目录模板等。

## Proposal / 设计方案

### 1. 保留 ProseMirror 状态层，替换 View 层和布局层

我们不重写编辑器文档模型。现有仓库已经在 `packages/mdx-editor/` 中形成 Markdown parser、schema、serializer、clipboard、node view 和 selection snapshot 体系，并且长期规则要求 Markdown 为唯一真相。完全替换 ProseMirror 会把任务扩大成编辑器内核重写，而不是排版与渲染迁移。

因此我们固定以下边界：

- ProseMirror 继续负责文档结构、transaction、undo/redo、schema 约束、Markdown 往返。
- 前端不再使用 ProseMirror DOM view 作为主显示层。
- 新前端 view 通过 position mapping 把 DOM/Canvas 命中、光标、选区和 IME 事件映射回 ProseMirror positions。

### 2. Rust 排版核心：WASM 热路径 + native 字体资产

我们编写统一的 Rust 排版核心，编为两目标部署：

**WASM 目标**（webview 内运行，避免逐帧跨 IPC）：
- Knuth-Plass 全局断行与贪心 fallback。
- CJK/Latin 断行机会和 box/glue/penalty 建模。
- 数学 box tree 构建（script、fraction、radical、delimiter、operator spacing）。
- position mapping（PM position ↔ layout geometry）、hit-test、caret anchors、selection geometry。

**Native 目标**（Rust crate，通过 Tauri command 调用）：
- 系统字体发现与 fallback chain 构建。
- OpenType MATH 表读取与字体常量缓存。
- 字体 metrics 与 glyph shaping（优先纯 Rust 库；必要时引入 HarfBuzz 绑定）。
- Glyph metric 与字体级缓存。
- 页面布局与 PDF/文本/矢量输出。

前端不会自己做核心排版决策；它接收 WASM 产出的稳定 layout tree / draw list / hit-test map（热路径），并通过 Tauri command 从 native 侧一次性获取字体资产后缓存在内存。字体 asset 变更时才重新拉取。

### 3. 混合可见表面：DOM text runs + Canvas/SVG

用户要求编辑器的排版质量由引擎决定，同时要求富文本 HTML 粘贴、浏览器查找、完整屏幕阅读器支持。纯 Canvas 会使这些能力变成高昂的自建成本。因此我们固定双层表面：

- **DOM text run 层**：正文、标题、列表、表格单元格文本等以绝对定位的 DOM text runs 渲染，位置由排版引擎算出的 line box / glyph geometry 决定，**不是浏览器 CSS 断行**。a11y、浏览器 find、富文本粘贴、IME 优先复用 DOM 文本层原生能力。文本层只负责放置已算好的 runs，不参与断行决策。
- **Canvas/SVG 层**：公式、表格网格、代码语法高亮、图片装饰、Mermaid 等复杂块使用 Canvas 或 SVG 绘制，覆盖在 DOM 文本层之上。
- **轻量语义桥接**：仅对 Canvas/SVG 块补充 ARIA 与浏览器 find/range 协调，通过一个轻量的 DOM semantic mirror 实现。正文段落不依赖 mirror，直接使用 DOM 文本层的可搜索与可访问能力。

### 4. 迁移为单编辑器产品形态，保留旧 view 作测试对照

用户明确拒绝实验开关和产品级回退路径。产品唯一暴露新编辑器。但我们保留旧 ProseMirror DOM view 代码不作为产品可见入口，仅作为：

- 迁移期间的回归对照与测试夹具。
- 面向开发与测试的 debug overlay。
- 结构化回归测试，代替产品级开关。

全量验收通过后再删除旧 view 代码。产品层面是单路径，工程层面仍保留可验证迁移的工程材料。

### 5. PDF/打印与屏幕共享同一 layout engine

如果屏幕排版和导出排版由两套逻辑分别实现，TeX-like 质量和一致性都会失真。因此：

- 页面布局和屏幕布局共享同一段落、公式和字体度量模型。
- PDF/打印走真实文本和矢量绘制优先的输出管线，不接受整页位图截图式导出。

### 6. 复杂块采用统一 block 协议，而不是逐个特判 DOM

编辑器不只处理纯文本段落。设计上应定义统一的 block protocol，让 Rust 和前端都知道每类块的布局边界、命中方式和导出行为。首版 block 类别包括：

- paragraph / heading
- list / task list
- table
- code block
- image
- mermaid block
- html block / inline html fallback
- math inline / math block
- unsupported source fallback block

## Support Lens Checks / 专项设计检查

| Support lens | Trigger | Design checks applied | Result |
|---|---|---|---|
| architecture-designer | 这是一次跨前端 view、Rust native、导出、可访问性和状态层边界的长期架构迁移 | 系统边界、NFR、失败模式、兼容性、迁移成本、可运维性 | 选择保留 ProseMirror 状态层，新增 Rust layout engine 和 DOM semantic mirror，接受 breaking migration 成本 |

## Boundary Scenarios / 边界场景

- 无效或不支持的 Markdown / HTML：
  - 处理：继续走 unsupported fallback 保真，不允许丢内容。
  - 状态：本方案处理。
- 中文 IME 组合输入：
  - 处理：正文走 DOM text run 层原生 IME；Canvas 块内公式等通过 hidden input / composition bridge 与 ProseMirror transaction 对齐。
  - 状态：本方案处理。
- 浏览器 find 命中：
  - 处理：正文直接命中 DOM 文本层，Canvas 块公式等的 find 由轻量 mirror 补位。
  - 状态：本方案处理。
- 富文本 HTML 粘贴：
  - 处理：进入 DOM clip 入口，再转换成 Markdown-safe 节点与 transaction。
  - 状态：本方案处理。
- 超长段落或复杂公式导致布局耗时过高：
  - 处理：允许贪心断行 fallback 或局部旧布局占位，但最终验收仍以 Knuth-Plass 为目标。
  - 状态：本方案处理。
- 不支持的复杂脚本 shaping：
  - 处理：首版先保证不丢内容、不崩溃，可降级质量。
  - 状态：本方案显式延期质量目标。
- 删除旧 DOM 编辑器后新实现出错：
  - 处理：无产品级回退；保留旧 view 代码用于测试对比，依赖灰盒诊断和修复发版。
  - 状态：本方案接受该风险。
- PDF 导出中的分页、矢量和文本嵌入：
  - 处理：纳入首版，但限制高级出版功能。
  - 状态：本方案处理。
- 草稿恢复、冲突检测、CLI selection、workspace 保存：
  - 处理：保持现有协议和行为不变，仅替换 view/renderer。
  - 状态：本方案处理。
- 不变行为：
  - Markdown 仍是唯一存储格式。
  - unsupported Markdown fallback 保真规则不变。
  - 工作区和文档模式的文件读写、dirty、recovery、conflict 基线不变。

## Rationale / 理由与取舍

这条方案最重要的取舍是：我们接受一次高风险、不可回退的 view 层迁移，换取统一的排版质量、导出一致性和对 TeX-like 布局的控制力。

| Alternative | Why Not |
|---|---|
| 只做只读预览或局部排版增强 | 用户明确要求整个编辑器优化，不满足目标表面 |
| 纯 Canvas 唯一可见表面 | 与 a11y/find/IME/富文本粘贴天然对立，需建昂贵 DOM mirror；重审时被否决 |
| 全部 layout 在 Rust native + 逐帧跨 IPC | IPC 序列化无法同时满足 120fps + <50ms 编辑反馈；重审时改为 WASM 热路径 |
| 完全替换 ProseMirror 文档模型 | 会把范围扩大到编辑器内核重写，无法利用现有 Markdown-native 状态与事务体系 |
| 保留旧 DOM 编辑器产品回退开关 | 用户拒绝开关与回退，但代码保留作为测试对照 |
| 首版直接删除旧 view 代码 | 重审时收窄为保留代码作为测试对照，降低无回退风险 |
| 以逐行贪心作为最终断行算法 | 与用户”Knuth-Plass 全局断行”目标冲突，只能作为过渡 fallback |
| 使用完整 TeX 引擎或黑盒渲染框架 | 依赖面过重，不符合”极小依赖面、接口隔离、优先纯 Rust”的要求 |

## Compatibility / 兼容性

这是一次 **产品层 breaking migration**，但不是 **文档格式 breaking change**。

兼容性承诺：

- Markdown 文件格式不变。
- 现有 `.md/.markdown` 文档可继续打开、编辑和保存。
- unsupported Markdown fallback 继续精确保留源码。
- 现有草稿恢复、冲突检测、workspace/document 文件读写协议不变。
- ProseMirror schema、parser、serializer、CLI selection / insert 基本合约保持延续。

不兼容点：

- 旧 DOM 编辑器视图的**产品可见入口**会被删除；代码保留为测试对照。
- 现有依赖 DOM 结构的集成代码需要迁移到新的混合 view contract。
- 查找、选区、命中测试、copy/paste 等路径会换实现或简化，但外部行为目标保持不变。

## Operational And Security Impact / 运行与安全影响

- 运行风险：
  - 新增 Rust 排版核心（WASM + native 字体）将增加工程复杂度。
  - 删除旧编辑器产品入口后，故障恢复只能靠修复，不靠产品回退；旧 view 代码仅作测试对照。
- 观测性：
  - 需要布局耗时、WASM 帧率、viewport invalidation、字体命中率、镜像同步错误、IME 失败和 PDF 导出失败的结构化诊断。
- 安全性：
  - HTML 粘贴与 HTML fallback 继续需要安全白名单和 sanitizer。
  - DOM mirror 不应泄露额外数据，只反映当前文档 Canvas 块的语义。

## Implementation And Transition / 实现与过渡

这不是任务计划，但方向上必须分层落地：

1. 抽离 Rust layout engine 和前端 Canvas view 协议。
2. 在不改变 Markdown 真相和 ProseMirror 状态层的前提下，建立 layout snapshot、hit-test map 和 draw list。
3. 用 Canvas 渲染纯文本与基础光标选区，再接 DOM mirror、clipboard 和 find bridge。
4. 再接数学、复杂块、分页与 PDF 输出。
5. 最后删除旧 DOM 编辑器相关代码与 DOM contract 依赖。

## Open Questions / 待决问题

- 无阻塞 clarify 的未决产品问题。
- 仍需在详细设计中固定的技术问题包括：
  - Rust crate 划分与前端 bridge contract。
  - DOM mirror 的 range 同步与 ARIA 策略。
  - 120fps 指标下的 virtualization / cache / invalidation 方案。
  - PDF 输出库与文本嵌入策略。

## Detailed Design Handoff / 详细设计交接

应立即编写详细设计文档。

详细设计必须把以下决策视为固定约束：

- 混合可见表面：正文 DOM text runs（位置由排版引擎决定）+ 公式/复杂块 Canvas/SVG。
- ProseMirror 继续作为状态层。
- Rust 排版核心负责字体、布局、数学和分页；热路径编 WASM 在 webview 内运行，字体重资产留 native。
- 轻量 DOM semantic mirror 仅补齐 Canvas 块的语义与 find/range 协调。
- Markdown 仍是唯一持久化真相。
- 保留旧 view 代码作为测试对照，产品仅暴露新编辑器。
- Knuth-Plass 是最终断行目标，贪心仅为过渡 fallback。
- PDF/打印首版纳入范围，文本/矢量优先。

## Appendix / 附录

关键仓库证据：

- `docs/loopx/specs/editor.md`
- `.loopx/memory/MEMORY.md`
- `features/editor/components/editor-pane.tsx`
- `features/workspace/components/editor-stage.tsx`
- `packages/mdx-editor/react/mdx-editor-provider.tsx`
- `packages/mdx-editor/react/mdx-editor-view.tsx`
- `packages/mdx-editor/react/math-node-view.tsx`
