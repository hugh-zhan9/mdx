use layout_core::break_model::{find_break_opportunities, BreakKind};

#[test]
fn test_cjk_break_after_each_char() {
    let text = "中文断行测试";
    let breaks = find_break_opportunities(text, 14.0, false);

    assert!(
        breaks.len() >= 3,
        "should have breaks for CJK chars, got {}",
        breaks.len()
    );

    for b in &breaks {
        assert_eq!(b.kind, BreakKind::CjkChar);
        assert!(b.penalty.is_some());
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
    let boundary_breaks: Vec<_> = breaks.iter().filter(|b| b.pos == 2).collect();

    assert!(
        !boundary_breaks.is_empty(),
        "should have glue at CJK/Latin boundary"
    );
}

#[test]
fn test_punctuation_no_break_before() {
    let text = "他说：“好的”。";
    let breaks = find_break_opportunities(text, 14.0, false);
    let before_quote = breaks
        .iter()
        .filter(|b| text.chars().nth(b.pos) == Some('“'));

    for b in before_quote {
        assert!(
            b.penalty.map_or(true, |p| p > 0.0),
            "should not prefer break before opening quote"
        );
    }
}
