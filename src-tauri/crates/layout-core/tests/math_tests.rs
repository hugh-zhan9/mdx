use layout_core::math::{layout_math, parse_math, MathContext, MathExpr};
use layout_core::MathDisplay;

#[test]
fn test_simple_superscript() {
    let ast = parse_math("x^2");
    assert!(matches!(ast, MathExpr::Scripts(..)));

    let ctx = MathContext::new(14.0, MathDisplay::Inline);
    let ops = layout_math("b1", "x^2", &ctx);
    assert!(!ops.is_empty(), "should produce draw ops");
}

#[test]
fn test_fraction() {
    let ast = parse_math(r"\frac{a}{b}");
    assert!(matches!(ast, MathExpr::Fraction(..)));

    let ctx = MathContext::new(14.0, MathDisplay::Inline);
    let ops = layout_math("b1", r"\frac{a}{b}", &ctx);
    assert!(!ops.is_empty(), "fraction should produce draw ops");
}
