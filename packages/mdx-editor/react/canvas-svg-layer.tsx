"use client";

export function CanvasSvgLayer() {
    return (
        <div data-layout-overlay-layer className="absolute inset-0 pointer-events-none">
            <canvas data-layout-canvas-layer className="absolute inset-0" />
            <svg data-layout-svg-layer className="absolute inset-0" aria-hidden="true" />
        </div>
    );
}
