use layout_core::font_api::MockFontMetrics;
use layout_core::paragraph::{
    layout_paragraph, layout_paragraph_greedy, layout_paragraph_knuth_plass, ParagraphInput,
    ParagraphLayoutMode,
};
use layout_core::{InlineKind, InlineRun, InlineStyle};

fn style() -> InlineStyle {
    InlineStyle {
        bold: false,
        italic: false,
        code: false,
        link: None,
        strike: false,
        underline: false,
    }
}

fn inline(text: &str, from: usize, to: usize) -> InlineRun {
    InlineRun {
        text: text.to_string(),
        kind: InlineKind::Text,
        from,
        to,
        style: style(),
    }
}

#[test]
fn test_single_line_paragraph() {
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("Hello world", 0, 11)],
        line_width: 500.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
    };
    let font = MockFontMetrics::new();

    let lines = layout_paragraph_greedy(&input, &font);

    assert_eq!(lines.len(), 1, "should fit on one line");
    assert_eq!(lines[0].text_runs.len(), 1);
    assert_eq!(lines[0].text_runs[0].text, "Hello world");
    assert_eq!(lines[0].text_runs[0].pm_from, 0);
    assert_eq!(lines[0].text_runs[0].pm_to, 11);
}

#[test]
fn test_multi_line_paragraph() {
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("Hello beautiful wonderful world", 0, 31)],
        line_width: 100.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
    };
    let font = MockFontMetrics::new();

    let lines = layout_paragraph_greedy(&input, &font);

    assert!(lines.len() > 1, "should break into multiple lines");
    for line in &lines {
        assert!(!line.text_runs.is_empty());
        let width: f32 = line.text_runs.iter().map(|run| run.width).sum();
        assert!(width <= input.line_width + 0.001);
    }
}

#[test]
fn test_utf8_offsets_are_preserved_in_output_runs() {
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("中文 English", 100, 113)],
        line_width: 80.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
    };
    let font = MockFontMetrics::new();

    let lines = layout_paragraph_greedy(&input, &font);

    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].text_runs[0].text, "中文");
    assert_eq!(lines[0].text_runs[0].pm_from, 100);
    assert_eq!(lines[0].text_runs[0].pm_to, 106);
    assert_eq!(lines[1].text_runs[0].text, "English");
    assert_eq!(lines[1].text_runs[0].pm_from, 107);
    assert_eq!(lines[1].text_runs[0].pm_to, 114);
}

#[test]
fn test_layout_positions_runs_left_to_right() {
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("Hello world", 0, 11)],
        line_width: 120.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
    };
    let font = MockFontMetrics::new();

    let lines = layout_paragraph(&input, &font);
    let run = &lines[0].text_runs[0];

    assert_eq!(run.left, 0.0);
    assert!(run.width > 0.0);
    assert_eq!(lines[0].baseline, 14.0);
    assert_eq!(lines[0].height, 21.0);
}

#[test]
fn test_knuth_plass_surface_and_auto_mode_match_greedy_baseline() {
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("One two three four five", 0, 23)],
        line_width: 70.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
    };
    let font = MockFontMetrics::new();

    let greedy = layout_paragraph_greedy(&input, &font);
    let knuth = layout_paragraph_knuth_plass(&input, &font).expect("knuth-plass surface");
    let auto = layout_core::paragraph::layout_paragraph_with_mode(
        &input,
        &font,
        ParagraphLayoutMode::Auto,
    );

    assert!(!knuth.is_empty());
    assert_eq!(auto.len(), knuth.len());
    assert_eq!(greedy.last().unwrap().text_runs.last().unwrap().pm_to, 23);
}
