"use client";

import { renderComplexBlock } from "./complex-blocks";
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
            {canvasDrawOps.map((op) => {
                const block = renderComplexBlock({
                    blockId: op.blockId,
                    kind: op.kind,
                    rect: {
                        x: op.x,
                        y: op.y,
                        width: op.width,
                        height: op.height,
                    },
                    data:
                        op.data && typeof op.data === "object"
                            ? (op.data as Record<string, unknown>)
                            : undefined,
                });

                if (block === null) {
                    return null;
                }

                return (
                    <div
                        key={`${op.blockId}-${op.kind}-${op.x}-${op.y}`}
                        data-layout-complex-block-overlay={op.kind}
                        className="absolute pointer-events-auto"
                        style={{
                            left: op.x,
                            top: op.y,
                            width: op.width,
                            height: op.height,
                        }}
                    >
                        {block}
                    </div>
                );
            })}
        </div>
    );
}
