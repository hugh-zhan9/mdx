"use client";

import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

export interface ContextMenuItem {
    label: string;
    onSelect: () => void;
    /** Drawn in the destructive tone: it throws something away. */
    destructive?: boolean;
    /** Offered but not now, with the reason as its title. */
    disabled?: boolean;
    disabledReason?: string;
    /** Draws a divider above this item, grouping what follows. */
    separatorBefore?: boolean;
}

interface ContextMenuProps {
    /** Where the pointer was. The menu keeps itself on screen from there. */
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

/** Enough width for the labels this app puts in a menu. */
const MENU_WIDTH = 200;
const ITEM_HEIGHT = 30;
const SEPARATOR_HEIGHT = 9;
const VERTICAL_PADDING = 8;
const SCREEN_INSET = 8;

/**
 * The menu a right-click opens, wherever it was opened.
 *
 * Shared because it had been written once for the file tree and was about to be
 * written again for the tabs, and the second copy is where the radius, the
 * hover tone and the destructive colour start to disagree. It also keeps the two
 * behaviours a menu has to have: it closes when you click elsewhere or press
 * Escape, and it stays on screen when opened near an edge.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        /**
         * Closes on a press outside the menu — and only outside it.
         *
         * A real click is a `pointerdown` followed by a `click`. Closing on any
         * press, which is what this did first, unmounted the menu before its own
         * item could be clicked: every item did nothing at all. Stopping
         * propagation inside the menu cannot fix that, because this listener runs
         * in the capture phase, so it has to ask where the press landed.
         */
        const closeOnOutsidePress = (event: Event) => {
            const target = event.target;

            if (
                target instanceof Node &&
                menuRef.current?.contains(target) === true
            ) {
                return;
            }

            onClose();
        };
        const close = () => onClose();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        // Capture, so a click that lands on something which stops propagation
        // still dismisses the menu.
        window.addEventListener("pointerdown", closeOnOutsidePress, {
            capture: true,
        });
        window.addEventListener("blur", close);
        window.addEventListener("keydown", onKeyDown);

        return () => {
            window.removeEventListener("pointerdown", closeOnOutsidePress, {
                capture: true,
            });
            window.removeEventListener("blur", close);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [onClose]);

    if (items.length === 0) {
        return null;
    }

    const height =
        VERTICAL_PADDING +
        items.length * ITEM_HEIGHT +
        items.filter((item) => item.separatorBefore).length * SEPARATOR_HEIGHT;
    const left = clamp(x, SCREEN_INSET, viewportWidth() - MENU_WIDTH - SCREEN_INSET);
    const top = clamp(y, SCREEN_INSET, viewportHeight() - height - SCREEN_INSET);

    const select = (item: ContextMenuItem) => (
        event: ReactMouseEvent<HTMLButtonElement>,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        item.onSelect();
        onClose();
    };

    return (
        <div
            ref={menuRef}
            role="menu"
            data-mdx-context-menu=""
            className="fixed z-30 rounded-lg bg-base-100 py-1 text-sm shadow-[0_0_0_0.5px_color-mix(in_srgb,var(--color-base-content)_14%,transparent),0_12px_32px_-8px_color-mix(in_srgb,var(--color-base-content)_40%,transparent)]"
            style={{ left, top, minWidth: MENU_WIDTH }}
            // A right-click inside the menu should not open a second one.
            onContextMenu={(event) => event.preventDefault()}
        >
            {items.map((item) => (
                <div key={item.label}>
                    {item.separatorBefore ? (
                        <div className="my-1 border-t border-[var(--mdx-separator)]" />
                    ) : null}
                    <button
                        type="button"
                        role="menuitem"
                        disabled={item.disabled}
                        title={item.disabled ? item.disabledReason : undefined}
                        className={[
                            "block w-full whitespace-nowrap px-3 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:text-base-content/35",
                            item.destructive
                                ? "text-error hover:bg-error/10 disabled:hover:bg-transparent"
                                : "text-base-content/75 hover:bg-base-200 disabled:hover:bg-transparent",
                        ].join(" ")}
                        onClick={select(item)}
                    >
                        {item.label}
                    </button>
                </div>
            ))}
        </div>
    );
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

function viewportWidth() {
    return typeof window === "undefined" ? MENU_WIDTH * 2 : window.innerWidth;
}

function viewportHeight() {
    return typeof window === "undefined" ? 600 : window.innerHeight;
}
