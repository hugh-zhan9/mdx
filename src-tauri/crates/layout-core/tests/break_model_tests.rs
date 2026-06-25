use layout_core::break_model::{find_break_opportunities, BreakKind};

#[test]
fn test_cjk_break_after_each_char() {
    let text = "中文断行测试";
    let breaks = find_break_opportunities(text, 14.0, false);
    let cjk_breaks: Vec<_> = breaks
        .iter()
        .filter(|b| b.kind == BreakKind::CjkChar)
        .collect();

    assert_eq!(
        cjk_breaks.len(),
        text.chars().count() - 1,
        "should have one CJK break after each non-final character"
    );

    let expected_positions = [3, 6, 9, 12, 15];
    for (b, expected_pos) in cjk_breaks.iter().zip(expected_positions) {
        assert_eq!(b.kind, BreakKind::CjkChar);
        assert_eq!(b.pos, expected_pos);
        assert_eq!(b.penalty, Some(0.0));
        assert_eq!(b.glue_stretch, 7.0);
        assert_eq!(b.glue_shrink, 3.5);
    }
}

#[test]
fn test_english_no_break_in_word() {
    let text = "Hello";
    let breaks = find_break_opportunities(text, 14.0, false);
    let in_word_breaks: Vec<_> = breaks.iter().filter(|b| b.pos > 0 && b.pos < 5).collect();

    assert!(
        in_word_breaks.is_empty()
            || in_word_breaks
                .iter()
                .all(|b| b.penalty.map_or(true, |p| p >= 1000.0))
    );
}

#[test]
fn test_cjk_latin_boundary() {
    let text = "中文English混合";
    let breaks = find_break_opportunities(text, 14.0, false);
    let boundary_break = breaks
        .iter()
        .find(|b| b.kind == BreakKind::LatinBoundary && b.pos == 6);

    assert!(
        boundary_break.is_some(),
        "should have glue at CJK/Latin boundary"
    );

    let boundary_break = boundary_break.unwrap();
    assert_eq!(boundary_break.penalty, None);
    assert_eq!(boundary_break.glue_stretch, 3.5);
    assert_eq!(boundary_break.glue_shrink, 1.4);
}

#[test]
fn test_punctuation_no_break_before() {
    let text = "他说：“好的”。";
    let breaks = find_break_opportunities(text, 14.0, false);
    let before_quote: Vec<_> = breaks
        .iter()
        .filter(|b| b.kind == BreakKind::Punctuation && text[b.pos..].starts_with('“'))
        .collect();

    assert_eq!(
        before_quote.len(),
        1,
        "should record exactly one break opportunity before opening quote"
    );

    for b in before_quote {
        assert_eq!(b.penalty, Some(1000.0));
        assert_eq!(b.glue_stretch, 0.0);
        assert_eq!(b.glue_shrink, 0.0);
    }
}
