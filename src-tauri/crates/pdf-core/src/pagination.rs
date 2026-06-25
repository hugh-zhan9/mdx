use crate::model::{PageMargins, PageSize};
use layout_core::LayoutSnapshot;

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
        if !current_lines.is_empty() && current_height + line.height >= available_height {
            pages.push(PaginatedPage {
                number: pages.len() + 1,
                lines: std::mem::take(&mut current_lines),
                draw_ops: Vec::new(),
            });
            current_height = 0.0;
        }

        current_height += line.height;
        current_lines.push(line.clone());
    }

    if !current_lines.is_empty() {
        pages.push(PaginatedPage {
            number: pages.len() + 1,
            lines: current_lines,
            draw_ops: Vec::new(),
        });
    }

    PaginatedDocument {
        snapshot: snapshot.clone(),
        page_size: page_size.clone(),
        margins: margins.clone(),
        pages,
    }
}
