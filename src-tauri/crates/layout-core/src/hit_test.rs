use crate::{HitTestEntry, LayoutLine, Rect};

pub fn hit_test_point(lines: &[LayoutLine], x: f32, y: f32) -> Option<HitTestEntry> {
    for line in lines {
        if y < line.y || y > line.y + line.height {
            continue;
        }

        for run in &line.text_runs {
            let run_right = run.left + run.width;
            if x >= run.left && x <= run_right {
                return Some(HitTestEntry {
                    block_id: run.block_id.clone(),
                    rect: Rect {
                        x: run.left,
                        y: line.y,
                        width: run.width,
                        height: line.height,
                    },
                    pm_from: run.pm_from,
                    pm_to: run.pm_to,
                });
            }
        }
    }

    None
}
