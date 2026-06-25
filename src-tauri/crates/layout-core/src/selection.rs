use crate::{LayoutLine, Rect, SelectionGeometry};

pub fn compute_selection_geometry(
    lines: &[LayoutLine],
    pm_from: usize,
    pm_to: usize,
) -> SelectionGeometry {
    let mut rects = Vec::new();

    for line in lines {
        for run in &line.text_runs {
            if run.pm_from < pm_to && run.pm_to > pm_from {
                rects.push(Rect {
                    x: run.left,
                    y: line.y,
                    width: run.width,
                    height: line.height,
                });
            }
        }
    }

    SelectionGeometry {
        pm_from,
        pm_to,
        rects,
    }
}
