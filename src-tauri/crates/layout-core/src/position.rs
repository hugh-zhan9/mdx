use crate::{CaretAnchor, LayoutLine};

pub fn caret_anchors_for_lines(lines: &[LayoutLine]) -> Vec<CaretAnchor> {
    let mut anchors = Vec::new();

    for line in lines {
        if line.text_runs.is_empty() {
            anchors.push(CaretAnchor {
                line_id: line.id.clone(),
                pm_position: 0,
                x: 0.0,
                y: line.y,
                height: line.height,
            });
            continue;
        }

        for run in &line.text_runs {
            anchors.push(CaretAnchor {
                line_id: line.id.clone(),
                pm_position: run.pm_from,
                x: run.left,
                y: line.y,
                height: line.height,
            });

            anchors.push(CaretAnchor {
                line_id: line.id.clone(),
                pm_position: run.pm_to,
                x: run.left + run.width,
                y: line.y,
                height: line.height,
            });
        }
    }

    anchors.sort_by(|left, right| {
        left.pm_position
            .cmp(&right.pm_position)
            .then_with(|| left.y.total_cmp(&right.y))
            .then_with(|| left.x.total_cmp(&right.x))
    });
    anchors.dedup_by(|left, right| {
        left.line_id == right.line_id
            && left.pm_position == right.pm_position
            && left.x == right.x
            && left.y == right.y
    });
    anchors
}
