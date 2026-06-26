import { createElement } from "react";
import { CodeBlock } from "./code-block";
import { HtmlFallbackBlock } from "./html-fallback-block";
import { ImageBlock } from "./image-block";
import { MathBlock } from "./math-block";
import { MermaidBlock } from "./mermaid-block";
import { TableBlock } from "./table-block";

export interface ComplexBlockOp {
    blockId?: string;
    kind: string;
    rect?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
    };
    data?: Record<string, unknown>;
}

export function renderComplexBlock(op: ComplexBlockOp) {
    switch (op.kind) {
        case "math":
            return createElement(MathBlock, { op });
        case "code_highlight":
            return createElement(CodeBlock, { op });
        case "image":
            return createElement(ImageBlock, { op });
        case "mermaid":
            return createElement(MermaidBlock, { op });
        case "table":
        case "table_grid":
            return createElement(TableBlock, { op });
        case "html":
        case "fallback":
            return createElement(HtmlFallbackBlock, { op });
        default:
            return null;
    }
}
