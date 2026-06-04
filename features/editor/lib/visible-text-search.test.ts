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
        const root = element("div", "DOMD-Root");
        child(root, "p", "DOMD-P", "Raw material lives here.");

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
        const root = element("div", "DOMD-Root");
        child(root, "p", "DOMD-P", "Raw raw RAW");
        const index = buildVisibleTextIndex(root);

        expect(
            findVisibleTextMatches(index, "raw", { caseSensitive: false }),
        ).toHaveLength(3);
        expect(
            findVisibleTextMatches(index, "raw", { caseSensitive: true }),
        ).toEqual([{ start: 4, end: 7 }]);
    });

    it("includes visible code block text", () => {
        const root = element("div", "DOMD-Root");
        const pre = child(root, "pre", "DOMD-Pre");
        child(pre, "code", "DOMD-PreCode", "const raw = true;");

        const index = buildVisibleTextIndex(root);
        const matches = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        expect(index.text).toContain("const raw = true;");
        expect(matches).toEqual([{ start: 6, end: 9 }]);
    });

    it("excludes hidden markdown syntax marker elements", () => {
        const root = element("div", "DOMD-Root");
        const paragraph = child(root, "p", "DOMD-P");
        child(paragraph, "span", "DOMD-MdSymbol", "![");
        child(paragraph, "span", "DOMD-Plain", "Visible alt");
        child(paragraph, "span", "DOMD-MdSymbol", "](assets/raw.png)");

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Visible alt");
        expect(
            findVisibleTextMatches(index, "assets/raw.png", {
                caseSensitive: false,
            }),
        ).toEqual([]);
    });

    it("excludes link hrefs while keeping visible link labels", () => {
        const root = element("div", "DOMD-Root");
        const link = child(root, "a", "DOMD-Link");
        link.setAttribute("href", "https://example.com/raw-secret");
        child(link, "span", "DOMD-Plain", "Raw label");

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
        const root = element("div", "DOMD-Root");
        child(root, "p", "DOMD-P", "Visible");
        const hidden = child(root, "span", "DOMD-Plain", "Hidden raw");
        hidden.style.display = "none";

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Visible");
        expect(
            findVisibleTextMatches(index, "hidden", { caseSensitive: false }),
        ).toEqual([]);
    });

    it("excludes nodes hidden by computed styles", () => {
        const root = element("div", "DOMD-Root");
        child(root, "p", "DOMD-P", "Visible");
        const hidden = child(root, "span", "DOMD-Plain", "Hidden raw");
        hidden.computedStyle.display = "none";

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Visible");
        expect(
            findVisibleTextMatches(index, "hidden", { caseSensitive: false }),
        ).toEqual([]);
    });

    it("excludes the whole index when the root is hidden", () => {
        const root = element("div", "DOMD-Root");
        root.computedStyle.visibility = "hidden";
        child(root, "p", "DOMD-P", "Hidden raw");

        const index = buildVisibleTextIndex(root);

        expect(index).toEqual({ segments: [], text: "" });
    });

    it("creates a DOM range for a single-node match", () => {
        const root = element("div", "DOMD-Root");
        const paragraph = child(root, "p", "DOMD-P", "Find raw here");
        const index = buildVisibleTextIndex(root);
        const [match] = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        const range = rangeForVisibleTextMatch(index, match);

        expect(range?.startContainer).toBe(paragraph.firstChild);
        expect(range?.startOffset).toBe(5);
        expect(range?.endContainer).toBe(paragraph.firstChild);
        expect(range?.endOffset).toBe(8);
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
        this.childNodes.push(childNode);
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
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
