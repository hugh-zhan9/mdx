import type { SyntaxPlugin } from "../kernel";
import { coreMarkdownSyntax } from "./core";
import { fallbackSyntax } from "./fallback";
import { htmlSyntax } from "./html";
import { legacyMarkdownSyntax } from "./legacy";

export function defaultMarkdownSyntax(): SyntaxPlugin[] {
    return [
        coreMarkdownSyntax(),
        fallbackSyntax(),
        htmlSyntax(),
        legacyMarkdownSyntax(),
    ];
}
