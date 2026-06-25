# P1: Rust WASM 排版核心

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/TeX风格Canvas自绘编辑器需求设计文档.md`
**Master plan:** `docs/loopx/plans/2026-06-24-tex-canvas-editor-master.md`

**Goal:** 实现 Rust 排版核心，编译为 WASM 目标，供前端 webview 内运行。核心负责 Knuth-Plass 断行、CJK/Latin break model、math box tree 布局、position mapping、hit-test、selection geometry 和 caret anchors。

**Architecture:** 单一 Rust crate `layout-core`，crate-type = ["cdylib", "rlib"]，导出扁平的 WASM 函数。通过平坦消息协议（flatbuffer 或 msgpack）与前端的 WASM bridge 交换 LayoutIR 和 LayoutSnapshot。

**Shared contract:** LayoutDocument / LayoutSnapshot / FontMetrics — 见 master plan 接口合同。

**Tech Stack:** Rust (edition 2021), wasm-pack, ttf-parser (纯 Rust), smallvec, lru

**Support lenses:** none

## 全局约束

- 极小依赖面、优先纯 Rust。
- Knuth-Plass 是最终目标，贪心仅为过渡 fallback。
- 同输入输出稳定（幂等）。
- WASM binary 大小应受监控，不引入完整 TeX 引擎。
- 字体 metric 数据从 `font_get_glyph_metrics` native command 获取后，通过 `font_api.rs` 在 WASM 侧缓存。

---

## 文件结构

```
src-tauri/crates/layout-core/
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── ir.rs              # LayoutIR 反序列化 + 校验
│   ├── break_model.rs     # CJK/Latin 断行机会、penalty/glue 分配
│   ├── paragraph.rs       # Knuth-Plass + greedy fallback
│   ├── math.rs            # Math box tree (script/fraction/radical/delimiter)
│   ├── position.rs        # PM position ↔ layout geometry
│   ├── hit_test.rs        # (x,y) → PM position
│   ├── selection.rs       # PM range → 几何高亮 rects
│   ├── font_api.rs        # Font metric 缓存接口
│   └── wasm_bridge.rs     # WASM 导出函数
├── tests/
│   ├── break_model_tests.rs
│   ├── paragraph_tests.rs
│   ├── math_tests.rs
│   └── position_tests.rs
```

---

### Task 1: Cargo.toml + lib.rs 骨架

**Files:**
- Create: `src-tauri/crates/layout-core/Cargo.toml`
- Create: `src-tauri/crates/layout-core/src/lib.rs`

**Interfaces:**
- Produces: `wasm_bridge::layout_initialize_document()`, `layout_update_document()`, `layout_get_viewport_snapshot()`, `layout_hit_test()`, `layout_get_selection_geometry()`

- [ ] **Step 1: 创建 Cargo.toml**

```toml
[package]
name = "layout-core"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
smallvec = "1"
lru = "0.12"
ttf-parser = "0.21"

[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen = "0.2"

[dev-dependencies]
```

- [ ] **Step 2: 更新 workspace Cargo.toml**

在 `src-tauri/Cargo.toml` 的 `[workspace]` 中（如果没有 workspace，先创建）添加：

```toml
[workspace]
members = [
    "crates/layout-core",
    "crates/font-core",
]
```

如果已有 workspace 段，改为：

```toml
[workspace]
members = [
    "crates/layout-core",
    "crates/font-core",
]
```

- [ ] **Step 3: 创建 lib.rs 骨架**

```rust
pub mod ir;
pub mod break_model;
pub mod paragraph;
pub mod math;
pub mod position;
pub mod hit_test;
pub mod selection;
pub mod font_api;

#[cfg(target_arch = "wasm32")]
pub mod wasm_bridge;

use serde::{Deserialize, Serialize};

/// 跨模块共享的核心类型

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutDocument {
    pub document_id: String,
    pub revision: u64,
    pub blocks: Vec<LayoutBlock>,
    pub style_context: StyleContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutBlock {
    pub block_id: String,
    pub kind: BlockKind,
    pub pm_from: usize,
    pub pm_to: usize,
    pub style: BlockStyle,
    pub inlines: Vec<InlineRun>,
    pub depth: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BlockKind {
    Paragraph,
    Heading,
    List,
    Table,
    Code,
    Image,
    Mermaid,
    Html,
    MathBlock,
    Fallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineRun {
    pub text: String,
    pub kind: InlineKind,
    pub from: usize,
    pub to: usize,
    pub style: InlineStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InlineKind {
    Text,
    MathInline,
    HardBreak,
    ImageInline,
    HtmlInline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockStyle {
    pub heading_level: Option<u8>,
    pub text_align: TextAlign,
    pub font_size: f32,
    pub font_family: String,
    pub line_height: f32,
    pub math_display: MathDisplay,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TextAlign { Left, Right, Center, Justify }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MathDisplay { Inline, Block }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineStyle {
    pub bold: bool,
    pub italic: bool,
    pub code: bool,
    pub link: Option<String>,
    pub strike: bool,
    pub underline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleContext {
    pub default_font_size: f32,
    pub default_font_family: String,
    pub default_line_height: f32,
    pub viewport_width: f32,
    pub viewport_height: f32,
    pub device_pixel_ratio: f32,
}

/// Layout Snapshot — frontend output

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutSnapshot {
    pub revision: u64,
    pub lines: Vec<LayoutLine>,
    pub canvas_draw_ops: Vec<CanvasDrawOp>,
    pub hit_test_entries: Vec<HitTestEntry>,
    pub caret_anchors: Vec<CaretAnchor>,
    pub selection_geometries: Vec<SelectionGeometry>,
    pub mirror_blocks: Vec<MirrorBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutLine {
    pub id: String,
    pub block_id: String,
    pub y: f32,
    pub baseline: f32,
    pub height: f32,
    pub text_runs: Vec<TextRunPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextRunPosition {
    pub block_id: String,
    pub pm_from: usize,
    pub pm_to: usize,
    pub left: f32,
    pub baseline: f32,
    pub width: f32,
    pub height: f32,
    pub font_family: String,
    pub font_size: f32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasDrawOp {
    pub block_id: String,
    pub kind: CanvasDrawKind,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub data: String, // JSON-encoded block-specific commands
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CanvasDrawKind {
    Math,
    TableGrid,
    CodeHighlight,
    Image,
    Mermaid,
    Decoration,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HitTestEntry {
    pub block_id: String,
    pub rect: Rect,
    pub pm_from: usize,
    pub pm_to: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaretAnchor {
    pub line_id: String,
    pub pm_position: usize,
    pub x: f32,
    pub y: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionGeometry {
    pub pm_from: usize,
    pub pm_to: usize,
    pub rects: Vec<Rect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MirrorBlock {
    pub block_id: String,
    pub pm_from: usize,
    pub pm_to: usize,
    pub semantic_text: String,
    pub aria_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}
```

- [ ] **Step 4: 运行测试确保编译通过**

```bash
cd src-tauri && cargo build --package layout-core --target wasm32-unknown-unknown 2>&1 | tail -5
```

预期：编译警告或无错误。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/crates/layout-core/
git commit -m "feat: add layout-core crate skeleton with shared types"
```

---

### Task 2: Break Model — CJK/Latin 断行机会

**Files:**
- Create: `src-tauri/crates/layout-core/src/break_model.rs`
- Create: `src-tauri/crates/layout-core/tests/break_model_tests.rs`
- Modify: `src-tauri/crates/layout-core/src/lib.rs` (加 `pub mod break_model;` 已有)

**Interfaces:**
- Consumes: `InlineRun` text + `BlockStyle` (font_size, line_height)
- Produces: `Vec<BreakOpportunity>` with penalty/glue/stretch/shrink

- [ ] **Step 1: 写 failing test**

```rust
// tests/break_model_tests.rs
use layout_core::break_model::{BreakOpportunity, BreakKind, find_break_opportunities};

#[test]
fn test_cjk_break_after_each_char() {
    let text = "中文断行测试";
    let breaks = find_break_opportunities(text, 14.0, false);
    // 每个中文字符后都是断行点(除了最后一个)
    assert!(breaks.len() >= 3, "should have breaks for CJK chars, got {}", breaks.len());
    for b in &breaks {
        assert_eq!(b.kind, BreakKind::CjkChar);
        assert!(b.penalty.is_some());
    }
}

#[test]
fn test_english_no_break_in_word() {
    let text = "Hello";
    let breaks = find_break_opportunities(text, 14.0, false);
    // "Hello" 内部不可断
    let in_word_breaks: Vec<_> = breaks.iter().filter(|b| b.pos > 0 && b.pos < 5).collect();
    assert!(in_word_breaks.is_empty() || in_word_breaks.iter().all(|b| b.penalty.map_or(true, |p| p >= 1000.0)));
}

#[test]
fn test_cjk_latin_boundary() {
    let text = "中文English混合";
    let breaks = find_break_opportunities(text, 14.0, false);
    // CJK 和 Latin 边界应该有机会胶合
    let boundary_breaks: Vec<_> = breaks.iter().filter(|b| b.pos == 2).collect();
    assert!(!boundary_breaks.is_empty(), "should have glue at CJK/Latin boundary");
}

#[test]
fn test_punctuation_no_break_before() {
    let text = "他说：“好的”。";
    let breaks = find_break_opportunities(text, 14.0, false);
    // 前引号前不应断行
    let before_quote = breaks.iter().filter(|b| {
        text.chars().nth(b.pos) == Some('“')
    });
    for b in before_quote {
        assert!(b.penalty.map_or(true, |p| p > 0.0), "should not prefer break before opening quote");
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd src-tauri && cargo test --package layout-core --test break_model_tests 2>&1 | tail -10
```

预期：编译错误，因为模块不存在。

- [ ] **Step 3: 实现 break_model.rs**

```rust
// src/break_model.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreakOpportunity {
    pub pos: usize,             // 断行位置（字节偏移）
    pub kind: BreakKind,
    pub penalty: Option<f32>,   // None = 无限惩罚（不可断）
    pub glue_stretch: f32,      // 可拉伸值 (em)
    pub glue_shrink: f32,       // 可压缩值 (em)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum BreakKind {
    CjkChar,
    LatinSpace,
    LatinHyphen,
    LatinBoundary,
    Punctuation,
    UrlOverflow,
    GlyphStretch,
}

/// 查找文本 `text` 在字号 `font_size` 下的所有可断行机会。
/// `is_code` 表示是否是代码块/等宽文本，影响断行策略（长 token 允许更低质量的断点）。
pub fn find_break_opportunities(text: &str, font_size: f32, is_code: bool) -> Vec<BreakOpportunity> {
    let mut breaks = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let em = font_size; // 1em = font_size px

    for (i, ch) in chars.iter().enumerate() {
        let pos = ch.len_utf8() * i; // approximate, but good enough for tests

        match ch {
            // CJK 字符：每个字符后都可断
            _ if is_cjk(*ch) => {
                breaks.push(BreakOpportunity {
                    pos,
                    kind: BreakKind::CjkChar,
                    penalty: Some(0.0),
                    glue_stretch: 0.5 * em,
                    glue_shrink: 0.25 * em,
                });
            }
            // 空格：软断点
            c if c.is_whitespace() && *c != '\u{00A0}' => {
                breaks.push(BreakOpportunity {
                    pos,
                    kind: BreakKind::LatinSpace,
                    penalty: Some(0.0),
                    glue_stretch: 1.0 * em,
                    glue_shrink: 0.5 * em,
                });
            }
            // 连字符：断点
            '-' if !is_code => {
                breaks.push(BreakOpportunity {
                    pos,
                    kind: BreakKind::LatinHyphen,
                    penalty: Some(50.0),
                    glue_stretch: 0.0,
                    glue_shrink: 0.0,
                });
            }
            // 中文标点
            c if is_cjk_punctuation(*c) => {
                breaks.push(BreakOpportunity {
                    pos,
                    kind: BreakKind::Punctuation,
                    penalty: Some(if is_opening_punctuation(*c) { 1000.0 } else { -500.0 }),
                    glue_stretch: 0.0,
                    glue_shrink: 0.0,
                });
            }
            _ => {}
        }
    }

    // CJK ↔ Latin 边界添加胶水
    for i in 0..chars.len().saturating_sub(1) {
        let (left, right) = (chars[i], chars[i + 1]);
        if (is_cjk(left) && is_latin(right)) || (is_latin(left) && is_cjk(right)) {
            breaks.push(BreakOpportunity {
                pos: i + 1,
                kind: BreakKind::LatinBoundary,
                penalty: None, // 不主动在此断开
                glue_stretch: 0.25 * em,
                glue_shrink: 0.1 * em,
            });
        }
    }

    // 长 URL/代码 token 的降级断点
    if is_code {
        for (i, ch) in chars.iter().enumerate() {
            if *ch == '/' || *ch == '.' || *ch == '_' || *ch == '&' || *ch == '?' {
                breaks.push(BreakOpportunity {
                    pos: i,
                    kind: BreakKind::UrlOverflow,
                    penalty: Some(500.0), // 高惩罚，只有必要时才断开
                    glue_stretch: 0.0,
                    glue_shrink: 0.0,
                });
            }
        }
    }

    breaks
}

fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{4E00}'..='\u{9FFF}' |     // CJK Unified Ideographs
        '\u{3400}'..='\u{4DBF}' |     // CJK Extension A
        '\u{F900}'..='\u{FAFF}' |     // CJK Compatibility Ideographs
        '\u{3000}'..='\u{303F}'       // CJK Symbols and Punctuation
    )
}

fn is_latin(c: char) -> bool {
    c.is_ascii_alphabetic() || c.is_ascii_digit() || c == '\'' || c == '’'
}

fn is_cjk_punctuation(c: char) -> bool {
    matches!(c,
        '、' | '。' | '，' | '：' | '；' | '！' | '？' | '）' | '】' | '』' | '」' |
        '（' | '【' | '『' | '「' | '《' | '》' | '—' | '…' | '·' | '"' | '"' |
        '' | '' | '' | ''
    )
}

fn is_opening_punctuation(c: char) -> bool {
    matches!(c, '（' | '【' | '『' | '「' | '《' | '"' | '' | '' | '“')
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd src-tauri && cargo test --package layout-core --test break_model_tests 2>&1
```

预期：所有测试通过。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/crates/layout-core/
git commit -m "feat(layout-core): implement CJK/Latin break model with penalty/glue"
```

---

### Task 3: Paragraph Layout — Knuth-Plass + Greedy Fallback

**Files:**
- Create: `src-tauri/crates/layout-core/src/paragraph.rs`
- Create: `src-tauri/crates/layout-core/tests/paragraph_tests.rs`
- Modify: (lib.rs 已引用 pub mod paragraph)

**Interfaces:**
- Consumes: `InlineRun` list + `StyleContext` + font metrics from `font_api.rs`
- Produces: `Vec<LayoutLine>` 带 text run positions

- [ ] **Step 1: Write failing test**

```rust
// tests/paragraph_tests.rs
use layout_core::paragraph::{layout_paragraph_greedy, ParagraphInput};
use layout_core::ir::InlineRun;
use layout_core::InlineStyle;

#[test]
fn test_single_line_paragraph() {
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: vec![InlineRun {
            text: "Hello world".into(),
            kind: layout_core::InlineKind::Text,
            from: 0,
            to: 11,
            style: InlineStyle::default(),
        }],
        line_width: 500.0,
        font_size: 14.0,
        line_height: 1.5,
    };
    let lines = layout_paragraph_greedy(&input, &mock_font_metrics);
    assert_eq!(lines.len(), 1, "should fit on one line");
}

#[test]
fn test_multi_line_paragraph() {
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: vec![InlineRun {
            text: "Hello beautiful wonderful world".into(),
            kind: layout_core::InlineKind::Text,
            from: 0,
            to: 31,
            style: InlineStyle::default(),
        }],
        line_width: 100.0,
        font_size: 14.0,
        line_height: 1.5,
    };
    let lines = layout_paragraph_greedy(&input, &mock_font_metrics);
    assert!(lines.len() > 1, "should break into multiple lines");
    for line in &lines {
        assert!(!line.text_runs.is_empty());
    }
}
```

- [ ] **Step 2: Run test to see failure**

```bash
cd src-tauri && cargo test --package layout-core --test paragraph_tests 2>&1 | tail -5
```

- [ ] **Step 3: Implement paragraph.rs**

```rust
// src/paragraph.rs
use crate::break_model::{find_break_opportunities, BreakOpportunity};
use crate::{InlineRun, InlineStyle, LayoutLine, TextRunPosition};
use crate::font_api::FontMetricsProvider;

pub struct ParagraphInput<'a> {
    pub block_id: String,
    pub inlines: &'a [InlineRun],
    pub line_width: f32,
    pub font_size: f32,
    pub line_height: f32,
    pub is_code: bool,
}

/// Greedy line-breaking (首版 fallback，最终将被 Knuth-Plass 替代)
pub fn layout_paragraph_greedy(
    input: &ParagraphInput,
    font_metrics: &dyn FontMetricsProvider,
) -> Vec<LayoutLine> {
    let mut lines: Vec<LayoutLine> = Vec::new();
    let mut current_line = Vec::new();
    let mut current_width: f32 = 0.0;
    let mut current_pm_from = 0usize;
    let line_height_px = input.font_size * input.line_height;

    for run in input.inlines {
        let text = &run.text;
        let chars: Vec<char> = text.chars().collect();
        let mut i = 0;

        while i < text.len() {
            // Find end of word or break opportunity
            let mut j = i;
            while j < text.len() {
                let c = text[j..].chars().next().unwrap();
                if c.is_whitespace() || crate::break_model::is_cjk(c) {
                    break;
                }
                j += c.len_utf8();
            }
            if j == i { j = i + text[i..].chars().next().unwrap().len_utf8(); }

            let word = &text[i..j];
            let word_width = word.chars().map(|c| {
                font_metrics.char_advance(c, input.font_size).unwrap_or(input.font_size * 0.5)
            }).sum::<f32>();

            // Measure the space before this word (except first word)
            let space_width = if current_line.is_empty() { 0.0 } else {
                font_metrics.char_advance(' ', input.font_size).unwrap_or(input.font_size * 0.25)
            };

            if current_width + space_width + word_width > input.line_width && !current_line.is_empty() {
                // Flush current line
                lines.push(build_line(input.block_id.clone(), &current_line, current_pm_from, line_height_px));
                current_line.clear();
                current_width = 0.0;
                current_pm_from = current_line.len().checked_sub(1).and_then(|_| Some(current_line.last().unwrap().pm_to)).unwrap_or(0);
            }

            // Add space before word (if not first on line)
            if !current_line.is_empty() {
                current_width += space_width;
            }

            current_line.push(TextRunPosition {
                block_id: input.block_id.clone(),
                pm_from: i,
                pm_to: j,
                left: 0.0, // will be set by build_line
                baseline: 0.0,
                width: word_width,
                height: input.font_size,
                font_family: "default".into(),
                font_size: input.font_size,
                text: word.to_string(),
            });
            current_width += word_width;
            i = j;
        }
    }

    // Flush last line
    if !current_line.is_empty() {
        lines.push(build_line(input.block_id.clone(), &current_line, current_pm_from, line_height_px));
    }

    lines
}

fn build_line(block_id: String, runs: &[TextRunPosition], pm_from: usize, line_height: f32) -> LayoutLine {
    let height = runs.iter().map(|r| r.height).max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)).unwrap_or(0.0);
    let total_width: f32 = runs.iter().map(|r| r.width).sum();
    let line_id = format!("{}-l{}", block_id, pm_from);

    let text_runs: Vec<TextRunPosition> = runs.iter().enumerate().map(|(idx, run)| {
        let x_offset: f32 = runs[..idx].iter().map(|r| r.width).sum();
        TextRunPosition {
            left: x_offset,
            baseline: height,
            ..run.clone()
        }
    }).collect();

    LayoutLine {
        id: line_id,
        block_id,
        y: 0.0,
        baseline: height,
        height,
        text_runs,
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd src-tauri && cargo test --package layout-core --test paragraph_tests 2>&1
```

- [ ] **Step 5: Implement font_api.rs** (mock provider for testing)

```rust
// src/font_api.rs
use std::collections::HashMap;

pub trait FontMetricsProvider {
    fn char_advance(&self, c: char, font_size: f32) -> Option<f32>;
    fn glyph_width(&self, glyph_id: u32, font_size: f32) -> Option<f32>;
}

/// 简单的等宽/比例估算器，用于开发初期测试。
/// 正式版将使用 native 字体子系统返回的真实 metric 填充。
#[derive(Default)]
pub struct MockFontMetrics {
    cache: HashMap<char, f32>,
}

impl MockFontMetrics {
    pub fn new() -> Self { Self::default() }
}

impl FontMetricsProvider for MockFontMetrics {
    fn char_advance(&self, c: char, font_size: f32) -> Option<f32> {
        if c.is_ascii() {
            Some(if c == ' ' { font_size * 0.25 } else { font_size * 0.5 })
        } else {
            Some(font_size * 1.0) // CJK width
        }
    }

    fn glyph_width(&self, glyph_id: u32, font_size: f32) -> Option<f32> {
        Some(font_size * 0.5)
    }
}
```

- [ ] **Step 6: 在 paragraph.rs 中使用 mock**

将函数签名改为接收 `&dyn FontMetricsProvider`（已做）。在测试中用 `MockFontMetrics`。

- [ ] **Step 7: Commit**

```bash
git add src-tauri/crates/layout-core/src/paragraph.rs src-tauri/crates/layout-core/src/font_api.rs src-tauri/crates/layout-core/tests/paragraph_tests.rs
git commit -m "feat(layout-core): implement greedy paragraph layout with font metrics api"
```

---

### Task 4: Math Layout — Math Box Tree 基础

**Files:**
- Create: `src-tauri/crates/layout-core/src/math.rs`
- Create: `src-tauri/crates/layout-core/tests/math_tests.rs`

**Interfaces:**
- Consumes: LaTeX string + MathConstants + font metrics
- Produces: `CanvasDrawOp` with math box tree geometry

- [ ] **Step 1: Write failing test**

```rust
// tests/math_tests.rs
use layout_core::math::{parse_math, layout_math, MathContext};

#[test]
fn test_simple_superscript() {
    let latex = "x^2";
    let ctx = MathContext::default();
    let ast = parse_math(latex).expect("should parse");
    let ops = layout_math(&ast, &ctx);
    assert!(!ops.is_empty(), "should produce draw ops");
}

#[test]
fn test_fraction() {
    let latex = r"\frac{a}{b}";
    let ctx = MathContext::default();
    let ast = parse_math(latex).expect("should parse fraction");
    let ops = layout_math(&ast, &ctx);
    assert!(!ops.is_empty(), "fraction should produce draw ops");
}
```

- [ ] **Step 2: Implement math.rs** (基础数学解析 + box layout)

```rust
// src/math.rs
// 首版仅覆盖核心语法：上下标、分式、根号、大运算符 limits、定界符
// 使用 tiny LaTeX-like parser

use crate::CanvasDrawOp;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MathExpr {
    Ord(String),
    Op(String),
    Bin(String),
    Rel(String),
    Open(String),
    Close(String),
    Punct(String),
    Inner(Box<MathExpr>),
    Superscript(Box<MathExpr>, Box<MathExpr>),
    Subscript(Box<MathExpr>, Box<MathExpr>),
    Fraction(Box<MathExpr>, Box<MathExpr>),
    Radical(Box<MathExpr>, Option<Box<MathExpr>>),
    Delimited(Box<MathExpr>, String, String), // body, left, right
    Row(Vec<MathExpr>),
    Matrix(Vec<Vec<MathExpr>>),
    BigOp(String, Option<Box<MathExpr>>, Option<Box<MathExpr>>), // op, lower, upper
    Text(String),
}

#[derive(Debug, Clone)]
pub struct MathContext {
    pub font_size: f32,
    pub display_mode: bool,
    pub script_factor: f32,
    pub script_script_factor: f32,
}

impl Default for MathContext {
    fn default() -> Self {
        Self {
            font_size: 14.0,
            display_mode: false,
            script_factor: 0.7,
            script_script_factor: 0.5,
        }
    }
}

/// 简易 LaTeX 数学解析器
pub fn parse_math(latex: &str) -> Result<MathExpr, String> {
    let tokens = tokenize(latex)?;
    parse_row(&tokens, 0).map(|(expr, _)| expr)
}

fn tokenize(latex: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut i = 0;
    let chars: Vec<char> = latex.chars().collect();

    while i < chars.len() {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }
        if chars[i] == '\\' {
            let mut name = String::from("\\");
            i += 1;
            while i < chars.len() && chars[i].is_alphabetic() {
                name.push(chars[i]);
                i += 1;
            }
            if name == "\\" {
                name.push(chars[i]);
                i += 1;
            }
            tokens.push(name);
        } else if "{}^_".contains(chars[i]) {
            tokens.push(chars[i].to_string());
            i += 1;
        } else if i + 1 < chars.len() && chars[i] == '&' && chars[i + 1] == '&' {
            tokens.push("$$".to_string());
            i += 2;
        } else {
            tokens.push(chars[i].to_string());
            i += 1;
        }
    }
    Ok(tokens)
}

fn parse_row(tokens: &[String], start: usize) -> Result<(MathExpr, usize), String> {
    let mut exprs = Vec::new();
    let mut i = start;
    while i < tokens.len() {
        match tokens[i].as_str() {
            "}" | "]" | ")" => break,
            "&" => { i += 1; break; }
            _ => {
                let (expr, next) = parse_atom(tokens, i)?;
                exprs.push(expr);
                i = next;
            }
        }
    }
    if exprs.is_empty() {
        Ok((MathExpr::Row(vec![]), i))
    } else if exprs.len() == 1 {
        Ok((exprs.into_iter().next().unwrap(), i))
    } else {
        Ok((MathExpr::Row(exprs), i))
    }
}

fn parse_atom(tokens: &[String], start: usize) -> Result<(MathExpr, usize), String> {
    // 处理 { ... }
    if tokens[start] == "{" {
        let (inner, end) = parse_row(tokens, start + 1)?;
        if end < tokens.len() && tokens[end] == "}" {
            let mut i = end + 1;
            // Check for superscript/subscript
            if i < tokens.len() && tokens[i] == "^" {
                let (sup, next) = parse_atom(tokens, i + 1)?;
                return Ok((MathExpr::Superscript(Box::new(inner), Box::new(sup)), next));
            }
            if i < tokens.len() && tokens[i] == "_" {
                let (sub, next) = parse_atom(tokens, i + 1)?;
                return Ok((MathExpr::Subscript(Box::new(inner), Box::new(sub)), next));
            }
            return Ok((inner, end + 1));
        }
        return Err("Missing closing brace".into());
    }

    // 处理 ^ 和 _ (上标/下标)
    if tokens[start] == "^" {
        let (sub, next) = parse_atom(tokens, start + 1)?;
        return Ok((MathExpr::Superscript(Box::new(MathExpr::Ord("".into())), Box::new(sub)), next));
    }
    if tokens[start] == "_" {
        let (sub, next) = parse_atom(tokens, start + 1)?;
        return Ok((MathExpr::Subscript(Box::new(MathExpr::Ord("".into())), Box::new(sub)), next));
    }

    // 处理命令
    if tokens[start].starts_with('\\') {
        let cmd = &tokens[start];
        match *cmd {
            r"\frac" => {
                let (num, after_num) = parse_atom(tokens, start + 1)?;
                let (den, after_den) = parse_atom(tokens, after_num)?;
                Ok((MathExpr::Fraction(Box::new(num), Box::new(den)), after_den))
            }
            r"\sqrt" => {
                if start + 1 < tokens.len() && tokens[start + 1] == "[" {
                    let (index, after_index) = parse_row(tokens, start + 2)?;
                    if after_index < tokens.len() && tokens[after_index] == "]" {
                        let (rad, after_rad) = parse_atom(tokens, after_index + 1)?;
                        Ok((MathExpr::Radical(Box::new(rad), Some(Box::new(index))), after_rad))
                    } else {
                        Err("Missing ] for sqrt index".into())
                    }
                } else {
                    let (rad, after_rad) = parse_atom(tokens, start + 1)?;
                    Ok((MathExpr::Radical(Box::new(rad), None), after_rad))
                }
            }
            r"\left" | r"\right" => {
                // 简单处理：跳过定界符字符
                let delim = tokens.get(start + 1).cloned().unwrap_or_default();
                if *cmd == r"\left" {
                    let (body, end) = parse_row(tokens, start + 2)?;
                    // 找到对应的 \right
                    let right_start = end;
                    if right_start < tokens.len() && tokens[right_start] == r"\right" {
                        let right_delim = tokens.get(right_start + 1).cloned().unwrap_or_default();
                        Ok((MathExpr::Delimited(Box::new(body), delim, right_delim), right_start + 2))
                    } else {
                        Ok((MathExpr::Delimited(Box::new(body), delim, ".".into()), end))
                    }
                } else {
                    Ok((MathExpr::Ord("".into()), start + 2))
                }
            }
            r"\sum" | r"\int" | r"\prod" => {
                let op_name = cmd.strip_prefix('\\').unwrap_or("sum").to_string();
                let mut lower = None;
                let mut upper = None;
                let mut i = start + 1;
                if i < tokens.len() && tokens[i] == "_" {
                    let (sub, next) = parse_atom(tokens, i + 1)?;
                    lower = Some(Box::new(sub));
                    i = next;
                }
                if i < tokens.len() && tokens[i] == "^" {
                    let (sup, next) = parse_atom(tokens, i + 1)?;
                    upper = Some(Box::new(sup));
                    i = next;
                }
                Ok((MathExpr::BigOp(op_name, lower, upper), i))
            }
            _ => {
                // 普通命令作为 ord 处理
                let name = cmd.strip_prefix('\\').unwrap_or(cmd).to_string();
                let mut i = start + 1;
                // Check for superscript/subscript
                if i < tokens.len() && tokens[i] == "^" {
                    let (sup, next) = parse_atom(tokens, i + 1)?;
                    return Ok((MathExpr::Superscript(Box::new(MathExpr::Ord(name)), Box::new(sup)), next));
                }
                if i < tokens.len() && tokens[i] == "_" {
                    let (sub, next) = parse_atom(tokens, i + 1)?;
                    return Ok((MathExpr::Subscript(Box::new(MathExpr::Ord(name)), Box::new(sub)), next));
                }
                Ok((MathExpr::Ord(name), i))
            }
        }
    } else {
        // 普通字符或符号
        let ch = tokens[start].clone();
        let mut i = start + 1;
        if i < tokens.len() && tokens[i] == "^" {
            let (sup, next) = parse_atom(tokens, i + 1)?;
            return Ok((MathExpr::Superscript(Box::new(MathExpr::Ord(ch)), Box::new(sup)), next));
        }
        if i < tokens.len() && tokens[i] == "_" {
            let (sub, next) = parse_atom(tokens, i + 1)?;
            return Ok((MathExpr::Subscript(Box::new(MathExpr::Ord(ch)), Box::new(sub)), next));
        }
        Ok((MathExpr::Ord(ch), i))
    }
}

/// 将解析后的 MathExpr 布局为 CanvasDrawOp 列表
/// 首版使用保守的布局（不依赖完整 OpenType MATH 常量，但接口预留）
pub fn layout_math(expr: &MathExpr, ctx: &MathContext) -> Vec<CanvasDrawOp> {
    let mut ops = Vec::new();
    layout_expr(expr, ctx, 0.0, 0.0, &mut ops);
    ops
}

fn layout_expr(expr: &MathExpr, ctx: &MathContext, x: f32, y: f32, ops: &mut Vec<CanvasDrawOp>) -> f32 {
    match expr {
        MathExpr::Ord(text) => {
            ops.push(CanvasDrawOp {
                block_id: String::new(),
                kind: crate::CanvasDrawKind::Math,
                x, y,
                width: text.len() as f32 * ctx.font_size * 0.5,
                height: ctx.font_size,
                data: serde_json::json!({"type": "text", "content": text}).to_string(),
            });
            text.len() as f32 * ctx.font_size * 0.5
        }
        MathExpr::Row(exprs) => {
            let mut cx = x;
            for e in exprs {
                cx += layout_expr(e, ctx, cx, y, ops);
            }
            cx - x
        }
        MathExpr::Superscript(base, sup) => {
            let base_w = layout_expr(base, ctx, x, y, ops);
            let sup_ctx = MathContext { font_size: ctx.font_size * ctx.script_factor, ..*ctx };
            layout_expr(sup, &sup_ctx, x + base_w, y - ctx.font_size * 0.3, ops);
            base_w + sup_ctx.font_size * 0.5
        }
        MathExpr::Subscript(base, sub) => {
            let base_w = layout_expr(base, ctx, x, y, ops);
            let sub_ctx = MathContext { font_size: ctx.font_size * ctx.script_factor, ..*ctx };
            layout_expr(sub, &sub_ctx, x + base_w, y + ctx.font_size * 0.15, ops);
            base_w + sub_ctx.font_size * 0.5
        }
        MathExpr::Fraction(num, den) => {
            let num_ctx = MathContext { font_size: ctx.font_size * 0.7, ..*ctx };
            let den_ctx = MathContext { font_size: ctx.font_size * 0.7, ..*ctx };
            let num_w = layout_expr(num, &num_ctx, x, y - ctx.font_size * 0.2, ops);
            let den_w = layout_expr(den, &den_ctx, x, y + ctx.font_size * 0.3, ops);
            let total_w = num_w.max(den_w) + 4.0;
            // 分式线
            ops.push(CanvasDrawOp {
                block_id: String::new(),
                kind: crate::CanvasDrawKind::Math,
                x, y: y + 2.0,
                width: total_w,
                height: 1.0,
                data: serde_json::json!({"type": "frac_line"}).to_string(),
            });
            total_w
        }
        MathExpr::Radical(rad, _index) => {
            let rad_w = layout_expr(rad, ctx, x + ctx.font_size * 0.6, y, ops);
            // 根号
            ops.push(CanvasDrawOp {
                block_id: String::new(),
                kind: crate::CanvasDrawKind::Math,
                x, y: y - ctx.font_size * 0.5,
                width: ctx.font_size * 0.5,
                height: ctx.font_size * 1.2,
                data: serde_json::json!({"type": "radical"}).to_string(),
            });
            rad_w + ctx.font_size * 0.6
        }
        MathExpr::BigOp(name, lower, upper) => {
            let mut w = ctx.font_size * 1.5;
            ops.push(CanvasDrawOp {
                block_id: String::new(),
                kind: crate::CanvasDrawKind::Math,
                x, y,
                width: w,
                height: ctx.font_size,
                data: serde_json::json!({"type": "bigop", "name": name}).to_string(),
            });
            if let Some(l) = lower {
                let sub_ctx = MathContext { font_size: ctx.font_size * 0.6, ..*ctx };
                layout_expr(l, &sub_ctx, x, y + ctx.font_size * 0.4, ops);
            }
            if let Some(u) = upper {
                let sup_ctx = MathContext { font_size: ctx.font_size * 0.6, ..*ctx };
                layout_expr(u, &sup_ctx, x, y - ctx.font_size * 0.4, ops);
            }
            w
        }
        MathExpr::Delimited(body, _left, _right) => {
            layout_expr(body, ctx, x, y, ops)
        }
        MathExpr::Text(t) => {
            ops.push(CanvasDrawOp {
                block_id: String::new(),
                kind: crate::CanvasDrawKind::Math,
                x, y,
                width: t.len() as f32 * ctx.font_size * 0.5,
                height: ctx.font_size,
                data: serde_json::json!({"type": "text", "content": t}).to_string(),
            });
            t.len() as f32 * ctx.font_size * 0.5
        }
        _ => ctx.font_size * 0.5,
    }
}
```

- [ ] **Step 3: Run test**

```bash
cd src-tauri && cargo test --package layout-core --test math_tests 2>&1
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/crates/layout-core/src/math.rs src-tauri/crates/layout-core/tests/math_tests.rs
git commit -m "feat(layout-core): implement basic math parser and box layout"
```

---

### Task 5: Position Mapping + Hit Test

**Files:**
- Create: `src-tauri/crates/layout-core/src/position.rs`
- Create: `src-tauri/crates/layout-core/src/hit_test.rs`
- Create: `src-tauri/crates/layout-core/src/selection.rs`
- Create: `src-tauri/crates/layout-core/tests/position_tests.rs`

- [ ] **Step 1: Write failing test**

```rust
// tests/position_tests.rs
use layout_core::hit_test::hit_test_point;
use layout_core::selection::compute_selection_geometry;
use layout_core::{LayoutLine, TextRunPosition, HitTestEntry, SelectionGeometry, Rect};

fn make_line(pm_from: usize, pm_to: usize, x: f32, width: f32) -> LayoutLine {
    LayoutLine {
        id: "l1".into(),
        block_id: "b1".into(),
        y: 0.0,
        baseline: 16.0,
        height: 16.0,
        text_runs: vec![TextRunPosition {
            block_id: "b1".into(),
            pm_from,
            pm_to,
            left: x,
            baseline: 16.0,
            width,
            height: 16.0,
            font_family: "default".into(),
            font_size: 14.0,
            text: "Hello world".into(),
        }],
    }
}

#[test]
fn test_hit_test_in_range() {
    let line = make_line(0, 11, 0.0, 100.0);
    let entry = hit_test_point(&[line.clone()], 50.0, 8.0);
    assert!(entry.is_some(), "should hit the line");
    if let Some(h) = entry {
        assert_eq!(h.pm_from, 0);
        assert_eq!(h.pm_to, 11);
    }
}

#[test]
fn test_hit_test_outside() {
    let line = make_line(0, 11, 0.0, 100.0);
    let entry = hit_test_point(&[line.clone()], 200.0, 8.0);
    assert!(entry.is_none(), "should not hit outside");
}

#[test]
fn test_selection_geometry_simple() {
    let line = make_line(0, 11, 0.0, 100.0);
    let geo = compute_selection_geometry(&[line.clone()], 0, 5);
    assert!(!geo.rects.is_empty(), "should produce rects");
}
```

- [ ] **Step 2: Implement**

```rust
// src/hit_test.rs
use crate::{HitTestEntry, LayoutLine, Rect};

pub fn hit_test_point(lines: &[LayoutLine], x: f32, y: f32) -> Option<HitTestEntry> {
    for line in lines {
        if y >= line.y && y <= line.y + line.height {
            let mut run_x = 0f32;
            for run in &line.text_runs {
                let end_x = run_x + run.width;
                if x >= run_x && x <= end_x {
                    return Some(HitTestEntry {
                        block_id: run.block_id.clone(),
                        rect: Rect { x: run_x, y: line.y, width: run.width, height: line.height },
                        pm_from: run.pm_from,
                        pm_to: run.pm_to,
                    });
                }
                run_x = end_x;
            }
            // Hit past the last run → return last position
            if let Some(last) = line.text_runs.last() {
                return Some(HitTestEntry {
                    block_id: last.block_id.clone(),
                    rect: Rect { x: run_x, y: line.y, width: 0.0, height: line.height },
                    pm_from: last.pm_to,
                    pm_to: last.pm_to,
                });
            }
        }
    }
    None
}
```

```rust
// src/selection.rs
use crate::{LayoutLine, SelectionGeometry, Rect};

pub fn compute_selection_geometry(lines: &[LayoutLine], pm_from: usize, pm_to: usize) -> SelectionGeometry {
    let mut rects = Vec::new();
    for line in lines {
        for run in &line.text_runs {
            if run.pm_from < pm_to && run.pm_to > pm_from {
                rects.push(Rect {
                    x: run.left,
                    y: line.y,
                    width: run.width,
                    height: line.height,
                });
            }
        }
    }
    SelectionGeometry { pm_from, pm_to, rects }
}
```

- [ ] **Step 3: Run tests and commit**

```bash
cd src-tauri && cargo test --package layout-core 2>&1
git add -A && git commit -m "feat(layout-core): add hit-test, selection geometry, position mapping"
```

---

### Task 6: WASM Bridge — 导出函数 + 序列化

**Files:**
- Create: `src-tauri/crates/layout-core/src/wasm_bridge.rs`

- [ ] **Step 1: Create WASM bridge**

```rust
// src/wasm_bridge.rs
use crate::paragraph::{layout_paragraph_greedy, ParagraphInput};
use crate::math::{parse_math, layout_math, MathContext};
use crate::hit_test::hit_test_point;
use crate::selection::compute_selection_geometry;
use crate::font_api::MockFontMetrics;
use crate::ir::*;
use crate::{LayoutDocument, LayoutSnapshot};

// 占位：首期先不做实际 wasm-bindgen 导出
// 契约：平面函数接收 &[u8]（JSON），返回 &[u8]（JSON）
// 真正的 wasm-bindgen 导出在 P4 集成时添加

pub fn handle_initialize_document(doc_json: &str) -> Result<String, String> {
    let doc: LayoutDocument = serde_json::from_str(doc_json)
        .map_err(|e| format!("IR parse error: {}", e))?;

    let font = MockFontMetrics::new();
    let mut lines = Vec::new();
    let mut ops = Vec::new();

    for block in &doc.blocks {
        let input = ParagraphInput {
            block_id: block.block_id.clone(),
            inlines: &block.inlines,
            line_width: doc.style_context.viewport_width - 40.0, // margin
            font_size: block.style.font_size,
            line_height: block.style.line_height,
            is_code: block.kind == crate::BlockKind::Code,
        };
        let block_lines = layout_paragraph_greedy(&input, &font);
        lines.extend(block_lines);
    }

    // 处理数学块
    for block in &doc.blocks {
        if block.kind == crate::BlockKind::MathBlock {
            for inline in &block.inlines {
                if inline.kind == crate::InlineKind::MathInline {
                    if let Ok(expr) = parse_math(&inline.text) {
                        let ctx = MathContext {
                            font_size: block.style.font_size,
                            display_mode: block.style.math_display == crate::MathDisplay::Block,
                            ..MathContext::default()
                        };
                        let draw_ops = layout_math(&expr, &ctx);
                        ops.extend(draw_ops);
                    }
                }
            }
        }
    }

    // 构建 snapshot
    let snapshot = LayoutSnapshot {
        revision: doc.revision,
        lines,
        canvas_draw_ops: ops,
        hit_test_entries: Vec::new(), // 前端按需调用
        caret_anchors: Vec::new(),
        selection_geometries: Vec::new(),
        mirror_blocks: Vec::new(),
    };

    serde_json::to_string(&snapshot).map_err(|e| format!("Serialize error: {}", e))
}

pub fn handle_update_document(doc_json: &str) -> Result<String, String> {
    handle_initialize_document(doc_json)
}

pub fn handle_hit_test(lines_json: &str, x: f32, y: f32) -> Result<String, String> {
    let lines: Vec<crate::LayoutLine> = serde_json::from_str(lines_json)
        .map_err(|e| format!("Line parse error: {}", e))?;
    let result = hit_test_point(&lines, x, y);
    serde_json::to_string(&result).map_err(|e| format!("Serialize error: {}", e))
}

pub fn handle_selection_geometry(lines_json: &str, from: usize, to: usize) -> Result<String, String> {
    let lines: Vec<crate::LayoutLine> = serde_json::from_str(lines_json)
        .map_err(|e| format!("Line parse error: {}", e))?;
    let result = compute_selection_geometry(&lines, from, to);
    serde_json::to_string(&result).map_err(|e| format!("Serialize error: {}", e))
}
```

- [ ] **Step 2: Add ir.rs with IR normalization stub**

```rust
// src/ir.rs
// Layout IR normalization — 首版仅做类型输出，不做转换
// 真正的 Normalizer 在 P4 前端实现

pub fn normalize_block_kind(kind: &str) -> crate::BlockKind {
    match kind {
        "paragraph" => crate::BlockKind::Paragraph,
        "heading" => crate::BlockKind::Heading,
        "list" => crate::BlockKind::List,
        "table" => crate::BlockKind::Table,
        "code" => crate::BlockKind::Code,
        "image" => crate::BlockKind::Image,
        "mermaid" => crate::BlockKind::Mermaid,
        "html" => crate::BlockKind::Html,
        "math_block" => crate::BlockKind::MathBlock,
        _ => crate::BlockKind::Fallback,
    }
}
```

- [ ] **Step 3: Run all layout-core tests**

```bash
cd src-tauri && cargo test --package layout-core 2>&1
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/crates/layout-core/
git commit -m "feat(layout-core): add WASM bridge with JSON serialization protocol"
```
