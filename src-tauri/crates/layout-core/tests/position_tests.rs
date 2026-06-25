use layout_core::hit_test::hit_test_point;
use layout_core::position::caret_anchors_for_lines;
use layout_core::selection::compute_selection_geometry;
use layout_core::{LayoutLine, TextRunPosition};

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
    let entry = hit_test_point(&[line], 50.0, 8.0);
    assert!(entry.is_some(), "should hit the line");
    let entry = entry.unwrap();
    assert_eq!(entry.pm_from, 0);
    assert_eq!(entry.pm_to, 11);
}

#[test]
fn test_hit_test_outside() {
    let line = make_line(0, 11, 0.0, 100.0);
    let entry = hit_test_point(&[line], 200.0, 8.0);
    assert!(entry.is_none(), "should not hit outside");
}

#[test]
fn test_selection_geometry_simple() {
    let line = make_line(0, 11, 0.0, 100.0);
    let geometry = compute_selection_geometry(&[line], 0, 5);
    assert!(!geometry.rects.is_empty(), "should produce rects");
}

#[test]
fn test_caret_anchors_include_run_boundaries() {
    let line = make_line(3, 7, 10.0, 20.0);
    let anchors = caret_anchors_for_lines(&[line]);
    assert!(anchors
        .iter()
        .any(|anchor| anchor.pm_position == 3 && anchor.x == 10.0));
    assert!(anchors
        .iter()
        .any(|anchor| anchor.pm_position == 7 && anchor.x == 30.0));
}
