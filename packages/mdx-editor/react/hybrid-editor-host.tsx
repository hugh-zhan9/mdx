"use client";

import { CanvasSvgLayer } from "./canvas-svg-layer";
import { DomTextRunLayer } from "./dom-text-run-layer";
import type { LayoutSnapshot } from "./wasm-layout-bridge";

export interface HybridEditorHostProps {
    snapshot: LayoutSnapshot;
}

export function HybridEditorHost({ snapshot }: HybridEditorHostProps) {
    return (
        <div data-hybrid-editor-host className="relative h-full w-full overflow-auto">
            <DomTextRunLayer lines={snapshot.lines} />
            <CanvasSvgLayer />
        </div>
    );
}
