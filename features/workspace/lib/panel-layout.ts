interface WorkspacePanelLayoutInput {
    containerWidth: number;
    leftCollapsed: boolean;
    leftWidth: number;
    rightCollapsed: boolean;
    rightWidth: number;
}

interface WorkspacePanelLayout {
    leftWidth: number;
    centerWidth: number;
    rightWidth: number;
}

const MIN_PANEL_WIDTH = 160;
const MAX_PANEL_WIDTH = 640;
const MIN_EDITOR_WIDTH = 560;

export function calculateWorkspacePanelLayout({
    containerWidth,
    leftCollapsed,
    leftWidth,
    rightCollapsed,
    rightWidth,
}: WorkspacePanelLayoutInput): WorkspacePanelLayout {
    let nextLeftWidth = leftCollapsed ? 0 : clampPanelWidth(leftWidth);
    let nextRightWidth = rightCollapsed ? 0 : clampPanelWidth(rightWidth);
    const availablePanelWidth = Math.max(0, containerWidth - MIN_EDITOR_WIDTH);
    let overflow = nextLeftWidth + nextRightWidth - availablePanelWidth;

    if (overflow > 0 && !rightCollapsed) {
        const shrinkBy = Math.min(overflow, nextRightWidth - MIN_PANEL_WIDTH);
        nextRightWidth -= shrinkBy;
        overflow -= shrinkBy;
    }

    if (overflow > 0 && !leftCollapsed) {
        const shrinkBy = Math.min(overflow, nextLeftWidth - MIN_PANEL_WIDTH);
        nextLeftWidth -= shrinkBy;
        overflow -= shrinkBy;
    }

    return {
        leftWidth: nextLeftWidth,
        centerWidth: Math.max(
            0,
            containerWidth - nextLeftWidth - nextRightWidth,
        ),
        rightWidth: nextRightWidth,
    };
}

function clampPanelWidth(width: number) {
    if (!Number.isFinite(width)) {
        return MIN_PANEL_WIDTH;
    }

    return Math.round(
        Math.min(Math.max(width, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH),
    );
}
