import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { OutlinePanel } from "../components/outline-panel";
import type { MarkdownOutlineHeading } from "./types";
import {
    findRenderedHeadingByIndex,
    scrollRenderedHeadingIntoView,
} from "./outline-scroll";

describe("outline scroll helpers", () => {
    it("matches duplicate heading text by source order", () => {
        const firstHeading = createHeading("Repeat");
        const secondHeading = createHeading("Repeat");
        const root = createHeadingRoot([firstHeading, secondHeading]);

        expect(findRenderedHeadingByIndex(root, 1)).toBe(secondHeading);
    });

    it("does not throw when the heading cannot be found", () => {
        const root = createHeadingRoot([]);

        expect(() => scrollRenderedHeadingIntoView(root, 0)).not.toThrow();
        expect(scrollRenderedHeadingIntoView(root, 0)).toBe(false);
    });

    it("requests scrolling for the heading at the outline index", () => {
        const firstHeading = createHeading("One");
        const secondHeading = createHeading("Two");
        const root = createHeadingRoot([firstHeading, secondHeading]);

        expect(scrollRenderedHeadingIntoView(root, 1)).toBe(true);
        expect(firstHeading.scrollIntoView).not.toHaveBeenCalled();
        expect(secondHeading.scrollIntoView).toHaveBeenCalledWith({
            block: "start",
            inline: "nearest",
        });
    });

    it("calls the outline click handler with the matching heading index", () => {
        const onHeadingClick = vi.fn();
        const headings: MarkdownOutlineHeading[] = [
            { id: "one", level: 1, text: "One", line: 1 },
            { id: "two", level: 2, text: "Two", line: 2 },
        ];
        const tree = OutlinePanel({
            headings,
            collapsed: false,
            onToggleCollapsed: () => {},
            onHeadingClick,
            resizeHandleProps: {} as never,
        });
        const headingButton = collectButtons(tree).find(
            (button) => button.props.title === "Two",
        );

        expect(headingButton).toBeTruthy();

        headingButton?.props.onClick();

        expect(onHeadingClick).toHaveBeenCalledTimes(1);
        expect(onHeadingClick).toHaveBeenCalledWith(headings[1], 1);
    });
});

function createHeading(text: string) {
    return {
        scrollIntoView: vi.fn(),
        textContent: text,
    } as unknown as HTMLElement;
}

function createHeadingRoot(headings: HTMLElement[]) {
    return {
        querySelectorAll: vi.fn(() => headings),
    } as unknown as ParentNode;
}

function collectButtons(
    node: ReactElement | null,
): ReactElement<Record<string, unknown>>[] {
    if (!node || !isValidElement(node)) {
        return [];
    }

    const props = node.props as Record<string, unknown>;
    const children = props.children;
    const directChildren = Array.isArray(children) ? children : [children];
    const nestedButtons = directChildren.flatMap((child) =>
        isValidElement(child) ? collectButtons(child) : [],
    );

    return [
        ...(node.type === "button" ? [node as ReactElement<Record<string, unknown>>] : []),
        ...nestedButtons,
    ];
}
