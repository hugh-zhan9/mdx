// @vitest-environment jsdom
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { afterEach, describe, expect, it } from "vitest";

import { createBaseMilkdownPlugins } from "../../../milkdown/base-plugins";
import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../../milkdown/editor-host";
import { wikilinkPlugins } from "../wikilink";
import { linkClickCtx, linkPlugins, type LinkActivation } from "./index";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

async function mount(markdown: string) {
    const root = document.createElement("div");
    document.body.append(root);

    const activations: LinkActivation[] = [];
    const installHandler: MilkdownPlugin = (ctx) => () => {
        ctx.set(linkClickCtx.key, (activation) => {
            activations.push(activation);
        });
    };

    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins: [
            ...createBaseMilkdownPlugins(),
            // Both, because they both render an anchor and must not both claim
            // the same click.
            ...wikilinkPlugins(),
            ...linkPlugins(),
            installHandler,
        ],
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);

    return { root, activations };
}

/**
 * Clicks with ⌘ held, and reports whether the click's default was cancelled.
 *
 * The modifier is what asks for the link to be opened; a plain click belongs to
 * the caret.
 */
function commandClick(element: Element): boolean {
    const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        metaKey: true,
    });
    element.dispatchEvent(event);

    return event.defaultPrevented;
}

function plainClick(element: Element) {
    element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
}

describe("activating a link in the rendered document", () => {
    it("reports the address the Markdown wrote", async () => {
        const { root, activations } = await mount(
            "See [the docs](https://example.com/docs).\n",
        );
        const anchor = root.querySelector("a[href]");

        expect(anchor).not.toBeNull();
        commandClick(anchor as Element);

        expect(activations).toEqual([{ href: "https://example.com/docs" }]);
    });

    it("stops the click from navigating the window", async () => {
        // Without this the WebView would follow the anchor and leave the app:
        // the editor is the page, so there is nothing to come back to.
        const { root } = await mount("See [docs](https://example.com/docs).\n");

        expect(commandClick(root.querySelector("a[href]") as Element)).toBe(
            true,
        );
    });

    it("reports a relative target without resolving it", async () => {
        // Where that file is, and whether it exists, is the product's question.
        const { root, activations } = await mount(
            "See [the note](notes/other.md).\n",
        );

        commandClick(root.querySelector("a[href]") as Element);

        expect(activations).toEqual([{ href: "notes/other.md" }]);
    });

    it("reports a click that landed inside the label", async () => {
        // A badge — an image wrapped in a link — is the case where the click
        // lands on a child of the anchor rather than on the anchor itself.
        const { root, activations } = await mount(
            "[![badge](badge.svg)](https://example.com/build)\n",
        );
        const image = root.querySelector("a[href] img");

        expect(image).not.toBeNull();
        commandClick(image as Element);

        expect(activations).toEqual([{ href: "https://example.com/build" }]);
    });

    it("says nothing about a click that is not on a link", async () => {
        const { root, activations } = await mount("Just a paragraph.\n");

        commandClick(root.querySelector("p") as Element);

        expect(activations).toEqual([]);
    });

    it("leaves a plain click to the caret", async () => {
        // Clicking a link's label is how its text gets edited, so a click with
        // no modifier is not an activation and must not be consumed.
        const { root, activations } = await mount(
            "See [docs](https://example.com/docs).\n",
        );

        plainClick(root.querySelector("a[href]") as Element);

        expect(activations).toEqual([]);
    });

    it("leaves a wikilink to the wikilink handler", async () => {
        // A wikilink is an anchor too, and it carries no href — which is what
        // keeps these two from both firing on one click.
        const { root, activations } = await mount("See [[Target Page]].\n");
        const wikilink = root.querySelector("a[data-mdx-wikilink]");

        expect(wikilink).not.toBeNull();
        commandClick(wikilink as Element);

        expect(activations).toEqual([]);
    });
});
