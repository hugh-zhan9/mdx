use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFixture {
    id: String,
    markdown: String,
    expected: GoldenFixtureExpectations,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFixtureExpectations {
    block_kinds: Vec<String>,
    canvas_block_kinds: Vec<String>,
    line_snippets: Vec<String>,
    mirror_text: String,
    has_math_inline: Option<bool>,
}

fn golden_fixtures() -> Vec<GoldenFixture> {
    let source = include_str!("../../../../packages/mdx-editor/test/tex-canvas-fixtures.ts");
    let prefix = "export const TEX_CANVAS_FIXTURE_CORPUS_JSON = String.raw`";
    let start = source
        .find(prefix)
        .map(|idx| idx + prefix.len())
        .expect("fixture corpus prefix should exist");
    let rest = &source[start..];
    let end = rest
        .find("`;\n")
        .expect("fixture corpus terminator should exist");
    serde_json::from_str(&rest[..end]).expect("fixture corpus JSON should parse")
}

fn fixture_by_id<'a>(fixtures: &'a [GoldenFixture], id: &str) -> &'a GoldenFixture {
    fixtures
        .iter()
        .find(|fixture| fixture.id == id)
        .unwrap_or_else(|| panic!("fixture {id} should exist"))
}

#[test]
fn golden_fixture_scaffold_covers_required_block_families() {
    let fixtures = golden_fixtures();
    let fixture_ids: Vec<_> = fixtures.iter().map(|fixture| fixture.id.as_str()).collect();

    assert!(fixture_ids.contains(&"paragraph-cjk"));
    assert!(fixture_ids.contains(&"math-inline"));
    assert!(fixture_ids.contains(&"table-basic"));
    assert!(fixture_ids.contains(&"mermaid-basic"));
    assert!(fixture_ids.contains(&"html-fallback"));
    assert!(fixture_ids.contains(&"mixed-layout"));

    let kind_names: Vec<_> = fixtures
        .iter()
        .flat_map(|fixture| fixture.expected.block_kinds.iter().map(String::as_str))
        .collect();

    assert!(kind_names.contains(&"paragraph"));
    assert!(kind_names.contains(&"table"));
    assert!(kind_names.contains(&"mermaid"));
    assert!(kind_names.contains(&"fallback"));
}

#[test]
fn golden_fixture_scaffold_keeps_snapshot_fields_populated() {
    for fixture in golden_fixtures() {
        assert!(
            fixture.markdown.ends_with('\n'),
            "fixture {} should preserve markdown newline",
            fixture.id
        );
        assert!(
            !fixture.expected.line_snippets.is_empty(),
            "fixture {} should define line snippets",
            fixture.id
        );
        assert!(
            !fixture.expected.mirror_text.trim().is_empty(),
            "fixture {} should define mirror text",
            fixture.id
        );
    }
}

#[test]
fn golden_fixture_scaffold_pins_reviewed_semantics() {
    let fixtures = golden_fixtures();

    let paragraph = fixture_by_id(&fixtures, "paragraph-cjk");
    assert_eq!(paragraph.expected.block_kinds, vec!["paragraph"]);
    assert!(
        paragraph.expected.canvas_block_kinds.is_empty(),
        "paragraph-only fixture should not require a canvas block"
    );
    assert_eq!(paragraph.expected.has_math_inline, None);

    let inline_math = fixture_by_id(&fixtures, "math-inline");
    assert_eq!(inline_math.expected.block_kinds, vec!["paragraph"]);
    assert!(
        inline_math.expected.canvas_block_kinds.is_empty(),
        "inline math should stay in paragraph layout rather than becoming a math canvas block"
    );
    assert_eq!(inline_math.expected.has_math_inline, Some(true));

    let fallback = fixture_by_id(&fixtures, "html-fallback");
    assert_eq!(
        fallback.markdown,
        "<div data-x=\"1\">\n  <span>HTML</span>\n</div>\n"
    );
    assert_eq!(fallback.expected.block_kinds, vec!["fallback"]);
    assert_eq!(fallback.expected.canvas_block_kinds, vec!["fallback"]);
    assert_eq!(
        fallback.expected.mirror_text,
        "<div data-x=\"1\"> <span>HTML</span> </div>"
    );

    let mixed = fixture_by_id(&fixtures, "mixed-layout");
    assert_eq!(
        mixed.expected.block_kinds,
        vec!["paragraph", "mermaid", "fallback", "table"]
    );
    assert_eq!(
        mixed.expected.canvas_block_kinds,
        vec!["mermaid", "fallback", "table"]
    );
    assert_eq!(mixed.expected.has_math_inline, Some(true));
    assert!(mixed.markdown.contains("$a+b$"));
    assert!(
        mixed.expected
            .mirror_text
            .contains("<div class=\"unsupported\">raw html block</div>")
    );
}
