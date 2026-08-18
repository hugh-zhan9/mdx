use crate::model::{PageMargins, PageSize};
use layout_core::{CanvasDrawOp, LayoutLine, LayoutSnapshot};

pub use crate::model::{PaginatedDocument, PaginatedPage};

pub fn paginate_snapshot(
    snapshot: &LayoutSnapshot,
    page_size: &PageSize,
    margins: &PageMargins,
) -> PaginatedDocument {
    let available_height = (page_size.height_pt - margins.top_pt - margins.bottom_pt).max(0.0);
    let mut pages = Vec::new();
    let mut current_lines = Vec::new();
    let mut current_height = 0.0_f32;

    for line in &snapshot.lines {
        if !current_lines.is_empty() && current_height + line.height > available_height {
            pages.push(build_page(
                pages.len() + 1,
                std::mem::take(&mut current_lines),
                &snapshot.canvas_draw_ops,
                margins.left_pt,
            ));
            current_height = 0.0;
        }

        current_height += line.height;
        current_lines.push(line.clone());
    }

    if !current_lines.is_empty() {
        pages.push(build_page(
            pages.len() + 1,
            current_lines,
            &snapshot.canvas_draw_ops,
            margins.left_pt,
        ));
    }

    if pages.is_empty() && !snapshot.canvas_draw_ops.is_empty() {
        pages = build_draw_op_only_pages(
            &snapshot.canvas_draw_ops,
            available_height,
            margins.left_pt,
        );
    }

    PaginatedDocument {
        snapshot: snapshot.clone(),
        page_size: page_size.clone(),
        margins: margins.clone(),
        pages,
    }
}

/// Places one page's content inside the page, margins included.
///
/// This is where document coordinates become page coordinates. The vertical
/// origin moves to the top of this page, and everything shifts right by the left
/// margin — which the drawing step cannot do for itself, because by then the
/// geometry has been spread across text runs, link rectangles and a dozen kinds
/// of draw op, and one of them would always be missed. Before this, a page's
/// text began at the very edge of the paper.
fn build_page(
    number: usize,
    lines: Vec<LayoutLine>,
    canvas_draw_ops: &[CanvasDrawOp],
    left_pt: f32,
) -> PaginatedPage {
    let (start_y, end_y) = page_vertical_bounds(&lines);
    let draw_ops = canvas_draw_ops
        .iter()
        .filter(|op| op.y < end_y && op.y + op.height > start_y)
        .map(|op| CanvasDrawOp {
            y: op.y - start_y,
            x: op.x + left_pt,
            ..op.clone()
        })
        .collect();

    PaginatedPage {
        number,
        lines: lines.into_iter().map(|line| indent_line(line, left_pt)).collect(),
        draw_ops,
    }
}

/// Moves a line's text runs in from the left edge of the paper.
fn indent_line(mut line: LayoutLine, left_pt: f32) -> LayoutLine {
    for run in &mut line.text_runs {
        run.left += left_pt;
    }

    line
}

fn build_draw_op_only_pages(
    canvas_draw_ops: &[CanvasDrawOp],
    available_height: f32,
    left_pt: f32,
) -> Vec<PaginatedPage> {
    let page_height = available_height.max(1.0);
    let max_bottom = canvas_draw_ops
        .iter()
        .map(|op| op.y + op.height)
        .fold(0.0_f32, f32::max);
    let page_count = ((max_bottom / page_height).ceil() as usize).max(1);

    (0..page_count)
        .map(|page_index| {
            let start_y = page_index as f32 * page_height;
            let end_y = start_y + page_height;
            let draw_ops = canvas_draw_ops
                .iter()
                .filter(|op| op.y < end_y && op.y + op.height > start_y)
                .map(|op| CanvasDrawOp {
                    y: op.y - start_y,
                    x: op.x + left_pt,
                    ..op.clone()
                })
                .collect();

            PaginatedPage {
                number: page_index + 1,
                lines: Vec::new(),
                draw_ops,
            }
        })
        .collect()
}

fn page_vertical_bounds(lines: &[LayoutLine]) -> (f32, f32) {
    let start_y = lines.first().map(|line| line.y).unwrap_or_default();
    let end_y = lines
        .last()
        .map(|line| line.y + line.height)
        .unwrap_or(start_y);
    (start_y, end_y.max(start_y))
}

#[cfg(test)]
mod tests {
    use super::*;
    use layout_core::{
        CanvasDrawKind, InlineKind, InlineStyle, LayoutSnapshot, TextRunPosition,
    };

    fn run(left: f32) -> TextRunPosition {
        TextRunPosition {
            block_id: "paragraph-0".into(),
            pm_from: 0,
            pm_to: 4,
            left,
            baseline: 12.0,
            width: 40.0,
            height: 16.0,
            font_family: "Helvetica".into(),
            font_size: 11.0,
            text: "word".into(),
            kind: InlineKind::Text,
            style: InlineStyle::default(),
        }
    }

    fn snapshot(left: f32) -> LayoutSnapshot {
        LayoutSnapshot {
            revision: 1,
            lines: vec![LayoutLine {
                id: "line-0".into(),
                block_id: "paragraph-0".into(),
                y: 0.0,
                baseline: 12.0,
                height: 16.0,
                text_runs: vec![run(left)],
            }],
            canvas_draw_ops: vec![CanvasDrawOp {
                block_id: "image-0".into(),
                kind: CanvasDrawKind::Image,
                x: 8.0,
                // Beside the line, not below it: a page only carries the draw
                // ops that fall within the lines it holds.
                y: 4.0,
                width: 16.0,
                height: 16.0,
                data: "{}".into(),
            }],
            hit_test_entries: Vec::new(),
            caret_anchors: Vec::new(),
            selection_geometries: Vec::new(),
            mirror_blocks: Vec::new(),
        }
    }

    #[test]
    fn a_page_puts_its_content_inside_the_left_margin() {
        let paginated = paginate_snapshot(
            &snapshot(0.0),
            &PageSize::a4_points(),
            &PageMargins::uniform(72.0),
        );
        let page = &paginated.pages[0];

        // The layout laid this out at the very left of its own space; the page
        // is what has margins, so the run moves in by one.
        assert_eq!(page.lines[0].text_runs[0].left, 72.0);
        // Whatever was drawn beside the text moves with it, or a picture and its
        // caption would no longer line up.
        assert_eq!(page.draw_ops[0].x, 80.0);
    }

    #[test]
    fn the_left_margin_is_added_to_whatever_the_layout_already_had() {
        let paginated = paginate_snapshot(
            &snapshot(4.0),
            &PageSize::a4_points(),
            &PageMargins::uniform(36.0),
        );

        assert_eq!(paginated.pages[0].lines[0].text_runs[0].left, 40.0);
    }
}
