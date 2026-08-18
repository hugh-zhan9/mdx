"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
    clampListWidth,
    clampRailWidth,
} from "../lib/panel-layout";
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

const MAX_PANEL_WIDTH = 820;

export function usePanelResize({
    side,
    panel,
    dispatch,
}: UsePanelResizeOptions) {
    const dragCleanupRef = useRef<(() => void) | null>(null);
    const width =
        side === "list"
            ? clampListWidth(panel.listWidth)
            : side === "rail"
              ? clampRailWidth(panel.railWidth)
              : panel.rightWidth;
    // Both navigator columns are hidden together, so they share one flag.
    const isCollapsed =
        side === "right" ? panel.rightCollapsed : panel.navigatorCollapsed;

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
                // The right panel's handle is on its left edge, so dragging
                // right makes it narrower; the other two grow to the right.
                const nextWidth =
                    side === "right" ? startWidth - delta : startWidth + delta;

                dispatch({
                    type: "panel/resized",
                    side,
                    width: clampWidthForSide(side, nextWidth),
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
                side === "list"
                    ? "调整笔记列表宽度"
                    : side === "rail"
                      ? "调整文件树宽度"
                      : "调整右侧面板宽度",
            onPointerDown: onResizePointerDown,
        },
    };
}

/**
 * Keeps a drag inside what that column can be.
 *
 * Each column has its own limits and nothing else's: dragging the folder tree
 * wider makes the navigator wider, and the editor is what gives up the room.
 */
function clampWidthForSide(side: WorkspacePanelSide, width: number) {
    if (side === "rail") {
        return clampRailWidth(width);
    }

    if (side === "list") {
        return clampListWidth(width);
    }

    return Math.min(Math.max(width, 160), MAX_PANEL_WIDTH);
}
