import type { SyntaxPlugin } from "../kernel";
import { codeSyntax } from "./code";
import { coreMarkdownSyntax } from "./core";
import { fallbackSyntax } from "./fallback";
import { footnoteSyntax } from "./footnote";
import { htmlSyntax } from "./html";
import { legacyMarkdownSyntax } from "./legacy";
import { mermaidSyntax } from "./mermaid";

export function defaultMarkdownSyntax(): SyntaxPlugin[] {
    return [
        coreMarkdownSyntax(),
        fallbackSyntax(),
        htmlSyntax(),
        footnoteSyntax(),
        mermaidSyntax(),
        codeSyntax(),
        legacyMarkdownSyntax(),
    ];
}
