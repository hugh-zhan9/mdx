import { describe, expect, it } from "vitest";
import {
    isSelectAllShortcut,
    resolveScopedSelectAllTarget,
    shouldUseNativeSelectAllTarget,
} from "./keyboard-selection-scope";

describe("isSelectAllShortcut", () => {
    it("recognizes platform select-all without alt", () => {
        expect(
            isSelectAllShortcut({
                altKey: false,
                code: "KeyA",
                ctrlKey: false,
                key: "a",
                metaKey: true,
            }),
        ).toBe(true);
        expect(
            isSelectAllShortcut({
                altKey: false,
                code: "KeyA",
                ctrlKey: true,
                key: "a",
                metaKey: false,
            }),
        ).toBe(true);
        expect(
            isSelectAllShortcut({
                altKey: true,
                code: "KeyA",
                ctrlKey: false,
                key: "a",
                metaKey: true,
            }),
        ).toBe(false);
    });
});

describe("resolveScopedSelectAllTarget", () => {
    it("selects the active MDX code block when the event starts inside code", () => {
        const container = element("section");
        const root = child(container, "div");
        root.setAttribute("data-mdx-editor-root", "");
        const paragraph = child(root, "p");
        const pre = child(root, "pre");
        pre.setAttribute("data-mdx-code-block", "");
        const code = child(pre, "code");
        const token = child(code, "span", "token");

        expect(resolveScopedSelectAllTarget(token, container)).toBe(pre);
        expect(resolveScopedSelectAllTarget(paragraph, container)).toBe(root);
    });

    it("uses the selection anchor when contenteditable key events target the root", () => {
        const container = element("section");
        const root = child(container, "div");
        root.setAttribute("data-mdx-editor-root", "");
        const pre = child(root, "pre");
        pre.setAttribute("data-mdx-code-block", "");
        const code = child(pre, "code");
        const token = child(code, "span", "token");

        expect(resolveScopedSelectAllTarget(root, container, token)).toBe(pre);
    });

    it("selects the active blockquote instead of the whole editor", () => {
        const container = element("section");
        const root = child(container, "div");
        root.setAttribute("data-mdx-editor-root", "");
        const quote = child(root, "blockquote");
        quote.setAttribute("data-mdx-node-type", "blockquote");
        const paragraph = child(quote, "p");

        expect(resolveScopedSelectAllTarget(paragraph, container)).toBe(quote);
    });

    it("ignores events outside the editor root", () => {
        const container = element("section");
        const root = child(container, "div");
        root.setAttribute("data-mdx-editor-root", "");
        const outside = element("button");

        expect(resolveScopedSelectAllTarget(outside, container)).toBeNull();
    });
});

describe("shouldUseNativeSelectAllTarget", () => {
    it("keeps select-all native inside text editing controls", () => {
        const textarea = element("textarea");
        const wrapper = element("div");
        const input = child(wrapper, "input");
        const roleTextbox = child(wrapper, "div");
        roleTextbox.setAttribute("role", "textbox");

        expect(shouldUseNativeSelectAllTarget(textarea)).toBe(true);
        expect(shouldUseNativeSelectAllTarget(input)).toBe(true);
        expect(shouldUseNativeSelectAllTarget(roleTextbox)).toBe(true);
        expect(shouldUseNativeSelectAllTarget(wrapper)).toBe(false);
    });
});

function element(tagName: string, className = ""): TestElement {
    return new TestElement(tagName, className);
}

function child(parent: TestElement, tagName: string, className = ""): TestElement {
    const next = element(tagName, className);
    parent.appendChild(next);
    return next;
}

class TestElement {
    private readonly children: TestElement[] = [];
    private readonly attributes = new Map<string, string>();
    private parent: TestElement | null = null;
    readonly nodeType = 1;

    constructor(
        readonly tagName: string,
        readonly className = "",
    ) {}

    appendChild(child: TestElement): void {
        child.parent = this;
        this.children.push(child);
    }

    contains(target: TestElement): boolean {
        if (target === this) {
            return true;
        }

        return this.children.some((child) => child.contains(target));
    }

    closest(selector: string): TestElement | null {
        if (this.matches(selector)) {
            return this;
        }

        return this.parent?.closest(selector) ?? null;
    }

    querySelector(selector: string): TestElement | null {
        if (this.matches(selector)) {
            return this;
        }

        for (const child of this.children) {
            const found = child.querySelector(selector);
            if (found) {
                return found;
            }
        }

        return null;
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    private matches(selector: string): boolean {
        const selectors = selector.split(",").map((part) => part.trim());
        return selectors.some((part) => {
            if (/^[a-z][a-z0-9-]*$/i.test(part)) {
                return this.tagName.toLowerCase() === part.toLowerCase();
            }

            if (part.startsWith(".")) {
                return this.className === part.slice(1);
            }

            const attributeMatch = part.match(
                /^\[([^\]=]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/,
            );
            if (!attributeMatch) {
                return false;
            }

            const [, attributeName, expectedValue] = attributeMatch;
            const actualValue = this.getAttribute(attributeName);
            if (actualValue === null) {
                return false;
            }

            return (
                expectedValue === undefined || actualValue === expectedValue
            );
        });
    }
}
