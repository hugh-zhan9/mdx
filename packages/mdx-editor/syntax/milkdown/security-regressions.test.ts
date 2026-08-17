// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../milkdown/editor-host";
import { createMdxMilkdownPlugins } from "./index";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

async function mount(markdown: string): Promise<{
    host: MilkdownEditorHost;
    root: HTMLElement;
}> {
    const root = document.createElement("div");
    document.body.append(root);
    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins: createMdxMilkdownPlugins(),
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);
    return { host, root };
}

describe("regression: an out-of-range character reference cannot break sanitization", () => {
    // `String.fromCodePoint` throws above U+10FFFF. The throw escaped the
    // sanitizer, blanking the preview of the whole block; on the clipboard path
    // it discarded the entire paste, including content that was perfectly fine.
    const payloads = [
        '<a href="&#999999999;">x</a>',
        '<a href="&#xFFFFFFFF;">x</a>',
        '<a href="&#x110000;">x</a>',
        '<a href="&#1114112;">x</a>',
    ];

    for (const payload of payloads) {
        it(`renders a preview for ${payload}`, async () => {
            const { root } = await mount(`${payload}\n`);
            await new Promise((resolve) => setTimeout(resolve, 0));

            const preview = root.querySelector("[data-mdx-preview]");
            expect(preview).not.toBeNull();
            expect(preview!.textContent).not.toContain("Preview unavailable");
        });
    }

    it("still refuses a javascript: URL spelled with entities", async () => {
        const { root } = await mount(
            '<a href="&#106;avascript:window.__pwned=true">x</a>\n',
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        for (const anchor of root.querySelectorAll("a[href]")) {
            const href = (anchor.getAttribute("href") ?? "")
                .replace(/[\s-]/g, "")
                .toLowerCase();
            expect(href.startsWith("javascript:")).toBe(false);
        }
    });
});

describe("regression: opening a document does not reach the network", () => {
    // A sanitized preview renders as soon as its node view mounts, with no user
    // action. A remote `img src` therefore let a document's author learn when
    // and from where the file was opened.
    const remote = [
        '<div><img src="https://evil.test/beacon.gif?id=1"></div>',
        '<div><img src="http://evil.test/beacon.gif"></div>',
        '<div><img src="//evil.test/beacon.gif"></div>',
    ];

    for (const payload of remote) {
        it(`does not load: ${payload.slice(0, 44)}`, async () => {
            const { root } = await mount(`${payload}\n`);
            await new Promise((resolve) => setTimeout(resolve, 0));

            const preview = root.querySelector("[data-mdx-preview]");
            expect(preview).not.toBeNull();
            for (const image of preview!.querySelectorAll("img")) {
                expect(image.getAttribute("src")).toBeNull();
            }
            // The URL is kept so the UI can offer to load it deliberately.
            expect(
                preview!.querySelector("[data-mdx-blocked-src]"),
            ).not.toBeNull();
        });
    }

    it("still renders a relative image reference", async () => {
        const { root } = await mount('<div><img src="assets/local.png"></div>\n');
        await new Promise((resolve) => setTimeout(resolve, 0));

        const image = root.querySelector("[data-mdx-preview] img");
        expect(image?.getAttribute("src")).toBe("assets/local.png");
    });
});

describe("regression: a preview cannot navigate the app away", () => {
    function clickLink(
        root: HTMLElement,
        kind: "click" | "auxclick",
        button: number,
    ): boolean {
        const anchor = root.querySelector("[data-mdx-preview] a[href]");
        if (!anchor) throw new Error("no preview link rendered to click");
        const event = new MouseEvent(kind, {
            bubbles: true,
            cancelable: true,
            button,
        });
        anchor.dispatchEvent(event);
        return event.defaultPrevented;
    }

    it("blocks a left click on a link in a block preview", async () => {
        const { root } = await mount(
            '<div><a href="https://evil.test/">go</a></div>\n',
        );
        expect(clickLink(root, "click", 0)).toBe(true);
    });

    it("blocks a middle click on a link in a block preview", async () => {
        const { root } = await mount(
            '<div><a href="https://evil.test/">go</a></div>\n',
        );
        expect(clickLink(root, "auxclick", 1)).toBe(true);
    });

    it("blocks a left click on a link in an inline preview", async () => {
        const { root } = await mount(
            'text <a href="https://evil.test/">go</a> tail\n',
        );
        expect(clickLink(root, "click", 0)).toBe(true);
    });

    it("blocks a middle click on a link in an inline preview", async () => {
        const { root } = await mount(
            'text <a href="https://evil.test/">go</a> tail\n',
        );
        expect(clickLink(root, "auxclick", 1)).toBe(true);
    });
});
