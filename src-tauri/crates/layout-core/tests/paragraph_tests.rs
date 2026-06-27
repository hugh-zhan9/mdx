use layout_core::font_api::MockFontMetrics;
use layout_core::paragraph::{
    layout_paragraph, layout_paragraph_greedy, layout_paragraph_knuth_plass, ParagraphInput,
    ParagraphLayoutMode,
};
use layout_core::{InlineKind, InlineRun, InlineStyle, StyleContext};

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

fn hard_break(pos: usize) -> InlineRun {
    InlineRun {
        text: String::new(),
        kind: InlineKind::HardBreak,
        from: pos,
        to: pos,
        style: style(),
    }
}

fn style_context() -> StyleContext {
    StyleContext {
        default_font_size: 14.0,
        default_font_family: "Inter".to_string(),
        default_line_height: 1.5,
        viewport_width: 800.0,
        viewport_height: 600.0,
        device_pixel_ratio: 1.0,
    }
}

fn line_signature(line: &layout_core::LayoutLine) -> Vec<(String, usize, usize)> {
    line.text_runs
        .iter()
        .map(|run| (run.text.clone(), run.pm_from, run.pm_to))
        .collect()
}

#[test]
fn test_single_line_paragraph() {
    let style_context = style_context();
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("Hello world", 0, 11)],
        line_width: 500.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
        style_context: &style_context,
    };
    let font = MockFontMetrics::new();

    let lines = layout_paragraph_greedy(&input, &font);

    assert_eq!(lines.len(), 1, "should fit on one line");
    assert_eq!(
        line_signature(&lines[0]),
        vec![("Hello world".to_string(), 0, 11)]
    );
}

#[test]
fn test_multi_line_paragraph() {
    let style_context = style_context();
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("Hello beautiful wonderful world", 0, 31)],
        line_width: 100.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
        style_context: &style_context,
    };
    let font = MockFontMetrics::new();

    let lines = layout_paragraph_greedy(&input, &font);

    assert!(lines.len() > 1, "should break into multiple lines");
    assert!(!lines[0].text_runs.is_empty());
    assert!(!lines[1].text_runs.is_empty());
    assert_eq!(line_signature(&lines[0])[0].1, 0);
    assert!(
        lines[0].text_runs.iter().map(|run| run.width).sum::<f32>() <= input.line_width + 0.001
    );
    assert!(
        lines[1].text_runs.iter().map(|run| run.width).sum::<f32>() <= input.line_width + 0.001
    );
}

#[test]
fn test_utf8_offsets_are_preserved_in_output_runs() {
    let style_context = style_context();
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("中文 English", 100, 114)],
        line_width: 60.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
        style_context: &style_context,
    };
    let font = MockFontMetrics::new();

    let lines = layout_paragraph_greedy(&input, &font);

    assert_eq!(lines.len(), 2);
    assert_eq!(
        line_signature(&lines[0]),
        vec![("中文 ".to_string(), 100, 107)]
    );
    assert_eq!(
        line_signature(&lines[1]),
        vec![("English".to_string(), 107, 114)]
    );
}

#[test]
fn test_boundary_whitespace_is_retained_in_output_runs_and_pm_ranges() {
    let style_context = style_context();
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("Hello     world ", 0, 16)],
        line_width: 100.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
        style_context: &style_context,
    };
    let font = MockFontMetrics::new();

    let greedy = layout_paragraph_greedy(&input, &font);
    let knuth = layout_paragraph_knuth_plass(&input, &font).expect("knuth-plass surface");
    let auto = layout_paragraph(&input, &font);

    assert_eq!(greedy.len(), 1);
    assert_eq!(
        line_signature(&greedy[0]),
        vec![("Hello     world ".to_string(), 0, 16)]
    );
    assert_eq!(line_signature(&knuth[0]), line_signature(&greedy[0]));
    assert_eq!(line_signature(&auto[0]), line_signature(&greedy[0]));
    assert!(
        greedy[0].text_runs.iter().map(|run| run.width).sum::<f32>() <= input.line_width + 0.001
    );
    assert_eq!(
        greedy[0].text_runs.iter().map(|run| run.width).sum::<f32>(),
        91.0
    );
}

#[test]
fn test_knuth_plass_chooses_lower_raggedness_than_greedy() {
    let style_context = style_context();
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("aaa bb cc dd", 0, 12)],
        line_width: 36.0,
        font_size: 10.0,
        line_height: 1.5,
        is_code: false,
        style_context: &style_context,
    };
    let font = MockFontMetrics::new();

    let greedy = layout_paragraph_greedy(&input, &font);
    let knuth = layout_paragraph_knuth_plass(&input, &font).expect("knuth-plass layout");

    let greedy_signature: Vec<_> = greedy.iter().map(line_signature).collect();
    let knuth_signature: Vec<_> = knuth.iter().map(line_signature).collect();

    assert_ne!(knuth_signature, greedy_signature);
    assert_eq!(knuth.len(), 2);
    assert_eq!(knuth_signature[0], vec![("aaa bb".to_string(), 0, 6)]);
    assert_eq!(knuth_signature[1], vec![("cc dd".to_string(), 7, 12)]);
    assert_eq!(knuth.first().unwrap().text_runs.first().unwrap().pm_from, 0);
    assert_eq!(knuth.last().unwrap().text_runs.last().unwrap().pm_to, 12);
}

#[test]
fn test_hard_breaks_emit_blank_lines_for_consecutive_and_trailing_breaks() {
    let style_context = style_context();
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[
            inline("Alpha", 0, 5),
            hard_break(5),
            hard_break(5),
            inline("Beta", 5, 9),
            hard_break(9),
        ],
        line_width: 200.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
        style_context: &style_context,
    };
    let font = MockFontMetrics::new();

    let lines = layout_paragraph_greedy(&input, &font);

    assert_eq!(lines.len(), 4);
    assert_eq!(line_signature(&lines[0]), vec![("Alpha".to_string(), 0, 5)]);
    assert!(lines[1].text_runs.is_empty());
    assert_eq!(line_signature(&lines[2]), vec![("Beta".to_string(), 5, 9)]);
    assert!(lines[3].text_runs.is_empty());
    assert!(lines[1].y > lines[0].y);
    assert!(lines[2].y > lines[1].y);
    assert!(lines[3].y > lines[2].y);
}

#[test]
fn test_layout_positions_runs_left_to_right() {
    let style_context = style_context();
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("Hello world", 0, 11)],
        line_width: 120.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
        style_context: &style_context,
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
fn test_knuth_plass_surface_and_auto_mode_preserve_content_ranges() {
    let style_context = style_context();
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("One two three four five", 0, 23)],
        line_width: 30.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
        style_context: &style_context,
    };
    let font = MockFontMetrics::new();

    let knuth = layout_paragraph_knuth_plass(&input, &font).expect("knuth-plass surface");
    let auto = layout_core::paragraph::layout_paragraph_with_mode(
        &input,
        &font,
        ParagraphLayoutMode::Auto,
    );

    assert!(!knuth.is_empty());
    let knuth_signature: Vec<_> = knuth.iter().map(line_signature).collect();
    let auto_signature: Vec<_> = auto.iter().map(line_signature).collect();

    assert_eq!(auto_signature, knuth_signature);
    assert_eq!(knuth.first().unwrap().text_runs.first().unwrap().pm_from, 0);
    assert_eq!(knuth.last().unwrap().text_runs.last().unwrap().pm_to, 23);
}

#[test]
fn test_adjacent_inline_runs_remain_separate_text_runs() {
    let mut first = inline("Hello ", 0, 6);
    first.style.bold = true;
    let mut second = inline("world", 6, 11);
    second.style.bold = true;

    let style_context = style_context();
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[first, second],
        line_width: 500.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
        style_context: &style_context,
    };
    let font = MockFontMetrics::new();

    let lines = layout_paragraph_greedy(&input, &font);

    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].text_runs.len(), 2);
    assert_eq!(lines[0].text_runs[0].text, "Hello ");
    assert_eq!(lines[0].text_runs[1].text, "world");
    assert_eq!(lines[0].text_runs[0].pm_to, 6);
    assert_eq!(lines[0].text_runs[1].pm_from, 6);
}

#[test]
fn test_declared_inline_span_is_accepted_by_byte_length_layout() {
    let style_context = style_context();
    let input = ParagraphInput {
        block_id: "b1".into(),
        inlines: &[inline("中文 English", 100, 113)],
        line_width: 60.0,
        font_size: 14.0,
        line_height: 1.5,
        is_code: false,
        style_context: &style_context,
    };
    let font = MockFontMetrics::new();

    let lines = layout_paragraph_greedy(&input, &font);
    assert!(!lines.is_empty());
    assert!(lines
        .iter()
        .flat_map(|line| line.text_runs.iter())
        .all(|run| run.pm_from >= 100 && run.pm_to <= 113));
}
