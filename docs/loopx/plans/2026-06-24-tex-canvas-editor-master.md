# TeX风格Canvas自绘编辑器 — 实施主计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/TeX风格Canvas自绘编辑器需求设计文档.md`

**Goal:** 把当前 ProseMirror DOM view 编辑器迁移为 Rust 排版核心驱动、混合 DOM text runs + Canvas/SVG 的 TeX 风格自研编辑器

**Architecture:** ProseMirror 保留为文档模型/事务层；Rust 核心编两目标——热路径（断行/box/数学/命中/选区几何）编 WASM 在 webview 内运行，字体重资产（系统字体发现/OpenType 解析/glyph metric）留 native 经 Tauri command 一次性取回并缓存。正文以排版引擎计算位置的绝对定位 DOM text runs 渲染，公式/复杂块用 Canvas/SVG。轻量 DOM semantic mirror 仅补齐 Canvas 块的 ARIA/find/range。PDF 导出在 native 侧复用同核心。

**Tech Stack:** Rust (WASM + native Cargo workspace)、TypeScript/React、ProseMirror、Tauri 2.x、Canvas 2D/SVG

**Support lenses:** architecture-designer

## 全局约束

- Markdown 文件仍是唯一持久化真相，unsupported Markdown fallback 必须保真。
- 草稿恢复、冲突检测、workspace/document 保存流程不能退化。
- 120fps 滚动是硬目标；普通输入到可见更新 < 50ms；首屏可交互 < 500ms。
- 最终断行目标为 Knuth-Plass，贪心仅为过渡 fallback。
- 依赖面极小、接口隔离、优先纯 Rust。
- 旧 view 代码保留为回归对照与测试夹具，产品唯一暴露新编辑器；全量验收后删除旧 view。
- 首版验收平台为 macOS Tauri。

---

## 子系统划分布局

```
docs/loopx/plans/2026-06-24-tex-canvas-editor-master.md  ← 本文件（主计划）
docs/loopx/plans/2026-06-24-tex-canvas-editor-p1-wasm.md │ P1: Rust WASM 排版核心
docs/loopx/plans/2026-06-24-tex-canvas-editor-p2-font.md │ P2: Rust native 字体子系统
                                                         │     [P1+P2 → 可并行]
docs/loopx/plans/2026-06-24-tex-canvas-editor-p3-pdf.md  │ P3: Rust native PDF/分页 ← 依赖 P1+P2
docs/loopx/plans/2026-06-24-tex-canvas-editor-p4-view.md │ P4: 前端混合 view 层 ← 依赖 P1 WASM snapshot 协议
docs/loopx/plans/2026-06-24-tex-canvas-editor-p5-mirror.md│ P5: 轻量 DOM mirror ← 依赖 P4 + PM range map
docs/loopx/plans/2026-06-24-tex-canvas-editor-p6-blocks.md│ P6: 复杂块 migration ← 依赖 P4 + layout
docs/loopx/plans/2026-06-24-tex-canvas-editor-p7-test.md  │ P7: 验证体系 + golden fixtures
docs/loopx/plans/2026-06-24-tex-canvas-editor-p8-cleanup.md│ P8: 删除旧 view 对照代码
```

---

## 标准化接口合同（跨所有子系统共享）

### Layout IR (layout IR normalizer → WASM layout core 的输入)

Layout IR Normalizer 是前端模块，输入 ProseMirror doc + style context，输出标准化的 IR。IR 是跨所有子系统的共享协议：

```typescript
interface LayoutDocument {
  documentId: string;
  revision: number;
  blocks: LayoutBlock[];
  styleContext: StyleContext;
}

interface LayoutBlock {
  blockId: string;           // 稳定 UUID
  kind: BlockKind;           // "paragraph" | "heading" | "list" | "table" | "code" | "image" | "mermaid" | "html" | "math_block" | "fallback"
  pmFrom: number;            // ProseMirror position (absolute)
  pmTo: number;
  style: BlockStyle;
  inlines: InlineRun[];
  depth: number;             // 嵌套层级
}

type BlockKind = "paragraph" | "heading" | "list" | "table" | "code" | "image" | "mermaid" | "html" | "math_block" | "fallback";

interface InlineRun {
  text: string;
  kind: "text" | "math_inline" | "hard_break" | "image_inline" | "html_inline";
  from: number;              // IR 内 offset
  to: number;
  style: InlineStyle;
}

interface BlockStyle {
  headingLevel?: 1|2|3|4|5|6;
  textAlign?: "left"|"right"|"center"|"justify";
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  mathDisplay?: "inline"|"block";
}

interface InlineStyle {
  bold: boolean;
  italic: boolean;
  code: boolean;
  link?: string;
  strike?: boolean;
  underline?: boolean;
}
```

### Layout Snapshot (WASM layout core → 前端的输出)

```typescript
interface LayoutSnapshot {
  revision: number;
  lines: LayoutLine[];
  canvasDrawOps: CanvasDrawOp[];
  hitTestMap: HitTestEntry[];
  caretAnchors: CaretAnchor[];
  selectionGeometries: SelectionGeometry[];
  mirrorBlocks: MirrorBlock[];
}

interface LayoutLine {
  id: string;
  blockId: string;
  y: number;
  baseline: number;
  height: number;
  textRuns: TextRunPosition[];
}

interface TextRunPosition {
  blockId: string;
  pmFrom: number;
  pmTo: number;
  left: number;
  baseline: number;
  width: number;
  height: number;
  fontFamily: string;
  fontSize: number;
  text: string;
}

interface CanvasDrawOp {
  blockId: string;
  kind: "math" | "table_grid" | "code_highlight" | "image" | "mermaid" | "decoration";
  rect: { x: number; y: number; width: number; height: number };
  data: unknown; // 块类型特定的绘制命令
}

interface HitTestEntry {
  blockId: string;
  rect: { x: number; y: number; width: number; height: number };
  pmFrom: number;
  pmTo: number;
}

interface CaretAnchor {
  lineId: string;
  pmPosition: number;
  x: number;
  y: number;
  height: number;
}

interface SelectionGeometry {
  pmFrom: number;
  pmTo: number;
  rects: { x: number; y: number; width: number; height: number }[];
}

interface MirrorBlock {
  blockId: string;
  pmFrom: number;
  pmTo: number;
  semanticText: string;
  ariaLabel: string;
}
```

### 字体资产接口 (Tauri command → 前端缓存)

```typescript
interface FontInitResult {
  defaultFonts: FontDescriptor[];
  fallbackChain: string[];
  systemMetrics: { fontCount: number };
}

interface FontDescriptor {
  fontId: string;
  familyName: string;
  weight: number;
  style: string;
  postscriptName: string;
  mathAvailable: boolean;
}

interface GlyphMetrics {
  advance: number;
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number };
  bearingX: number;
  bearingY: number;
}

interface MathConstants {
  subscriptShiftDown: number;
  superscriptShiftUp: number;
  fractionNumeratorShiftUp: number;
  fractionDenominatorShiftDown: number;
  fractionRuleThickness: number;
  radicalExtraAscender: number;
  radicalRuleThickness: number;
  accentBaseHeight: number;
  displayOperatorMinHeight: number;
  // ... 其他 MATH 表常量
}
```

---

## 文件结构

```
src-tauri/
├── Cargo.toml                    # workspace root → 添加 layout-core 与 font-subsystem crates
├── src/
│   ├── main.rs
│   ├── lib.rs                    # 暴露 Tauri commands
│   └── ... (现有文件)
├── crates/
│   ├── layout-core/              # P1: 排列核心(WASM 目标)
│   │   ├── Cargo.toml            #   crate-type = ["cdylib", "rlib"]
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── ir.rs             #   读取 normalized layout IR
│   │   │   ├── paragraph.rs      #   Knuth-Plass + greedy fallback
│   │   │   ├── math.rs           #   OpenType MATH math box tree
│   │   │   ├── break_model.rs    #   CJK/Latin 断行机会
│   │   │   ├── position.rs       #   PM position ↔ layout geometry mapping
│   │   │   ├── hit_test.rs       #   坐标系命中 → PM position
│   │   │   ├── selection.rs      #   选区几何计算
│   │   │   ├── font_api.rs       #   字体 metric 查询接口（WASM 侧存来自 native 的缓存）
│   │   │   └── wasm_bridge.rs    #   WASM 导出函数 + 序列化协议
│   │   └── tests/
│   │       ├── paragraph_tests.rs
│   │       ├── break_model_tests.rs
│   │       ├── math_tests.rs
│   │       └── position_tests.rs
│   └── font-core/                # P2: 字体子系统(native 目标)
│       ├── Cargo.toml
│       ├── src/
│       │   ├── lib.rs
│       │   ├── discovery.rs      #   系统字体发现(macOS CoreText)
│       │   ├── math_table.rs     #   OpenType MATH 表解析
│       │   ├── glyph.rs          #   glyph metric 缓存
│       │   ├── fallback.rs       #   fallback chain 构建
│       │   └── shaper.rs         #   glyph shaping 接口
│       └── tests/
│           ├── discovery_tests.rs
│           ├── math_table_tests.rs
│           └── glyph_tests.rs
├── wasm/                         # WASM 构建产物输出目录
│   └── layout_core_bg.wasm       #   编译产物
│
packages/
├── mdx-editor/                   # 现有 + 新增
│   ├── src/
│   │   └── layout-ir/            # P1+P4: Layout IR normalizer
│   │       ├── index.ts
│   │       ├── normalizer.ts     #    PM doc → LayoutIR
│   │       ├── types.ts          #    接口合同类型定义
│   │       └── invalidation.ts   #    增量 invalidation
│   └── react/
│       ├── mdx-editor-provider.tsx # 保留
│       ├── mdx-editor-view.tsx     # 保留为测试对照，产品默认不加载
│       ├── hybrid-editor-host.tsx  # P4: 新混合 view EditorHost
│       ├── dom-text-run-layer.tsx  # P4: DOM text run 位置管理
│       ├── canvas-svg-layer.tsx    # P4: Canvas/SVG 绘制
│       ├── wasm-layout-bridge.ts   # P4: WASM 加载/调用/序列化
│       ├── light-mirror.tsx        # P5: 轻量 mirror 组件
│       └── complex-blocks/        # P6: 复杂块适配器
│           ├── math-block.tsx
│           ├── table-block.tsx
│           ├── code-block.tsx
│           ├── image-block.tsx
│           └── mermaid-block.tsx
│
features/
├── editor/components/
│   ├── editor-pane.tsx             # P4: 迁移到 hybrid-editor-host
│   ├── editor-find-bar.tsx         # P4: 调整 find 桥接
│   ├── editor-kernel-adapter.tsx   # P4: 适配新 view
│   └── editor-mermaid-preview-layer.tsx # P4: 调整 Mermaid 集成
│
src-tauri/src/lib.rs                # P8: 注册字体 + PDF Tauri commands
```

---

## 依赖时间线

```
                   并行阶段                      顺序阶段
                    ┌─────────┐
                    │ P1: WASM│         ┌──────────┐
                    │ layout  │───────▶ │ P4: 前端  │
                    └─────────┘         │ view层    │
                                        └─────┬────┘
                    ┌─────────┐               │
                    │ P2: Font│         ┌──────▼──────┐   ┌──────────┐
                    │ native  │─────────▶│ P3: PDF/分页│   │ P6: 复杂 │
                    └─────────┘         └──────┬──────┘   │ 块 migration
                                              │           └─────┬────┘
                                        ┌─────▼─────┐          │
                                        │ P5: Mirror│          │
                                        └─────┬─────┘          │
                                              │                 │
                                        ┌─────▼─────────────────▼────┐
                                        │    P7: 验证体系+golden    │
                                        └────────────┬──────────────┘
                                                     │
                                              ┌──────▼──────┐
                                              │ P8: 清理     │
                                              │ 旧 view     │
                                              └─────────────┘
```

## 入口

### 并行启动（立即）

- **P1:** `docs/loopx/plans/2026-06-24-tex-canvas-editor-p1-wasm.md` — Rust WASM 排版核心
- **P2:** `docs/loopx/plans/2026-06-24-tex-canvas-editor-p2-font.md` — Rust native 字体子系统

### 依赖 P1/P2 完成后

(将由后续 plan-to-exec 调用时展开)

- P3: Rust native PDF/分页
- P4: 前端混合 view 层
- P5: 轻量 DOM mirror
- P6: 复杂块 migration
- P7: 验证体系
- P8: 清理旧 view
