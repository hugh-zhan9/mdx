import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
    EditorFindBar,
    type EditorFindBarProps,
} from "./editor-find-bar";

const defaultProps: EditorFindBarProps = {
    caseSensitive: false,
    countLabel: "0/0",
    isReplaceExpanded: false,
    matchCount: 0,
    query: "",
    replacement: "",
    onCaseSensitiveToggle: vi.fn(),
    onClose: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onQueryChange: vi.fn(),
    onReplaceAll: vi.fn(),
    onReplaceCurrent: vi.fn(),
    onReplacementChange: vi.fn(),
    onReplaceToggle: vi.fn(),
};

function renderBar(overrides: Partial<EditorFindBarProps> = {}) {
    return EditorFindBar({ ...defaultProps, ...overrides });
}

function collectElements(node: ReactNode): ReactElement[] {
    if (!isValidElement(node)) {
        return [];
    }

    const children = node.props.children as ReactNode;
    const childElements = Array.isArray(children)
        ? children.flatMap(collectElements)
        : collectElements(children);

    return [node, ...childElements];
}

function textContent(node: ReactNode): string {
    if (typeof node === "string" || typeof node === "number") {
        return String(node);
    }

    if (!isValidElement(node)) {
        return "";
    }

    const children = node.props.children as ReactNode;

    if (Array.isArray(children)) {
        return children.map(textContent).join("");
    }

    return textContent(children);
}

describe("EditorFindBar", () => {
    it("renders find controls and count label", () => {
        const bar = renderBar({
            countLabel: "1/3",
            matchCount: 3,
            query: "raw",
        });
        const elements = collectElements(bar);
        const inputs = elements.filter((element) => element.type === "input");
        const buttons = elements.filter((element) => element.type === "button");

        expect(inputs[0].props.value).toBe("raw");
        expect(textContent(bar)).toContain("1/3");
        expect(
            buttons.some((button) => button.props["aria-label"] === "下一处"),
        ).toBe(true);
    });

    it("renders replace controls when expanded", () => {
        const bar = renderBar({
            isReplaceExpanded: true,
            replacement: "source",
        });
        const inputs = collectElements(bar).filter(
            (element) => element.type === "input",
        );

        expect(inputs[1].props.value).toBe("source");
        expect(textContent(bar)).toContain("替换全部");
    });

    it("submits next and previous from find input on Enter and Shift+Enter", () => {
        const onNext = vi.fn();
        const onPrevious = vi.fn();
        const bar = renderBar({ onNext, onPrevious });
        const findInput = collectElements(bar).find(
            (element) =>
                element.type === "input" && element.props["aria-label"] === "查找",
        );
        const preventDefault = vi.fn();

        findInput?.props.onKeyDown({
            key: "Enter",
            preventDefault,
            shiftKey: false,
        });
        findInput?.props.onKeyDown({
            key: "Enter",
            preventDefault,
            shiftKey: true,
        });

        expect(preventDefault).toHaveBeenCalledTimes(2);
        expect(onNext).toHaveBeenCalledTimes(1);
        expect(onPrevious).toHaveBeenCalledTimes(1);
    });

    it("closes on Escape from find input", () => {
        const onClose = vi.fn();
        const bar = renderBar({ onClose });
        const findInput = collectElements(bar).find(
            (element) =>
                element.type === "input" && element.props["aria-label"] === "查找",
        );
        const preventDefault = vi.fn();

        findInput?.props.onKeyDown({
            key: "Escape",
            preventDefault,
            shiftKey: false,
        });

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });
});
