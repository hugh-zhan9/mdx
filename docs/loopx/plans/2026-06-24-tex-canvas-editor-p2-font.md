# P2: Rust Native 字体子系统

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/TeX风格Canvas自绘编辑器需求设计文档.md`
**Master plan:** `docs/loopx/plans/2026-06-24-tex-canvas-editor-master.md`

**Goal:** 实现 Rust native 字体子系统，通过 Tauri command 暴露系统字体发现、fallback chain 构建、OpenType MATH 表解析和 glyph metric 缓存。前端通过 3 个 Tauri command (`font_init_subsystem`、`font_get_glyph_metrics`、`font_get_math_constants`) 一次性获取数据后在前端/WASM 侧缓存。

**Architecture:** 纯 Rust crate `font-core` (crate-type = ["lib", "staticlib"] )，macOS 首版用 CoreText + ttf-parser。字体数据一次性拉取到前端，后续热路径不再跨 IPC。

**Shared contract:** FontInitResult / FontDescriptor / GlyphMetrics / MathConstants — 见 master plan 接口合同。

**Tech Stack:** Rust (edition 2021), ttf-parser, CoreText (macOS via objc2), font-kit (跨平台 fallback)

**Support lenses:** none

## 全局约束

- 极小依赖面、优先纯 Rust。
- macOS 首版，架构预留跨平台 platform adapter。
- 字体数据一次性拉取，前端/WASM 侧缓存；字体变更时重新拉取。
- OpenType MATH 表解析需要从 ttf-parser 读取 `MATH` 标签表。
- 系统字体发现优先使用 CoreText (macOS)，font-kit 作为跨平台备选。

---

## 文件结构

```
src-tauri/crates/font-core/
├── Cargo.toml
├── src/
│   ├── lib.rs           # 接口定义 + 序列化类型
│   ├── discovery.rs     # 系统字体发现
│   ├── math_table.rs    # OpenType MATH 表解析
│   ├── glyph.rs         # glyph metric 缓存
│   ├── fallback.rs      # fallback chain 构建
│   └── shaper.rs        # glyph shaping 接口（预留）
├── tests/
│   ├── discovery_tests.rs
│   ├── math_table_tests.rs
│   └── glyph_tests.rs
```

---

### Task 1: Cargo.toml + 共享类型定义

**Files:**
- Create: `src-tauri/crates/font-core/Cargo.toml`
- Create: `src-tauri/crates/font-core/src/lib.rs`

**Interfaces:**
- Produces: `FontInitResult`, `FontDescriptor`, `GlyphMetrics`, `MathConstants`

- [ ] **Step 1: 创建 Cargo.toml**

```toml
[package]
name = "font-core"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["lib", "staticlib"]

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
ttf-parser = "0.21"
font-kit = "0.13"
log = "0.4"

[target.'cfg(target_os = "macos")'.dependencies]
core-foundation = "0.10"
core-text = "0.20"

[dev-dependencies]
```

- [ ] **Step 2: 创建 lib.rs** — 字体子系统接口类型

```rust
pub mod discovery;
pub mod math_table;
pub mod glyph;
pub mod fallback;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use parking_lot::RwLock;

/// --- 公开接口类型 ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FontInitResult {
    pub default_fonts: Vec<FontDescriptor>,
    pub fallback_chain: Vec<String>,     // font postscript names
    pub system_metrics: SystemMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FontDescriptor {
    pub font_id: String,                  // 内部唯一 ID
    pub family_name: String,
    pub weight: u16,                      // CSS weight
    pub style: String,                    // "normal", "italic", "oblique"
    pub postscript_name: String,
    pub math_available: bool,             // 是否含有 MATH 表
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetrics {
    pub font_count: usize,
    pub math_font_count: usize,
    pub default_font_size: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlyphMetricsMap {
    pub entries: Vec<GlyphMetricsEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlyphMetricsEntry {
    pub glyph_id: u32,
    pub advance: f32,
    pub x_min: f32,
    pub y_min: f32,
    pub x_max: f32,
    pub y_max: f32,
    pub bearing_x: f32,
    pub bearing_y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlyphMetricsRequest {
    pub font_id: String,
    pub glyph_ids: Vec<u32>,
    pub font_size: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MathConstantsCache {
    pub font_id: String,
    pub constants: MathConstants,
    pub glyph_assemblies: Vec<GlyphAssembly>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MathConstants {
    pub subscript_shift_down: f32,
    pub superscript_shift_up: f32,
    pub subscript_drop: f32,
    pub superscript_drop: f32,
    pub fraction_numerator_shift_up: f32,
    pub fraction_numerator_display_style_shift_up: f32,
    pub fraction_denominator_shift_down: f32,
    pub fraction_denominator_display_style_shift_down: f32,
    pub fraction_numerator_gap_min: f32,
    pub fraction_rule_thickness: f32,
    pub fraction_denominator_gap_min: f32,
    pub radical_extra_ascender: f32,
    pub radical_rule_thickness: f32,
    pub radical_vertical_gap: f32,
    pub accent_base_height: f32,
    pub display_operator_min_height: f32,
    pub stack_top_shift_up: f32,
    pub stack_bottom_shift_down: f32,
    pub stack_gap_min: f32,
    pub stretch_stack_top_shift_up: f32,
    pub stretch_stack_bottom_shift_down: f32,
    pub stretch_stack_gap_above_min: f32,
    pub stretch_stack_gap_below_min: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlyphAssembly {
    pub glyph_id: u32,
    pub parts: Vec<GlyphPart>,
    pub italics_correction: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlyphPart {
    pub glyph_id: u32,
    pub start_connector_length: f32,
    pub end_connector_length: f32,
    pub full_advance: f32,
    pub part_flags: u16,
}

/// --- 内部状态 ---

pub(crate) struct FontSystem {
    pub(crate) fonts: Vec<LoadedFont>,
    pub(crate) metrics_cache: lru::LruCache<(String, u32, f32), GlyphMetricsEntry>,
    pub(crate) math_cache: lru::LruCache<String, MathConstants>,
}

pub(crate) struct LoadedFont {
    pub descriptor: FontDescriptor,
    pub font_data: Vec<u8>,
    pub face: ttf_parser::Face<'static>,
}

impl FontSystem {
    pub fn new() -> Self {
        Self {
            fonts: Vec::new(),
            metrics_cache: lru::LruCache::new(5000),
            math_cache: lru::LruCache::new(50),
        }
    }
}
```

- [ ] **Step 3: 把 parking_lot 加入依赖**

```toml
# Cargo.toml — 追加
parking_lot = "0.12"
lru = "0.12"
```

- [ ] **Step 4: 验证编译**

```bash
cd src-tauri && cargo check --package font-core 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/crates/font-core/Cargo.toml src-tauri/crates/font-core/src/lib.rs
git commit -m "feat(font-core): add font subsystem crate with shared types"
```

---

### Task 2: 系统字体发现 (macOS CoreText)

**Files:**
- Create: `src-tauri/crates/font-core/src/discovery.rs`
- Create: `src-tauri/crates/font-core/tests/discovery_tests.rs`

**Interfaces:**
- `pub fn discover_system_fonts() -> Vec<FontDescriptor>`
- `pub fn get_default_font() -> Option<FontDescriptor>`

- [ ] **Step 1: Write failing test**

```rust
// tests/discovery_tests.rs
use font_core::discovery::{discover_system_fonts, get_default_font};

#[test]
fn test_discover_fonts() {
    let fonts = discover_system_fonts();
    assert!(!fonts.is_empty(), "should find at least some system fonts");
}

#[test]
fn test_default_font() {
    let default = get_default_font();
    assert!(default.is_some(), "should have a default system font");
}

#[test]
fn test_math_font_detection() {
    let fonts = discover_system_fonts();
    let math_fonts: Vec<_> = fonts.iter().filter(|f| f.math_available).collect();
    // 至少应该有一个带有 MATH 表的字体（如 Latin Modern Math 或者 STIX Two Math）
    assert!(!math_fonts.is_empty(), "should find at least one math font");
}
```

- [ ] **Step 2: 实现 discovery.rs** (macOS CoreText 优先 + font-kit fallback)

```rust
// src/discovery.rs
use crate::{FontDescriptor, LoadedFont};
use std::collections::HashSet;

#[cfg(target_os = "macos")]
mod platform {
    use core_text::font_collection::create_system_font_descriptors;
    use crate::FontDescriptor;
    use ttf_parser::Face;

    pub fn discover_system_fonts() -> Vec<FontDescriptor> {
        let mut descriptors = Vec::new();
        let mut seen_postscript = HashSet::new();

        // 方法 1: CoreText 系统字体
        if let Ok(fonts) = core_text::font_collection::get_family_names() {
            for family_name in &fonts {
                if let Some(family) = core_text::font_collection::create_for_family(family_name) {
                    if let Some(descriptors_array) = family.font_descriptors() {
                        for desc in &descriptors_array {
                            if let (Some(ps_name), Some(family_name)) =
                                (desc.font_name(), desc.family_name())
                            {
                                if seen_postscript.insert(ps_name.clone()) {
                                    let math_available = check_math_table(&desc);
                                    descriptors.push(FontDescriptor {
                                        font_id: ps_name.clone(),
                                        family_name: family_name.to_string(),
                                        weight: desc.symbolic_traits().bits() as u16,
                                        style: "normal".into(),
                                        postscript_name: ps_name.to_string(),
                                        math_available,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        descriptors
    }

    fn check_math_table(desc: &core_text::font_descriptor::CTFontDescriptor) -> bool {
        // 通过 CTFont 打开并检查 MATH 表
        if let Some(ct_font) = desc.copy_to_ct_font() {
            // 获取字体数据
            if let Some(data) = ct_font.font_data() {
                let data_ref: &[u8] = &data;
                if let Ok(face) = Face::from_slice(data_ref, 0) {
                    return face.tables().math_table().is_some();
                }
            }
        }
        false
    }

    pub fn get_default_font() -> Option<FontDescriptor> {
        let body_family = core_text::font_descriptor::new_from_family("Helvetica Neue")
            .or_else(|| core_text::font_descriptor::new_from_family("SF Pro"))
            .or_else(|| core_text::font_descriptor::new_from_family("Helvetica"));

        body_family.and_then(|desc| {
            desc.font_name().map(|ps_name| FontDescriptor {
                font_id: ps_name.to_string(),
                family_name: desc.family_name().map(|s| s.to_string()).unwrap_or_default(),
                weight: 400,
                style: "normal".into(),
                postscript_name: ps_name.to_string(),
                math_available: check_math_table(&desc),
            })
        })
    }
}

pub use platform::*;
```

- [ ] **Step 3: 运行测试**

```bash
cd src-tauri && cargo test --package font-core --test discovery_tests 2>&1
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/crates/font-core/src/discovery.rs src-tauri/crates/font-core/tests/discovery_tests.rs
git commit -m "feat(font-core): implement macOS system font discovery with MATH table detection"
```

---

### Task 3: OpenType MATH 表解析

**Files:**
- Create: `src-tauri/crates/font-core/src/math_table.rs`
- Create: `src-tauri/crates/font-core/tests/math_table_tests.rs`

**Interfaces:**
- `pub fn parse_math_table(face: &Face) -> Result<MathConstants, String>`
- `pub fn parse_glyph_assembly(face: &Face, glyph_id: u32) -> Option<GlyphAssembly>`

- [ ] **Step 1: Write failing test**

```rust
// tests/math_table_tests.rs
use font_core::math_table::{parse_math_table, parse_glyph_assembly};
use font_core::MathConstants;

#[test]
fn test_parse_math_table_from_font_file() {
    // 用 ttf_parser 直接从系统字体文件读 MATH 表
    // 假设系统有 Latin Modern Math 或 STIX Two Math
    let font_files = find_math_fonts();
    assert!(!font_files.is_empty(), "need a math font for testing");

    for path in &font_files {
        let data = std::fs::read(path).expect("should read font file");
        let face = ttf_parser::Face::from_slice(&data, 0).expect("should parse face");
        if let Some(constants) = parse_math_table(&face) {
            assert!(constants.fraction_rule_thickness > 0.0);
            assert!(constants.superscript_shift_up > 0.0);
            assert!(constants.display_operator_min_height > 0.0);
            return;
        }
    }
    panic!("no font with valid MATH table found");
}

fn find_math_fonts() -> Vec<std::path::PathBuf> {
    let mut results = Vec::new();
    let dirs = vec!["/System/Library/Fonts", "/Library/Fonts"];

    for dir in &dirs {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.to_string_lossy().to_lowercase();
                if name.contains("math") && (name.ends_with(".otf") || name.ends_with(".ttf")) {
                    results.push(path);
                }
            }
        }
    }

    // Fallback: hardcoded paths
    results
}
```

- [ ] **Step 2: Implement math_table.rs**

```rust
// src/math_table.rs
use ttf_parser::{Face, math::MathTable};
use crate::MathConstants;

pub fn parse_math_table(face: &Face) -> Option<MathConstants> {
    let math = face.tables().math_table()?;

    Some(MathConstants {
        subscript_shift_down: math.subscript_shift_down().unwrap_or(0.0) as f32,
        superscript_shift_up: math.superscript_shift_up().unwrap_or(0.0) as f32,
        subscript_drop: math.subscript_drop().unwrap_or(0.0) as f32,
        superscript_drop: math.superscript_drop().unwrap_or(0.0) as f32,
        fraction_numerator_shift_up: math.fraction_numerator_shift_up().map(|v| v.shift_up()).unwrap_or(0.0) as f32,
        fraction_numerator_display_style_shift_up: math.fraction_numerator_display_style_shift_up().map(|v| v.shift_up()).unwrap_or(0.0) as f32,
        fraction_denominator_shift_down: math.fraction_denominator_shift_down().map(|v| v.shift_down()).unwrap_or(0.0) as f32,
        fraction_denominator_display_style_shift_down: math.fraction_denominator_display_style_shift_down().map(|v| v.shift_down()).unwrap_or(0.0) as f32,
        fraction_numerator_gap_min: math.fraction_numerator_gap_min().map(|v| v.gap_min()).unwrap_or(0.0) as f32,
        fraction_rule_thickness: math.fraction_rule_thickness().unwrap_or(0.0) as f32,
        fraction_denominator_gap_min: math.fraction_denominator_gap_min().map(|v| v.gap_min()).unwrap_or(0.0) as f32,
        radical_extra_ascender: math.radical_extra_ascender().unwrap_or(0.0) as f32,
        radical_rule_thickness: math.radical_rule_thickness().unwrap_or(0.0) as f32,
        radical_vertical_gap: math.radical_vertical_gap().map(|v| v.vertical_gap()).unwrap_or(0.0) as f32,
        accent_base_height: math.accent_base_height().unwrap_or(0.0) as f32,
        display_operator_min_height: math.display_operator_min_height().unwrap_or(0.0) as f32,
        stack_top_shift_up: math.stack_top_shift_up().unwrap_or(0.0) as f32,
        stack_bottom_shift_down: math.stack_bottom_shift_down().unwrap_or(0.0) as f32,
        stack_gap_min: math.stack_gap_min().unwrap_or(0.0) as f32,
        stretch_stack_top_shift_up: math.stretch_stack_top_shift_up().unwrap_or(0.0) as f32,
        stretch_stack_bottom_shift_down: math.stretch_stack_bottom_shift_down().unwrap_or(0.0) as f32,
        stretch_stack_gap_above_min: math.stretch_stack_gap_above_min().unwrap_or(0.0) as f32,
        stretch_stack_gap_below_min: math.stretch_stack_gap_below_min().unwrap_or(0.0) as f32,
    })
}

pub fn parse_glyph_assembly(face: &Face, glyph_id: u32) -> Option<crate::GlyphAssembly> {
    let math = face.tables().math_table()?;
    let assembly = math.glyph_assembly(ttf_parser::GlyphId(glyph_id as u16))?;

    let parts: Vec<crate::GlyphPart> = assembly.parts.iter().map(|part| {
        crate::GlyphPart {
            glyph_id: part.glyph_id.0 as u32,
            start_connector_length: part.start_connector_length as f32,
            end_connector_length: part.end_connector_length as f32,
            full_advance: part.full_advance as f32,
            part_flags: part.part_flags,
        }
    }).collect();

    Some(crate::GlyphAssembly {
        glyph_id: glyph_id as u32,
        parts,
        italics_correction: assembly.italics_correction.map(|v| v as f32).unwrap_or(0.0),
    })
}
```

- [ ] **Step 3: Run test**

```bash
cd src-tauri && cargo test --package font-core --test math_table_tests 2>&1
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/crates/font-core/src/math_table.rs src-tauri/crates/font-core/tests/math_table_tests.rs
git commit -m "feat(font-core): implement OpenType MATH table parser"
```

---

### Task 4: Glyph Metric 缓存 + Fallback Chain 构建

**Files:**
- Create: `src-tauri/crates/font-core/src/glyph.rs`
- Create: `src-tauri/crates/font-core/src/fallback.rs`
- Create: `src-tauri/crates/font-core/tests/glyph_tests.rs`

- [ ] **Step 1: Write failing test**

```rust
// tests/glyph_tests.rs
use font_core::glyph::GlyphCache;

#[test]
fn test_glyph_cache_basic() {
    let mut cache = GlyphCache::new();
    let metrics = cache.get_or_compute("SF Pro", 65, 14.0);
    assert!(metrics.is_some(), "should get metrics for 'A' in SF Pro");
}

#[test]
fn test_glyph_cache_hit_rate() {
    let mut cache = GlyphCache::new();
    // 同字体+字号做两个查询
    cache.get_or_compute("SF Pro", 65, 14.0);
    cache.get_or_compute("SF Pro", 65, 14.0);
    assert!(cache.hit_rate() > 0.0, "second call should be a cache hit");
}
```

- [ ] **Step 2: Implement glyph.rs**

```rust
// src/glyph.rs
use crate::GlyphMetricsEntry;
use lru::LruCache;
use ttf_parser::Face;
use std::collections::HashMap;

pub struct GlyphCache {
    inner: LruCache<(String, u32, f32), GlyphMetricsEntry>,
    hits: u64,
    misses: u64,
    loaded_faces: HashMap<String, Vec<u8>>,
}

impl GlyphCache {
    pub fn new() -> Self {
        Self {
            inner: LruCache::new(10000),
            hits: 0,
            misses: 0,
            loaded_faces: HashMap::new(),
        }
    }

    pub fn register_font(&mut self, font_id: &str, font_data: Vec<u8>) {
        self.loaded_faces.insert(font_id.to_string(), font_data);
    }

    pub fn get_or_compute(
        &mut self,
        font_id: &str,
        glyph_id: u32,
        font_size: f32,
    ) -> Option<GlyphMetricsEntry> {
        let key = (font_id.to_string(), glyph_id, font_size);

        if let Some(entry) = self.inner.get(&key) {
            self.hits += 1;
            return Some(entry.clone());
        }

        self.misses += 1;

        // 从缓存中找已注册的字体数据并解析
        let font_data = self.loaded_faces.get(font_id)?;
        let face = Face::from_slice(font_data, 0).ok()?;
        let glyph_id_u16 = glyph_id as u16;
        let glyph = face.glyph(ttf_parser::GlyphId(glyph_id_u16))?;

        // 获取字形度量
        let advance = glyph.advance().unwrap_or(0) as f32 * font_size / face.units_per_em() as f32;
        let bounding_box = glyph.bounding_box()
            .map(|bbox| (
                bbox.x_min as f32 * font_size / face.units_per_em() as f32,
                bbox.y_min as f32 * font_size / face.units_per_em() as f32,
                bbox.x_max as f32 * font_size / face.units_per_em() as f32,
                bbox.y_max as f32 * font_size / face.units_per_em() as f32,
            ));

        let entry = GlyphMetricsEntry {
            glyph_id,
            advance,
            x_min: bounding_box.map(|b| b.0).unwrap_or(0.0),
            y_min: bounding_box.map(|b| b.1).unwrap_or(0.0),
            x_max: bounding_box.map(|b| b.2).unwrap_or(advance),
            y_max: bounding_box.map(|b| b.3).unwrap_or(font_size),
            bearing_x: 0.0,
            bearing_y: 0.0,
        };

        self.inner.put(key, entry.clone());
        Some(entry)
    }

    pub fn hit_rate(&self) -> f32 {
        let total = self.hits + self.misses;
        if total == 0 { 0.0 } else { self.hits as f32 / total as f32 }
    }

    pub fn batch_get(&mut self, font_id: &str, glyph_ids: &[u32], font_size: f32) -> Vec<Option<GlyphMetricsEntry>> {
        glyph_ids.iter().map(|&gid| self.get_or_compute(font_id, gid, font_size)).collect()
    }
}
```

- [ ] **Step 3: 实现 fallback.rs**

```rust
// src/fallback.rs
// 系统字体 fallback chain 构建

#[cfg(target_os = "macos")]
mod platform {
    use core_text;

    pub fn system_fallback_chain() -> Vec<String> {
        let mut chain = Vec::new();

        // macOS 标准 fallback chain
        chain.push("PingFang SC".into());  // 简体中文
        chain.push("STIX Two Math".into()); // 数学
        chain.push("Apple Color Emoji".into()); // Emoji
        chain.push("Helvetica Neue".into()); // Latin fallback
        chain.push("Apple Symbols".into());  // 符号兜底

        chain
    }

    pub fn cjk_fallback_fonts() -> Vec<String> {
        vec![
            "PingFang SC".into(),
            "PingFang TC".into(),
            "Hiragino Sans GB".into(),
            "Noto Sans CJK SC".into(),
        ]
    }

    pub fn math_fallback_fonts() -> Vec<String> {
        vec![
            "STIX Two Math".into(),
            "Latin Modern Math".into(),
            "XITS Math".into(),
            "Cambria Math".into(),
        ]
    }
}

pub use platform::*;
```

- [ ] **Step 4: Run tests**

```bash
cd src-tauri && cargo test --package font-core 2>&1
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/crates/font-core/
git commit -m "feat(font-core): add glyph metric cache and macOS font fallback chains"
```
