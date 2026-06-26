use layout_core::BlockKind;

#[derive(Debug, Clone)]
struct GoldenFixture {
    id: &'static str,
    markdown: &'static str,
    block_kinds: &'static [BlockKind],
    line_snippets: &'static [&'static str],
    mirror_text: &'static str,
}

const PARAGRAPH_KINDS: &[BlockKind] = &[BlockKind::Paragraph];
const MATH_INLINE_KINDS: &[BlockKind] = &[BlockKind::Paragraph, BlockKind::MathBlock];
const TABLE_KINDS: &[BlockKind] = &[BlockKind::Table];
const MERMAID_KINDS: &[BlockKind] = &[BlockKind::Mermaid];
const FALLBACK_KINDS: &[BlockKind] = &[BlockKind::Fallback];

const GOLDEN_FIXTURES: &[GoldenFixture] = &[
    GoldenFixture {
        id: "paragraph-cjk",
        markdown: "中文 English 混排段落。\nSecond line stays textual.\n",
        block_kinds: PARAGRAPH_KINDS,
        line_snippets: &["中文 English", "Second line"],
        mirror_text: "中文 English 混排段落。 Second line stays textual.",
    },
    GoldenFixture {
        id: "math-inline",
        markdown: "公式 $x^2 + y^2 = z^2$ 跟正文混排。\n",
        block_kinds: MATH_INLINE_KINDS,
        line_snippets: &["公式 ", " 跟正文混排。"],
        mirror_text: "公式 x^2 + y^2 = z^2 跟正文混排。",
    },
    GoldenFixture {
        id: "table-basic",
        markdown: "| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |\n",
        block_kinds: TABLE_KINDS,
        line_snippets: &["列 A", "1", "2"],
        mirror_text: "列 A 列 B 1 2",
    },
    GoldenFixture {
        id: "mermaid-basic",
        markdown: "```mermaid\ngraph TD\n  A --> B\n```\n",
        block_kinds: MERMAID_KINDS,
        line_snippets: &["graph TD", "A --> B"],
        mirror_text: "graph TD A --> B",
    },
    GoldenFixture {
        id: "html-fallback",
        markdown: "<details><summary>x</summary><div>opaque</div></details>\n",
        block_kinds: FALLBACK_KINDS,
        line_snippets: &["<details>", "<summary>x</summary>"],
        mirror_text: "x opaque",
    },
];

fn block_kind_name(kind: &BlockKind) -> &'static str {
    match kind {
        BlockKind::Paragraph => "paragraph",
        BlockKind::Heading => "heading",
        BlockKind::List => "list",
        BlockKind::Table => "table",
        BlockKind::Code => "code",
        BlockKind::Image => "image",
        BlockKind::Mermaid => "mermaid",
        BlockKind::Html => "html",
        BlockKind::MathBlock => "math",
        BlockKind::Fallback => "fallback",
    }
}

#[test]
fn golden_fixture_scaffold_covers_required_block_families() {
    let fixture_ids: Vec<_> = GOLDEN_FIXTURES.iter().map(|fixture| fixture.id).collect();

    assert!(fixture_ids.contains(&"paragraph-cjk"));
    assert!(fixture_ids.contains(&"math-inline"));
    assert!(fixture_ids.contains(&"table-basic"));
    assert!(fixture_ids.contains(&"mermaid-basic"));
    assert!(fixture_ids.contains(&"html-fallback"));

    let kind_names: Vec<_> = GOLDEN_FIXTURES
        .iter()
        .flat_map(|fixture| fixture.block_kinds.iter().map(block_kind_name))
        .collect();

    assert!(kind_names.contains(&"paragraph"));
    assert!(kind_names.contains(&"math"));
    assert!(kind_names.contains(&"table"));
    assert!(kind_names.contains(&"mermaid"));
    assert!(kind_names.contains(&"fallback"));
}

#[test]
fn golden_fixture_scaffold_keeps_snapshot_fields_populated() {
    for fixture in GOLDEN_FIXTURES {
        assert!(
            fixture.markdown.ends_with('\n'),
            "fixture {} should preserve markdown newline",
            fixture.id
        );
        assert!(
            !fixture.line_snippets.is_empty(),
            "fixture {} should define line snippets",
            fixture.id
        );
        assert!(
            !fixture.mirror_text.trim().is_empty(),
            "fixture {} should define mirror text",
            fixture.id
        );
    }
}
