"use client";

import type {
    LayoutCanvasDrawOp,
    LayoutCaretAnchor,
    LayoutHitTestEntry,
    LayoutSelectionGeometry,
} from "./wasm-layout-bridge";

export interface CanvasSvgLayerProps {
    canvasDrawOps: LayoutCanvasDrawOp[];
    caretAnchors: LayoutCaretAnchor[];
    hitTestEntries: LayoutHitTestEntry[];
    selectionGeometries: LayoutSelectionGeometry[];
}

export function CanvasSvgLayer({
    canvasDrawOps,
    caretAnchors,
    hitTestEntries,
    selectionGeometries,
}: CanvasSvgLayerProps) {
    return (
        <div
            data-layout-overlay-layer
            data-canvas-draw-op-count={canvasDrawOps.length}
            data-caret-anchor-count={caretAnchors.length}
            data-hit-test-count={hitTestEntries.length}
            data-selection-geometry-count={selectionGeometries.length}
            className="absolute inset-0 pointer-events-none"
        >
            <canvas data-layout-canvas-layer className="absolute inset-0" />
            <svg data-layout-svg-layer className="absolute inset-0" aria-hidden="true" />
        </div>
    );
}
