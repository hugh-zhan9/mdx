"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
    WorkspaceAction,
    WorkspacePanelSide,
    WorkspacePanelState,
} from "../lib/types";

interface UsePanelResizeOptions {
    side: WorkspacePanelSide;
    panel: WorkspacePanelState;
    dispatch: (action: WorkspaceAction) => void;
}

const MIN_PANEL_WIDTH = 160;
const MAX_PANEL_WIDTH = 640;

export function usePanelResize({
    side,
    panel,
    dispatch,
}: UsePanelResizeOptions) {
    const dragCleanupRef = useRef<(() => void) | null>(null);
    const width = side === "left" ? panel.leftWidth : panel.rightWidth;
    const isCollapsed =
        side === "left" ? panel.leftCollapsed : panel.rightCollapsed;

    const setCollapsed = useCallback(
        (collapsed: boolean) => {
            dispatch({
                type: "panel/collapsedChanged",
                side,
                collapsed,
            });
        },
        [dispatch, side],
    );

    const toggleCollapsed = useCallback(() => {
        setCollapsed(!isCollapsed);
    }, [isCollapsed, setCollapsed]);

    const onResizePointerDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            if (isCollapsed || event.button !== 0) {
                return;
            }

            event.preventDefault();
            dragCleanupRef.current?.();
            const startX = event.clientX;
            const startWidth = width;

            const onPointerMove = (moveEvent: PointerEvent) => {
                const delta = moveEvent.clientX - startX;
                const nextWidth =
                    side === "left" ? startWidth + delta : startWidth - delta;

                dispatch({
                    type: "panel/resized",
                    side,
                    width: clampPanelWidth(nextWidth),
                });
            };

            const cleanupDrag = () => {
                window.removeEventListener("pointermove", onPointerMove);
                window.removeEventListener("pointerup", cleanupDrag);
                window.removeEventListener("pointercancel", cleanupDrag);
                window.removeEventListener("blur", cleanupDrag);
                dragCleanupRef.current = null;
            };
            dragCleanupRef.current = cleanupDrag;

            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", cleanupDrag, { once: true });
            window.addEventListener("pointercancel", cleanupDrag, {
                once: true,
            });
            window.addEventListener("blur", cleanupDrag, { once: true });
        },
        [dispatch, isCollapsed, side, width],
    );

    useEffect(() => {
        return () => {
            dragCleanupRef.current?.();
        };
    }, []);

    return {
        width,
        isCollapsed,
        setCollapsed,
        toggleCollapsed,
        resizeHandleProps: {
            role: "separator",
            "aria-orientation": "vertical" as const,
            "aria-label":
                side === "left"
                    ? "Resize file panel"
                    : "Resize outline panel",
            onPointerDown: onResizePointerDown,
        },
    };
}

function clampPanelWidth(width: number) {
    return Math.min(Math.max(width, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH);
}
