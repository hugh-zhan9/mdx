"use client";

import { CanvasSvgLayer } from "./canvas-svg-layer";
import { DomTextRunLayer } from "./dom-text-run-layer";
import { LightMirror } from "./light-mirror";
import type { LayoutSnapshot } from "./wasm-layout-bridge";

export interface HybridEditorHostProps {
    snapshot: LayoutSnapshot;
}

export function HybridEditorHost({ snapshot }: HybridEditorHostProps) {
    const contentWidth = Math.max(
        1,
        ...snapshot.lines.flatMap((line) =>
            line.textRuns.map((run) => run.left + run.width),
        ),
        ...snapshot.canvasDrawOps.map((op) => op.x + op.width),
        ...snapshot.selectionGeometries.flatMap((geometry) =>
            geometry.rects.map((rect) => rect.x + rect.width),
        ),
    );
    const contentHeight = Math.max(
        1,
        ...snapshot.lines.map((line) => line.y + line.height),
        ...snapshot.canvasDrawOps.map((op) => op.y + op.height),
        ...snapshot.caretAnchors.map((anchor) => anchor.y + anchor.height),
        ...snapshot.selectionGeometries.flatMap((geometry) =>
            geometry.rects.map((rect) => rect.y + rect.height),
        ),
    );

    return (
        <div
            data-hybrid-editor-host
            className="relative h-full w-full overflow-auto"
        >
            <div
                data-hybrid-editor-content
                className="relative"
                style={{ width: contentWidth, height: contentHeight }}
            >
                <DomTextRunLayer lines={snapshot.lines} />
                <CanvasSvgLayer
                    canvasDrawOps={snapshot.canvasDrawOps}
                    caretAnchors={snapshot.caretAnchors}
                    hitTestEntries={snapshot.hitTestEntries}
                    selectionGeometries={snapshot.selectionGeometries}
                />
                <LightMirror blocks={snapshot.mirrorBlocks} />
            </div>
        </div>
    );
}
