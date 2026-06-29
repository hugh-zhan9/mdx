"use client";

import { useState } from "react";
import { EditorPane } from "./editor-pane";
import type { WorkspaceTab } from "@/features/workspace/lib/types";

const INITIAL_MARKDOWN = [
    "# Runtime Fixture",
    "",
    "Plain text with $x^2$ inline math.",
    "",
    "[Runtime link](https://example.com)",
    "",
    "```ts",
    "const value = 1;",
    "```",
    "",
    "$$",
    "\\int_0^1 x^2 dx = \\frac{1}{3}",
    "$$",
    "",
    "```mermaid",
    "graph TD",
    "  A --> B",
    "```",
    "",
    '<div class="custom-block">',
    "  <p>Runtime HTML</p>",
    "</div>",
].join("\n");

export function TexCanvasRuntimePage() {
    const [markdown, setMarkdown] = useState(INITIAL_MARKDOWN);
    const tab: WorkspaceTab = {
        baseFingerprint: "runtime",
        dirty: false,
        markdown,
        needsRenameOnFirstSave: false,
        path: "/tmp/tex-canvas-runtime.md",
        tabId: "runtime",
        title: "tex-canvas-runtime.md",
    };

    return (
        <main className="h-screen min-h-0" data-tex-canvas-runtime-route="">
            <output data-tex-runtime-markdown hidden>
                {markdown}
            </output>
            <EditorPane
                rootPath={null}
                tab={tab}
                onMarkdownChange={(_tabId, nextMarkdown) => {
                    setMarkdown(nextMarkdown);
                }}
            />
        </main>
    );
}
