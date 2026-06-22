import type { SyntaxPlugin } from "../kernel";
import { coreMarkdownSyntax } from "./core";
import { legacyMarkdownSyntax } from "./legacy";

export function defaultMarkdownSyntax(): SyntaxPlugin[] {
    return [coreMarkdownSyntax(), legacyMarkdownSyntax()];
}
