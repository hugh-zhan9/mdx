import { describe, expect, it } from "vitest";
import {
    findMermaidCodeFences,
    isMermaidFenceLanguage,
} from "./mermaid-code-fences";

describe("mermaid code fences", () => {
    it("matches mermaid as the first info-string token case-insensitively", () => {
        expect(isMermaidFenceLanguage("mermaid")).toBe(true);
        expect(isMermaidFenceLanguage("MERMAID")).toBe(true);
        expect(isMermaidFenceLanguage("mermaid title='Flow'")).toBe(true);
        expect(isMermaidFenceLanguage("mmd")).toBe(false);
        expect(isMermaidFenceLanguage("diagram")).toBe(false);
        expect(isMermaidFenceLanguage("")).toBe(false);
    });

    it("returns backtick mermaid fences with fenced-code order", () => {
        const markdown = [
            "```ts",
            "const a = 1;",
            "```",
            "",
            "```mermaid",
            "graph TD",
            "  A --> B",
            "```",
            "",
            "~~~MERMAID",
            "sequenceDiagram",
            "  A->>B: hi",
            "~~~",
            "",
            "```MERMAID",
            "graph LR",
            "  C --> D",
            "```",
        ].join("\n");

        expect(findMermaidCodeFences(markdown)).toEqual([
            {
                code: "graph TD\n  A --> B",
                codeBlockIndex: 1,
                fenceChar: "`",
                fenceLength: 3,
                info: "mermaid",
                language: "mermaid",
            },
            {
                code: "graph LR\n  C --> D",
                codeBlockIndex: 2,
                fenceChar: "`",
                fenceLength: 3,
                info: "MERMAID",
                language: "mermaid",
            },
        ]);
    });

    it("ignores indented fences because the editor kernel only renders column-zero code blocks", () => {
        const markdown = [
            "   ```mermaid",
            "graph TD",
            "  Ignored --> A",
            "   ```",
            "",
            "```ts",
            "const a = 1;",
            "```",
            "",
            "```mermaid",
            "graph TD",
            "  A --> B",
            "```",
        ].join("\n");

        expect(findMermaidCodeFences(markdown)).toEqual([
            {
                code: "graph TD\n  A --> B",
                codeBlockIndex: 1,
                fenceChar: "`",
                fenceLength: 3,
                info: "mermaid",
                language: "mermaid",
            },
        ]);
    });

    it("does not close fences on backticks indented by four spaces", () => {
        const markdown = [
            "```ts",
            "const a = 1;",
            "    ```",
            "still code",
            "```",
            "",
            "```mermaid",
            "graph TD",
            "  A --> B",
            "```",
        ].join("\n");

        expect(findMermaidCodeFences(markdown)).toEqual([
            {
                code: "graph TD\n  A --> B",
                codeBlockIndex: 1,
                fenceChar: "`",
                fenceLength: 3,
                info: "mermaid",
                language: "mermaid",
            },
        ]);
    });

    it("ignores unclosed fences and longer closing fences are accepted", () => {
        expect(
            findMermaidCodeFences("````mermaid\ngraph TD\n  A --> B\n`````"),
        ).toHaveLength(1);
        expect(findMermaidCodeFences("```mermaid\ngraph TD")).toEqual([]);
    });

    it("ignores mixed fence markers", () => {
        expect(findMermaidCodeFences("``~mermaid\ngraph TD\n```")).toEqual([]);
        expect(findMermaidCodeFences("~~`mermaid\ngraph TD\n~~~")).toEqual([]);
    });

    it("ignores tilde fences because the editor kernel only renders backtick code blocks", () => {
        const markdown = [
            "~~~mermaid",
            "graph TD",
            "  A --> B",
            "~~~",
            "",
            "```mermaid",
            "graph TD",
            "  B --> C",
            "```",
        ].join("\n");

        expect(findMermaidCodeFences(markdown)).toEqual([
            {
                code: "graph TD\n  B --> C",
                codeBlockIndex: 0,
                fenceChar: "`",
                fenceLength: 3,
                info: "mermaid",
                language: "mermaid",
            },
        ]);
    });
});
