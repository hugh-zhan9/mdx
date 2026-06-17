import type { MermaidCodeFence } from "./mermaid-code-fences";
import { MDX_CODE_BLOCK_SELECTOR } from "./editor-dom-contract";

export interface MermaidPreMapping {
    fence: MermaidCodeFence;
    pre: HTMLPreElement;
    stableId: string;
}

export type MermaidSourceMode = "preview" | "editing" | "error";

export function mapMermaidFencesToPreElements(
    editorRoot: ParentNode,
    fences: MermaidCodeFence[],
): MermaidPreMapping[] {
    const preElements = Array.from(
        editorRoot.querySelectorAll<HTMLPreElement>(MDX_CODE_BLOCK_SELECTOR),
    );

    return fences.flatMap((fence) => {
        const pre = preElements[fence.codeBlockIndex];
        if (!pre) {
            return [];
        }

        return [
            {
                fence,
                pre,
                stableId: `mermaid-${fence.codeBlockIndex}`,
            },
        ];
    });
}

export function applyMermaidSourceVisibility(
    pre: HTMLPreElement,
    mode: MermaidSourceMode,
): void {
    const hidden = mode === "preview";
    pre.hidden = hidden;
    if (hidden) {
        pre.setAttribute("aria-hidden", "true");
    } else {
        pre.removeAttribute("aria-hidden");
    }
    pre.classList.toggle("mdx-mermaid-source-hidden", hidden);
    pre.classList.toggle("mdx-mermaid-source-editing", mode === "editing");
    pre.classList.toggle("mdx-mermaid-source-error", mode === "error");
}
