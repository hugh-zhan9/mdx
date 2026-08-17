// @vitest-environment jsdom
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";

import { editorServicePlugins } from "../../../adapter/editor-services";
import type { EditorSurfaceServices } from "../../../adapter/types";
import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../../milkdown/editor-host";
import { createMdxMilkdownPlugins } from "../index";
import {
    IMAGE_DOM_MARKER,
    IMAGE_NODE_NAME,
    IMAGE_RESOLVED_SOURCE_MARKER,
} from "./index";

/**
 * What the reader sees where the document says `![alt](assets/pic.png)`.
 *
 * The browser cannot fetch a path that is relative to a file it knows nothing
 * about, so the product resolves it and the view draws the answer. Every test
 * here is about the difference between what is drawn and what is written: the
 * document only ever holds the author's path.
 */

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

interface Mounted {
    host: MilkdownEditorHost;
    root: HTMLElement;
    view: EditorView;
}

/**
 * Every test mounts through here, with the composition the product builds:
 * the syntax layer and, over it, the product's own service installer. Dropping
 * `imagePlugins()` from `createMdxMilkdownPlugins()` is the vacuity check.
 */
async function mount(
    markdown: string,
    services?: EditorSurfaceServices,
): Promise<Mounted> {
    const root = document.createElement("div");
    document.body.append(root);

    let view: EditorView | null = null;
    const capture = $prose(
        () =>
            new Plugin({
                key: new PluginKey("image-test-capture"),
                view: (editorView) => {
                    view = editorView;
                    return {};
                },
            }),
    );

    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins: [
            ...createMdxMilkdownPlugins(),
            // `undefined` mounts the syntax layer alone, which is what the
            // shared analyzer and every other suite in this package build.
            ...(services ? editorServicePlugins(() => services) : []),
            capture,
        ],
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);
    if (!view) throw new Error("editor view was never created");
    return { host, root, view };
}

async function tick(ms: number): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        if (predicate()) return;
        await tick(5);
    }
    throw new Error(`timed out waiting for ${what}`);
}

/** Lets everything already queued as a microtask run. */
async function settle(): Promise<void> {
    await tick(5);
    await tick(5);
}

/**
 * Every image this view drew, in document order.
 *
 * Selected by the view's own marker rather than by tag: ProseMirror puts its
 * own `img.ProseMirror-separator` after an inline atom that ends a paragraph,
 * and that one is not a picture. Nothing carries the marker unless the view
 * ran, so a composition that never registered it finds no images at all.
 */
function images(root: ParentNode): HTMLImageElement[] {
    return Array.from(
        root.querySelectorAll<HTMLImageElement>(`img[${IMAGE_DOM_MARKER}]`),
    );
}

function onlyImage(root: ParentNode): HTMLImageElement {
    const found = images(root);
    if (found.length !== 1) {
        throw new Error(`expected one image, found ${found.length}`);
    }
    return found[0];
}

function displayed(root: ParentNode): string | null {
    return onlyImage(root).getAttribute("src");
}

/** Rewrites the first image node's attributes, as an editing command would. */
function setImageAttrs(
    view: EditorView,
    attrs: Record<string, string>,
): void {
    let found: { pos: number; node: ProseMirrorNode } | null = null;
    view.state.doc.descendants((node, pos) => {
        if (found) return false;
        if (node.type.name === IMAGE_NODE_NAME) {
            found = { pos, node };
            return false;
        }
        return true;
    });
    if (!found) throw new Error("no image node in the document");
    const { pos, node } = found as { pos: number; node: ProseMirrorNode };
    view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }),
    );
}

/**
 * The Markdown the document now holds.
 *
 * The host echoes what it was given until a transaction dirties the document,
 * so serialization has to be provoked. The edit is a character at the very
 * start, well clear of the image being examined.
 */
function markdownAfterEdit(host: MilkdownEditorHost): string {
    expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
    host.flush();
    return host.getMarkdown();
}

const ANCHOR = "Anchor.\n\n";
const RELATIVE = '![Diagram](assets/pic.png "Figure 1")\n';

/** A loader that records what it was asked and answers with a blob URL. */
function recordingLoader(asked: string[]) {
    return async (src: string) => {
        asked.push(src);
        return `blob:mdx/${src}`;
    };
}

/** A loader whose every answer is held until the test releases it. */
function deferredLoader(asked: string[]) {
    const pending: Array<{
        resolve: (url: string) => void;
        reject: (error: Error) => void;
    }> = [];
    const load = (src: string) => {
        asked.push(src);
        return new Promise<string>((resolve, reject) => {
            pending.push({ resolve, reject });
        });
    };
    return { load, pending };
}

describe("image rendering", () => {
    it("draws a relative reference through the product's loader", async () => {
        const asked: string[] = [];
        const { host, root } = await mount(`${ANCHOR}${RELATIVE}`, {
            imageLoader: recordingLoader(asked),
        });

        await waitFor(
            () => displayed(root) === "blob:mdx/assets/pic.png",
            "the resolved image",
        );
        expect(asked).toEqual(["assets/pic.png"]);
        expect(
            onlyImage(root).getAttribute(IMAGE_RESOLVED_SOURCE_MARKER),
        ).toBe("assets/pic.png");
        // The view draws the whole node, so everything the default rendering
        // used to put on the element has to come from it now.
        expect(onlyImage(root).getAttribute("alt")).toBe("Diagram");
        expect(onlyImage(root).getAttribute("title")).toBe("Figure 1");

        // The resolved URL is what is drawn, never what is written. The
        // document still says what its author typed.
        expect(markdownAfterEdit(host)).toBe(`X${ANCHOR}${RELATIVE}`);
    }, 60000);

    it("draws a source the browser can already fetch without asking the product", async () => {
        const asked: string[] = [];
        const direct = [
            "https://example.test/a.png",
            "http://example.test/b.png",
            "//example.test/c.png",
            "data:image/gif;base64,R0lGOD",
            "blob:example.test/d",
        ];
        const document_ = [
            ANCHOR,
            ...direct.map((src, index) => `![${index}](${src})\n\n`),
            RELATIVE,
        ].join("");

        const { host, root } = await mount(document_, {
            imageLoader: recordingLoader(asked),
        });

        // The relative reference in the same document is what proves the
        // loader was reachable at all: only it was ever asked.
        await waitFor(
            () =>
                images(root).at(-1)?.getAttribute("src") ===
                "blob:mdx/assets/pic.png",
            "the resolved image",
        );
        await settle();
        expect(asked).toEqual(["assets/pic.png"]);
        expect(
            images(root)
                .slice(0, direct.length)
                .map((image) => image.getAttribute("src")),
        ).toEqual(direct);
        expect(markdownAfterEdit(host)).toBe(`X${document_}`);
    }, 60000);

    it("resolves again when the reference changes, and not when it has not", async () => {
        const asked: string[] = [];
        const { root, view } = await mount(`${ANCHOR}${RELATIVE}`, {
            imageLoader: recordingLoader(asked),
        });
        await waitFor(
            () => displayed(root) === "blob:mdx/assets/pic.png",
            "the first resolved image",
        );

        setImageAttrs(view, { src: "assets/other.png" });
        await waitFor(
            () => displayed(root) === "blob:mdx/assets/other.png",
            "the second resolved image",
        );
        expect(asked).toEqual(["assets/pic.png", "assets/other.png"]);

        // The description changed; the picture did not. Asking again would
        // refetch the asset and strand the blob URL already on screen.
        setImageAttrs(view, { alt: "Another diagram" });
        await settle();
        expect(asked).toEqual(["assets/pic.png", "assets/other.png"]);
        expect(displayed(root)).toBe("blob:mdx/assets/other.png");
        expect(onlyImage(root).getAttribute("alt")).toBe("Another diagram");
    }, 60000);

    it("drops an answer that arrives after the reference moved on", async () => {
        const asked: string[] = [];
        const loader = deferredLoader(asked);
        const { root, view } = await mount(`${ANCHOR}${RELATIVE}`, {
            imageLoader: loader.load,
        });
        await waitFor(() => asked.length === 1, "the first request");

        setImageAttrs(view, { src: "assets/other.png" });
        await waitFor(() => asked.length === 2, "the second request");
        expect(displayed(root)).toBe("assets/other.png");

        // The first answer is for a reference this node no longer has.
        loader.pending[0].resolve("blob:mdx/assets/pic.png");
        await settle();
        expect(displayed(root)).toBe("assets/other.png");

        loader.pending[1].resolve("blob:mdx/assets/other.png");
        await waitFor(
            () => displayed(root) === "blob:mdx/assets/other.png",
            "the second resolved image",
        );
    }, 60000);

    it("drops an answer that arrives after the surface is gone", async () => {
        const asked: string[] = [];
        const loader = deferredLoader(asked);
        const { host, root } = await mount(`${ANCHOR}${RELATIVE}`, {
            imageLoader: loader.load,
        });
        await waitFor(() => asked.length === 1, "the request");
        const image = onlyImage(root);

        await host.destroy();
        loader.pending[0].resolve("blob:mdx/assets/pic.png");
        await settle();

        expect(image.getAttribute("src")).toBe("assets/pic.png");
        expect(image.hasAttribute(IMAGE_RESOLVED_SOURCE_MARKER)).toBe(false);
    }, 60000);

    it("leaves the reference and the document alone when the loader fails", async () => {
        const asked: string[] = [];
        const { host, root } = await mount(`${ANCHOR}${RELATIVE}`, {
            imageLoader: async (src: string) => {
                asked.push(src);
                throw new Error("no such asset");
            },
        });
        await waitFor(() => asked.length === 1, "the request");
        await settle();

        // An asset that cannot be found is a picture that does not draw, not a
        // document that needs changing.
        expect(displayed(root)).toBe("assets/pic.png");
        expect(onlyImage(root).hasAttribute(IMAGE_RESOLVED_SOURCE_MARKER)).toBe(
            false,
        );
        expect(onlyImage(root).hasAttribute(IMAGE_DOM_MARKER)).toBe(true);
        expect(markdownAfterEdit(host)).toBe(`X${ANCHOR}${RELATIVE}`);
    }, 60000);

    it("draws the reference as written when the product offers no loader", async () => {
        const { host, root } = await mount(`${ANCHOR}${RELATIVE}`, {});
        await settle();

        expect(displayed(root)).toBe("assets/pic.png");
        expect(onlyImage(root).hasAttribute(IMAGE_DOM_MARKER)).toBe(true);
        expect(markdownAfterEdit(host)).toBe(`X${ANCHOR}${RELATIVE}`);
    }, 60000);

    it("draws the reference as written when the product installed nothing at all", async () => {
        // The shared analyzer and every other suite in this package mount the
        // syntax layer on its own. The view has to find a slice to read there
        // too, or opening any document with an image in it throws.
        const { host, root } = await mount(`${ANCHOR}${RELATIVE}`);
        await settle();

        expect(displayed(root)).toBe("assets/pic.png");
        expect(onlyImage(root).hasAttribute(IMAGE_DOM_MARKER)).toBe(true);
        expect(markdownAfterEdit(host)).toBe(`X${ANCHOR}${RELATIVE}`);
    }, 60000);
});
