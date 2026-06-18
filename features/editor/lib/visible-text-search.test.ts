import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    buildVisibleTextIndex,
    findVisibleTextMatches,
    rangeForVisibleTextMatch,
} from "./visible-text-search";

describe("visible text search", () => {
    beforeEach(() => {
        installDomFixture();
    });

    afterEach(() => {
        uninstallDomFixture();
    });

    it("finds visible paragraph text case-insensitively by default", () => {
        const root = editorRoot();
        paragraph(root, "Raw material lives here.");

        const index = buildVisibleTextIndex(root);
        const matches = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        expect(index.text).toBe("Raw material lives here.");
        expect(matches).toEqual([
            {
                end: 3,
                start: 0,
            },
        ]);
    });

    it("honors case-sensitive matching", () => {
        const root = editorRoot();
        paragraph(root, "Raw raw RAW");
        const index = buildVisibleTextIndex(root);

        expect(
            findVisibleTextMatches(index, "raw", { caseSensitive: false }),
        ).toHaveLength(3);
        expect(
            findVisibleTextMatches(index, "raw", { caseSensitive: true }),
        ).toEqual([{ start: 4, end: 7 }]);
    });

    it("preserves original offsets when lowercase changes string length", () => {
        const root = editorRoot();
        paragraph(root, "İraw");
        const index = buildVisibleTextIndex(root);

        expect(
            findVisibleTextMatches(index, "raw", { caseSensitive: false }),
        ).toEqual([{ start: 1, end: 4 }]);
    });

    it("includes visible code block text", () => {
        const root = editorRoot();
        codeBlock(root, "const raw = true;");

        const index = buildVisibleTextIndex(root);
        const matches = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        expect(index.text).toContain("const raw = true;");
        expect(matches).toEqual([{ start: 6, end: 9 }]);
    });

    it("excludes hidden mermaid source and includes it when revealed", () => {
        const root = editorRoot();
        const pre = codeBlock(root, "graph TD\n  HiddenRaw --> B", "mdx-mermaid-source-hidden");
        pre.hidden = true;
        pre.setAttribute("aria-hidden", "true");

        expect(buildVisibleTextIndex(root).text).toBe("");

        pre.hidden = false;
        pre.removeAttribute("aria-hidden");
        pre.className = "";

        expect(buildVisibleTextIndex(root).text).toContain("HiddenRaw");
    });

    it("excludes generated mermaid preview UI", () => {
        const root = editorRoot();
        codeBlock(root, "graph TD\n  SourceRaw --> B");
        const preview = child(root, "div", "mdx-mermaid-preview");
        preview.setAttribute("data-mdx-mermaid-preview", "mermaid-0");
        child(preview, "button", "mdx-mermaid-edit-button", "编辑");
        const svg = child(preview, "svg");
        child(svg, "text", "", "GeneratedLabel");

        const index = buildVisibleTextIndex(root);

        expect(index.text).toContain("SourceRaw");
        expect(index.text).not.toContain("编辑");
        expect(index.text).not.toContain("GeneratedLabel");
    });

    it("excludes data-mdx-syntax marker elements", () => {
        const root = editorRoot();
        const paragraph = paragraphNode(root);
        const openSyntax = child(paragraph, "span", "", "![");
        openSyntax.setAttribute("data-mdx-syntax", "image_open");
        child(paragraph, "span", "", "Visible alt");
        const closeSyntax = child(paragraph, "span", "", "](assets/raw.png)");
        closeSyntax.setAttribute("data-mdx-syntax", "image_close");

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Visible alt");
        expect(
            findVisibleTextMatches(index, "assets/raw.png", {
                caseSensitive: false,
            }),
        ).toEqual([]);
    });

    it("excludes link hrefs while keeping visible link labels", () => {
        const root = editorRoot();
        const link = child(root, "a");
        link.setAttribute("href", "https://example.com/raw-secret");
        child(link, "span", "", "Raw label");

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Raw label");
        expect(
            findVisibleTextMatches(index, "raw label", {
                caseSensitive: false,
            }),
        ).toHaveLength(1);
        expect(
            findVisibleTextMatches(index, "raw-secret", {
                caseSensitive: false,
            }),
        ).toEqual([]);
    });

    it("excludes display-none nodes", () => {
        const root = editorRoot();
        paragraph(root, "Visible");
        const hidden = child(root, "span", "", "Hidden raw");
        hidden.style.display = "none";

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Visible");
        expect(
            findVisibleTextMatches(index, "hidden", { caseSensitive: false }),
        ).toEqual([]);
    });

    it("excludes nodes hidden by computed styles", () => {
        const root = editorRoot();
        paragraph(root, "Visible");
        const hidden = child(root, "span", "", "Hidden raw");
        hidden.computedStyle.display = "none";

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Visible");
        expect(
            findVisibleTextMatches(index, "hidden", { caseSensitive: false }),
        ).toEqual([]);
    });

    it("excludes the whole index when the root is hidden", () => {
        const root = editorRoot();
        root.computedStyle.visibility = "hidden";
        paragraph(root, "Hidden raw");

        const index = buildVisibleTextIndex(root);

        expect(index).toEqual({ segments: [], text: "" });
    });

    it("creates a DOM range for a single-node match", () => {
        const root = editorRoot();
        const paragraphElement = paragraph(root, "Find raw here");
        const index = buildVisibleTextIndex(root);
        const [match] = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        const range = rangeForVisibleTextMatch(index, match);

        expect(range?.startContainer).toBe(paragraphElement.firstChild);
        expect(range?.startOffset).toBe(5);
        expect(range?.endContainer).toBe(paragraphElement.firstChild);
        expect(range?.endOffset).toBe(8);
    });

    it("creates a DOM range for a match spanning text nodes", () => {
        const root = editorRoot();
        const paragraph = paragraphNode(root);
        const first = child(paragraph, "span", "", "Find ra");
        const second = child(paragraph, "span", "", "w here");
        const index = buildVisibleTextIndex(root);
        const [match] = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        const range = rangeForVisibleTextMatch(index, match);

        expect(range?.startContainer).toBe(first.firstChild);
        expect(range?.startOffset).toBe(5);
        expect(range?.endContainer).toBe(second.firstChild);
        expect(range?.endOffset).toBe(1);
    });

    it("creates a DOM range for a multi-node match ending at a text node boundary", () => {
        const root = editorRoot();
        const paragraph = paragraphNode(root);
        const first = child(paragraph, "span", "", "Find ra");
        const second = child(paragraph, "span", "", "w");
        const index = buildVisibleTextIndex(root);
        const [match] = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        const range = rangeForVisibleTextMatch(index, match);

        expect(range?.startContainer).toBe(first.firstChild);
        expect(range?.startOffset).toBe(5);
        expect(range?.endContainer).toBe(second.firstChild);
        expect(range?.endOffset).toBe(1);
    });
});

function element(tagName: string, className = "", text = ""): TestElement {
    return new TestElement(tagName, className, text);
}

function child(
    parent: TestElement,
    tagName: string,
    className = "",
    text = "",
): TestElement {
    const node = element(tagName, className, text);
    parent.appendChild(node);
    return node;
}

function editorRoot(): TestElement {
    const root = element("div");
    root.setAttribute("data-mdx-editor-root", "");
    return root;
}

function paragraph(parent: TestElement, text = ""): TestElement {
    const node = child(parent, "p", "", text);
    node.setAttribute("data-mdx-node-type", "paragraph");
    return node;
}

function paragraphNode(parent: TestElement): TestElement {
    return paragraph(parent);
}

function codeBlock(
    parent: TestElement,
    text: string,
    className = "",
): TestElement {
    const pre = child(parent, "pre", className);
    pre.setAttribute("data-mdx-node-type", "code_block");
    pre.setAttribute("data-mdx-code-block", "");
    child(pre, "code", "", text);
    return pre;
}

const originalGlobals = {
    document: globalThis.document,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    HTMLImageElement: globalThis.HTMLImageElement,
    Node: globalThis.Node,
    window: globalThis.window,
};

function installDomFixture(): void {
    Object.defineProperties(globalThis, {
        document: {
            configurable: true,
            value: {
                createRange: () => new TestRange(),
            },
        },
        Element: {
            configurable: true,
            value: TestElement,
        },
        HTMLElement: {
            configurable: true,
            value: TestElement,
        },
        HTMLImageElement: {
            configurable: true,
            value: TestImageElement,
        },
        Node: {
            configurable: true,
            value: TestNode,
        },
        window: {
            configurable: true,
            value: {
                getComputedStyle: (element: TestElement) =>
                    element.computedStyle,
            },
        },
    });
}

function uninstallDomFixture(): void {
    Object.defineProperties(globalThis, {
        document: {
            configurable: true,
            value: originalGlobals.document,
        },
        Element: {
            configurable: true,
            value: originalGlobals.Element,
        },
        HTMLElement: {
            configurable: true,
            value: originalGlobals.HTMLElement,
        },
        HTMLImageElement: {
            configurable: true,
            value: originalGlobals.HTMLImageElement,
        },
        Node: {
            configurable: true,
            value: originalGlobals.Node,
        },
        window: {
            configurable: true,
            value: originalGlobals.window,
        },
    });
}

class TestNode {
    static readonly TEXT_NODE = 3;
    readonly nodeType: number;

    constructor(nodeType: number) {
        this.nodeType = nodeType;
    }
}

class TestText extends TestNode {
    readonly textContent: string;

    constructor(textContent: string) {
        super(TestNode.TEXT_NODE);
        this.textContent = textContent;
    }
}

class TestElement extends TestNode {
    readonly childNodes: Array<TestElement | TestText> = [];
    readonly classList = {
        contains: (className: string) => this.classNames.includes(className),
    };
    readonly computedStyle = {
        display: "",
        visibility: "",
    };
    readonly style = {
        display: "",
        visibility: "",
    };
    hidden = false;
    private readonly attributes = new Map<string, string>();
    private classNames: string[];
    private parentNode: TestElement | null = null;

    constructor(
        readonly tagName: string,
        className = "",
        text = "",
    ) {
        super(1);
        this.className = className;
        if (text) {
            this.textContent = text;
        }
    }

    get className(): string {
        return this.classNames.join(" ");
    }

    set className(value: string) {
        this.classNames = value.split(/\s+/).filter(Boolean);
    }

    get firstChild(): TestElement | TestText | null {
        return this.childNodes[0] ?? null;
    }

    get parentElement(): TestElement | null {
        return this.parentNode;
    }

    get textContent(): string {
        return this.childNodes
            .map((childNode) => childNode.textContent ?? "")
            .join("");
    }

    set textContent(value: string) {
        this.childNodes.length = 0;
        if (value) {
            this.childNodes.push(new TestText(value));
        }
    }

    appendChild(childNode: TestElement): void {
        childNode.parentNode = this;
        this.childNodes.push(childNode);
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }

    matches(selector: string): boolean {
        const attributeMatch = selector.match(/^\[([^\]=]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/);
        if (!attributeMatch) {
            return false;
        }

        const [, attributeName, expectedValue] = attributeMatch;
        const actualValue = this.getAttribute(attributeName);
        if (actualValue === null) {
            return false;
        }

        return expectedValue === undefined || actualValue === expectedValue;
    }

    closest(selector: string): TestElement | null {
        if (this.matches(selector)) {
            return this;
        }

        return this.parentElement?.closest(selector) ?? null;
    }
}

class TestImageElement extends TestElement {}

class TestRange {
    endContainer: TestElement | TestText | null = null;
    endOffset = 0;
    startContainer: TestElement | TestText | null = null;
    startOffset = 0;

    setEnd(node: TestElement | TestText, offset: number): void {
        this.endContainer = node;
        this.endOffset = offset;
    }

    setStart(node: TestElement | TestText, offset: number): void {
        this.startContainer = node;
        this.startOffset = offset;
    }
}
