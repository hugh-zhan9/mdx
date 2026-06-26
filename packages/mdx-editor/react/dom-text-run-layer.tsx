"use client";

import type { LayoutLineSnapshot } from "./wasm-layout-bridge";

export interface DomTextRunLayerProps {
    lines: LayoutLineSnapshot[];
}

export function DomTextRunLayer({ lines }: DomTextRunLayerProps) {
    return (
        <div data-layout-dom-text-layer className="absolute inset-0">
            {lines.flatMap((line) =>
                line.textRuns.map((run, index) => (
                    <span
                        key={`${line.id}-${run.blockId}-${run.pmFrom}-${run.pmTo}-${index}`}
                        data-layout-block-id={run.blockId}
                        style={{
                            position: "absolute",
                            left: run.left,
                            top: line.y,
                            width: run.width,
                            height: run.height,
                            fontFamily: run.fontFamily,
                            fontSize: run.fontSize,
                        }}
                    >
                        {run.text}
                    </span>
                )),
            )}
        </div>
    );
}
