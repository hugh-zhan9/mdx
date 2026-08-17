// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownEditorSurface } from "./markdown-editor-surface";
import { createEditorSessionBinding } from "../lib/editor-session-binding";
import type { EditorSurfaceServices } from "../../../packages/mdx-editor";

/**
 * The product's capabilities, from the session prop to the rendered document.
 *
 * Both capabilities have a consumer inside the editor now, and each one shows
 * the same thing from a different end: the services object a session hands the
 * surface is the object a view deep inside the editor ends up reading, having
 * crossed the adapter and the context slice on the way.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(async () => {
    while (mounted.length > 0) {
        const entry = mounted.pop();
        if (!entry) continue;
        await act(async () => {
            entry.root.unmount();
        });
        entry.container.remove();
    }
});

const FENCED = "```ts\nconst answer = 1;\n```\n";
const RELATIVE_IMAGE = "![Diagram](assets/pic.png)\n";

function SessionHost({
    markdown,
    services,
}: {
    markdown: string;
    services?: EditorSurfaceServices;
}) {
    const [binding] = useState(createEditorSessionBinding);

    return (
        <MarkdownEditorSurface
            session={binding}
            documentId="doc"
            markdown={markdown}
            services={services}
            onMarkdownChange={() => {}}
        />
    );
}

async function mountSurface(
    markdown: string,
    services?: EditorSurfaceServices,
): Promise<HTMLElement> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });

    await act(async () => {
        root.render(<SessionHost markdown={markdown} services={services} />);
    });

    return container;
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        if (predicate()) return;
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 5);
            });
        });
    }
    throw new Error(`timed out waiting for ${what}`);
}

/**
 * The picture the document describes, found by the text the document gave it.
 *
 * The alt text is content, which is all this side of the boundary knows; how
 * the editor marks up its own elements is not the product's business.
 */
function drawn(container: HTMLElement, alt: string): HTMLImageElement | null {
    return (
        Array.from(container.querySelectorAll("img")).find(
            (image) => image.getAttribute("alt") === alt,
        ) ?? null
    );
}

function highlighted(container: HTMLElement): Array<[string, string]> {
    return Array.from(
        container.querySelectorAll<HTMLElement>("[data-mdx-token-type]"),
    ).map((element) => [
        element.dataset.mdxTokenType ?? "",
        element.textContent ?? "",
    ]);
}

describe("adapter surface — code fence highlighting", () => {
    it("highlights a fence with the tokenizer the session supplied", async () => {
        const codeTokenizer = vi.fn(() => [
            { type: "keyword", content: "const" },
            " answer = 1;",
        ]);

        const container = await mountSurface(FENCED, {
            imageLoader: async (src) => src,
            codeTokenizer,
        });

        // The fence really is in the document, and the tokenizer really was
        // asked about it — with the language the fence declared.
        expect(container.querySelector("pre code")).not.toBeNull();
        expect(codeTokenizer).toHaveBeenCalledWith("const answer = 1;", "ts");
        expect(highlighted(container)).toEqual([["keyword", "const"]]);
    }, 60000);

    it("renders the fence plainly when the session supplies no tokenizer", async () => {
        const container = await mountSurface(FENCED);

        expect(container.querySelector("pre code")?.textContent).toBe(
            "const answer = 1;",
        );
        expect(highlighted(container)).toEqual([]);
    }, 60000);

    it("draws nothing of its own into the document", async () => {
        // Highlighting is decoration. A token span is not content, so the
        // Markdown the session holds is the Markdown it started with.
        const accepted: string[] = [];
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        mounted.push({ root, container });
        const binding = createEditorSessionBinding();

        await act(async () => {
            root.render(
                <MarkdownEditorSurface
                    session={binding}
                    documentId="doc"
                    markdown={FENCED}
                    services={{
                        codeTokenizer: () => [
                            { type: "keyword", content: "const" },
                            " answer = 1;",
                        ],
                    }}
                    onMarkdownChange={(_, next) => accepted.push(next)}
                />,
            );
        });

        expect(highlighted(container)).toEqual([["keyword", "const"]]);
        expect(accepted).toEqual([]);
    }, 60000);
});

describe("adapter surface — image loading", () => {
    it("draws a relative reference through the loader the session supplied", async () => {
        // The browser cannot fetch `assets/pic.png`: it is relative to a file
        // the editor knows nothing about. Only the session can say what.
        const imageLoader = vi.fn(async (src: string) => `blob:mdx/${src}`);

        const container = await mountSurface(RELATIVE_IMAGE, { imageLoader });

        await waitFor(
            () =>
                drawn(container, "Diagram")?.getAttribute("src") ===
                "blob:mdx/assets/pic.png",
            "the resolved image",
        );
        expect(imageLoader).toHaveBeenCalledWith("assets/pic.png");
    }, 60000);
});
