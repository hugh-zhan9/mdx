import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The product side of the publishing boundary.
 *
 * The native transport is the only feature module on the publishing path. It
 * has to be able to talk to Tauri and to nothing else: no editor session, no
 * adapter handle, no interactive layout bridge, and no way to answer a failed
 * export with something other than an error.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRANSPORT = path.join(HERE, "pdf-export-client.ts");

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function importSpecifiers(source: string): string[] {
    const pattern = /\bfrom\s*"([^"]+)"/g;
    const specifiers: string[] = [];
    let match = pattern.exec(source);

    while (match !== null) {
        specifiers.push(match[1]);
        match = pattern.exec(source);
    }

    return specifiers;
}

/** Anything that could reach the editing session or a rendered surface. */
const FORBIDDEN_TOKENS = [
    "MarkdownEditorAdapter",
    "EditorChangeEvent",
    "EditorSessionBinding",
    "createEditorSessionBinding",
    "wasm-layout-bridge",
    "layout-bridge-runtime",
    "hybrid-editor-host",
    "hitTest",
    "getSelectionGeometry",
    "setSelection",
    "onChange",
    "dirty",
    "draft",
    "conflict",
    "window.print",
    "document.write",
    "localStorage",
];

describe("the native PDF transport stays a transport", () => {
    const source = stripComments(readFileSync(TRANSPORT, "utf8"));

    it("imports the command channel and the publishing contract only", () => {
        expect(importSpecifiers(source).sort()).toEqual([
            "../../../packages/mdx-editor/publishing",
            "@/common/lib/tauri",
        ]);
    });

    it("borrows the publishing contract as types, not as behaviour", () => {
        expect(source).toContain(
            'import type {\n    PublishingError,\n    PublishingErrorCode,\n    PublishingPdfPayload,\n    PublishingPdfTransport,\n    PublishingPdfTransportResult,\n} from "../../../packages/mdx-editor/publishing"',
        );
    });

    it("names nothing that could reach the editor or a rendered surface", () => {
        for (const token of FORBIDDEN_TOKENS) {
            expect(source.includes(token), `transport names ${token}`).toBe(false);
        }
    });

    it("invokes exactly one command", () => {
        expect(source.match(/invoke</g)).toHaveLength(1);
        expect(source).toContain('"layout_export_pdf"');
    });
});
