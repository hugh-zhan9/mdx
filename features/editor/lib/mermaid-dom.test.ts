import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    applyMermaidSourceVisibility,
    mapMermaidFencesToPreElements,
} from "./mermaid-dom";
import type { MermaidCodeFence } from "./mermaid-code-fences";

describe("mermaid dom helpers", () => {
    beforeEach(() => {
        installDomFixture();
    });

    afterEach(() => {
        uninstallDomFixture();
    });

    it("maps mermaid fences to MDX code blocks by fenced-code order", () => {
        const root = document.createElement("div");
        root.append(pre("ts"));
        const mermaidPre = pre("mermaid");
        root.append(mermaidPre);

        const fences: MermaidCodeFence[] = [
            {
                code: "graph TD\n  A --> B",
                codeBlockIndex: 1,
                fenceChar: "`",
                fenceLength: 3,
                info: "mermaid",
                language: "mermaid",
            },
        ];

        expect(mapMermaidFencesToPreElements(root, fences)).toEqual([
            {
                fence: fences[0],
                pre: mermaidPre,
                stableId: "mermaid-1",
            },
        ]);
    });

    it("does not map mermaid fences to non-mermaid code blocks", () => {
        const root = document.createElement("div");
        const plainPre = pre("text");
        root.append(plainPre);

        const fences: MermaidCodeFence[] = [
            {
                code: "graph TD\n  A --> B",
                codeBlockIndex: 0,
                fenceChar: "`",
                fenceLength: 3,
                info: "mermaid",
                language: "mermaid",
            },
        ];

        expect(mapMermaidFencesToPreElements(root, fences)).toEqual([]);
    });

    it("hides preview-mode sources and reveals editing sources", () => {
        const source = pre("mermaid");

        applyMermaidSourceVisibility(source, "preview");
        expect(source.hidden).toBe(true);
        expect(source.getAttribute("aria-hidden")).toBe("true");
        expect(source.classList.contains("mdx-mermaid-source-hidden")).toBe(
            true,
        );

        applyMermaidSourceVisibility(source, "editing");
        expect(source.hidden).toBe(false);
        expect(source.getAttribute("aria-hidden")).toBeNull();
        expect(source.classList.contains("mdx-mermaid-source-hidden")).toBe(
            false,
        );
    });
});

function pre(language: string): HTMLPreElement {
    const element = document.createElement("pre");
    element.setAttribute("data-mdx-code-block", "");
    element.setAttribute("data-mdx-node-type", "code_block");
    element.setAttribute("data-mdx-language", language);
    const code = document.createElement("code");
    code.textContent = language;
    element.append(code);
    return element;
}

const originalDocument = globalThis.document;

function installDomFixture(): void {
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement: (tagName: string) => new TestElement(tagName),
        },
    });
}

function uninstallDomFixture(): void {
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
    });
}

class TestElement {
    readonly children: TestElement[] = [];
    readonly dataset: Record<string, string> = {};
    hidden = false;
    textContent = "";
    private readonly attributes = new Map<string, string>();
    private classNames: string[] = [];

    constructor(readonly tagName: string) {}

    get className(): string {
        return this.classNames.join(" ");
    }

    set className(value: string) {
        this.classNames = value.split(/\s+/).filter(Boolean);
    }

    readonly classList = {
        contains: (className: string) => this.classNames.includes(className),
        toggle: (className: string, force?: boolean) => {
            const enabled = force ?? !this.classNames.includes(className);
            if (enabled && !this.classNames.includes(className)) {
                this.classNames.push(className);
            }
            if (!enabled) {
                this.classNames = this.classNames.filter(
                    (currentClassName) => currentClassName !== className,
                );
            }
            return enabled;
        },
    };

    append(child: TestElement): void {
        this.children.push(child);
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    querySelectorAll(selector: string): TestElement[] {
        return this.children.flatMap((child) => [
            ...(child.matches(selector) ? [child] : []),
            ...child.querySelectorAll(selector),
        ]);
    }

    private matches(selector: string): boolean {
        if (selector !== "[data-mdx-code-block]") {
            return false;
        }
        return this.getAttribute("data-mdx-code-block") !== null;
    }
}
