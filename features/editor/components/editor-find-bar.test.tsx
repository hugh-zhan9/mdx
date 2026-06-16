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

function getInputByLabel(node: ReactNode, label: string) {
    const input = collectElements(node).find(
        (element) =>
            element.type === "input" && element.props["aria-label"] === label,
    );

    if (!input) {
        throw new Error(`Expected input with aria-label "${label}"`);
    }

    return input;
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
        expect(inputs[0].props.autoFocus).toBe(true);
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
        const findInput = getInputByLabel(bar, "查找");
        const preventDefault = vi.fn();

        findInput.props.onKeyDown({
            key: "Enter",
            preventDefault,
            shiftKey: false,
        });
        findInput.props.onKeyDown({
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
        const findInput = getInputByLabel(bar, "查找");
        const preventDefault = vi.fn();

        findInput.props.onKeyDown({
            key: "Escape",
            preventDefault,
            shiftKey: false,
        });

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("does not update the find query until IME composition commits", () => {
        const onQueryChange = vi.fn();
        const bar = renderBar({ onQueryChange });
        const findInput = getInputByLabel(bar, "查找");

        findInput.props.onChange({
            target: { value: "w" },
            nativeEvent: { isComposing: true },
        });

        expect(onQueryChange).not.toHaveBeenCalled();

        findInput.props.onCompositionEnd({
            currentTarget: { value: "我" },
        });

        expect(onQueryChange).toHaveBeenCalledOnce();
        expect(onQueryChange).toHaveBeenCalledWith("我");
    });

    it("submits replace current from replacement input when replace is available", () => {
        const onReplaceCurrent = vi.fn();
        const bar = renderBar({
            isReplaceExpanded: true,
            matchCount: 2,
            onReplaceCurrent,
            query: "raw",
        });
        const replacementInput = getInputByLabel(bar, "替换为");
        const preventDefault = vi.fn();

        replacementInput.props.onKeyDown({
            key: "Enter",
            preventDefault,
            shiftKey: false,
        });

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(onReplaceCurrent).toHaveBeenCalledOnce();
    });

    it("does not submit replace current from replacement input when query is empty", () => {
        const onReplaceCurrent = vi.fn();
        const bar = renderBar({
            isReplaceExpanded: true,
            matchCount: 2,
            onReplaceCurrent,
            query: "",
        });
        const replacementInput = getInputByLabel(bar, "替换为");
        const preventDefault = vi.fn();

        replacementInput.props.onKeyDown({
            key: "Enter",
            preventDefault,
            shiftKey: false,
        });

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(onReplaceCurrent).not.toHaveBeenCalled();
    });

    it("does not submit replace current from replacement input when there are no matches", () => {
        const onReplaceCurrent = vi.fn();
        const bar = renderBar({
            isReplaceExpanded: true,
            matchCount: 0,
            onReplaceCurrent,
            query: "raw",
        });
        const replacementInput = getInputByLabel(bar, "替换为");
        const preventDefault = vi.fn();

        replacementInput.props.onKeyDown({
            key: "Enter",
            preventDefault,
            shiftKey: false,
        });

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(onReplaceCurrent).not.toHaveBeenCalled();
    });

    it("closes on Escape from replacement input", () => {
        const onClose = vi.fn();
        const bar = renderBar({
            isReplaceExpanded: true,
            onClose,
        });
        const replacementInput = getInputByLabel(bar, "替换为");
        const preventDefault = vi.fn();

        replacementInput.props.onKeyDown({
            key: "Escape",
            preventDefault,
            shiftKey: false,
        });

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });
});
