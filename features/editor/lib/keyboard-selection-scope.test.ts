import { describe, expect, it } from "vitest";
import {
    isSelectAllShortcut,
    resolveScopedSelectAllTarget,
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
    it("selects the active code block when the event starts inside code", () => {
        const container = element("section");
        const root = child(container, "div", "DOMD-Root");
        const paragraph = child(root, "p", "DOMD-P");
        const pre = child(root, "pre", "DOMD-Pre");
        const code = child(pre, "code", "DOMD-PreCode");
        const token = child(code, "span", "token");

        expect(resolveScopedSelectAllTarget(token, container)).toBe(code);
        expect(resolveScopedSelectAllTarget(paragraph, container)).toBe(root);
    });

    it("uses the selection anchor when contenteditable key events target the root", () => {
        const container = element("section");
        const root = child(container, "div", "DOMD-Root");
        const pre = child(root, "pre", "DOMD-Pre");
        const code = child(pre, "code", "DOMD-PreCode");
        const token = child(code, "span", "token");

        expect(resolveScopedSelectAllTarget(root, container, token)).toBe(code);
    });

    it("ignores events outside the editor root", () => {
        const container = element("section");
        child(container, "div", "DOMD-Root");
        const outside = element("button");

        expect(resolveScopedSelectAllTarget(outside, container)).toBeNull();
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
        const classNames = selector
            .split(",")
            .map((part) => part.trim().replace(/^\./, ""));
        if (classNames.includes(this.className)) {
            return this;
        }

        return this.parent?.closest(selector) ?? null;
    }

    querySelector(selector: string): TestElement | null {
        const className = selector.replace(/^\./, "");
        if (this.className === className) {
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
}
