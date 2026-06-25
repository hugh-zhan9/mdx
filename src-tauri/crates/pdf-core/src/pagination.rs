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
        ));
    }

    PaginatedDocument {
        snapshot: snapshot.clone(),
        page_size: page_size.clone(),
        margins: margins.clone(),
        pages,
    }
}

fn build_page(
    number: usize,
    lines: Vec<LayoutLine>,
    canvas_draw_ops: &[CanvasDrawOp],
) -> PaginatedPage {
    let (start_y, end_y) = page_vertical_bounds(&lines);
    let draw_ops = canvas_draw_ops
        .iter()
        .filter(|op| op.y < end_y && op.y + op.height > start_y)
        .map(|op| CanvasDrawOp {
            y: op.y - start_y,
            ..op.clone()
        })
        .collect();

    PaginatedPage {
        number,
        lines,
        draw_ops,
    }
}

fn page_vertical_bounds(lines: &[LayoutLine]) -> (f32, f32) {
    let start_y = lines.first().map(|line| line.y).unwrap_or_default();
    let end_y = lines
        .last()
        .map(|line| line.y + line.height)
        .unwrap_or(start_y);
    (start_y, end_y.max(start_y))
}
