// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { createBaseMilkdownPlugins } from "../../../milkdown/base-plugins";
import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../../milkdown/editor-host";
import {
    linkClickCtx,
    linkEditorLabelsPlugin,
    linkPlugins,
    type LinkActivation,
} from "./index";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

const LABELS = { address: "链接地址", open: "打开", remove: "移除链接" };

/**
 * Mounts an editor, optionally without the names the product supplies — which is
 * how a composition that named nothing is tested.
 */
async function mount(
    markdown: string,
    options: { editable?: boolean; labels?: boolean } = {},
) {
    const { editable = true, labels = true } = options;
    const root = document.createElement("div");
    document.body.append(root);

    const activations: LinkActivation[] = [];
    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable,
        plugins: [
            ...createBaseMilkdownPlugins(),
            ...linkPlugins(),
            ...(labels ? [linkEditorLabelsPlugin(LABELS)] : []),
            (ctx) => () => {
                ctx.set(linkClickCtx.key, (activation) => {
                    activations.push(activation);
                });
            },
        ],
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);

    return { host, activations };
}

/** One of the editor's buttons, or null while it is not offered. */
function button(attribute: string): HTMLButtonElement | null {
    const element = document.body.querySelector<HTMLElement>(
        "[data-mdx-link-editor]",
    );

    if (!element || element.hidden) {
        return null;
    }

    return element.querySelector<HTMLButtonElement>(`[${attribute}]`);
}

/** The address field, or null while it is not offered. */
function addressField(): HTMLInputElement | null {
    const element = document.body.querySelector<HTMLElement>(
        "[data-mdx-link-editor]",
    );

    if (!element || element.hidden) {
        return null;
    }

    return element.querySelector<HTMLInputElement>(
        "[data-mdx-link-editor-address]",
    );
}

/** Puts the caret at a source offset, where the Markdown spells it. */
function caretAt(host: MilkdownEditorHost, markdown: string, needle: string) {
    const at = markdown.indexOf(needle);

    expect(at).toBeGreaterThanOrEqual(0);
    expect(host.setSelection({ anchor: at, head: at })).toBe(true);
}

function type(field: HTMLInputElement, value: string) {
    field.focus();
    field.value = value;
}

function press(field: HTMLInputElement, key: string) {
    field.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
}

describe("editing a link's address in the rendered document", () => {
    it("offers the address the Markdown wrote, once the caret is in the link", async () => {
        const markdown = "See [the docs](https://example.com/docs) now.\n";
        const { host } = await mount(markdown);

        // Nothing is offered until the caret is actually in a link.
        expect(addressField()).toBeNull();

        caretAt(host, markdown, "docs]");

        expect(addressField()?.value).toBe("https://example.com/docs");
    });

    it("names everything it shows in the product's words", async () => {
        // This package holds no human-language text, so every name comes from
        // whoever mounted the editor.
        const markdown = "See [docs](https://example.com).\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "docs]");

        expect(addressField()?.getAttribute("aria-label")).toBe("链接地址");
        expect(button("data-mdx-link-editor-open")?.textContent).toBe("打开");
        expect(button("data-mdx-link-editor-remove")?.textContent).toBe(
            "移除链接",
        );
    });

    it("offers no action nobody has named", async () => {
        // A button whose label would have to be invented here is not offered at
        // all: one carrying a name in a language the product does not speak is
        // worse than one that is absent.
        const markdown = "See [docs](https://example.com).\n";
        const { host } = await mount(markdown, { labels: false });

        caretAt(host, markdown, "docs]");

        expect(addressField()).not.toBeNull();
        expect(addressField()?.hasAttribute("aria-label")).toBe(false);
        expect(button("data-mdx-link-editor-open")).toBeNull();
        expect(button("data-mdx-link-editor-remove")).toBeNull();
    });

    it("takes the address away when the caret leaves the link", async () => {
        const markdown = "See [docs](https://example.com) and more text.\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "docs]");
        expect(addressField()).not.toBeNull();

        caretAt(host, markdown, "more text");

        expect(addressField()).toBeNull();
    });

    it("does not take the caret from the label", async () => {
        // The caret that opens this field is usually there to fix the label, so
        // the field appearing must not be the thing that stops that.
        const markdown = "See [docs](https://example.com).\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "docs]");

        expect(document.activeElement).not.toBe(addressField());
    });

    it("writes a typed address onto the link, keeping the label", async () => {
        const markdown = "See [the docs](https://example.com/old) now.\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "docs]");
        const field = addressField() as HTMLInputElement;
        type(field, "https://example.com/new");
        press(field, "Enter");

        expect(host.getMarkdown()).toBe(
            "See [the docs](https://example.com/new) now.\n",
        );
    });

    it("keeps a title the address was written with", async () => {
        // `[label](address "title")` says two things, and only one of them was
        // being edited.
        const markdown = 'See [docs](https://example.com/old "Tooltip").\n';
        const { host } = await mount(markdown);

        caretAt(host, markdown, "docs]");
        const field = addressField() as HTMLInputElement;
        type(field, "https://example.com/new");
        press(field, "Enter");

        expect(host.getMarkdown()).toBe(
            'See [docs](https://example.com/new "Tooltip").\n',
        );
    });

    it("edits the link the caret is in, not another one", async () => {
        const markdown = "[one](https://one.example) [two](https://two.example)\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "two]");
        const field = addressField() as HTMLInputElement;
        type(field, "https://changed.example");
        press(field, "Enter");

        expect(host.getMarkdown()).toBe(
            "[one](https://one.example) [two](https://changed.example)\n",
        );
    });

    it("carries the whole label when it is made of several pieces", async () => {
        // A label holding emphasis is more than one piece of text, and the
        // address belongs to all of them at once: writing it onto only the piece
        // under the caret would split one link into two.
        const markdown = "[a *bold* label](https://example.com/old)\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "label]");
        const field = addressField() as HTMLInputElement;
        type(field, "https://example.com/new");
        press(field, "Enter");

        expect(host.getMarkdown()).toBe(
            "[a *bold* label](https://example.com/new)\n",
        );
    });

    it("hands the caret back to the document", async () => {
        const markdown = "See [docs](https://example.com/old).\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "docs]");
        const field = addressField() as HTMLInputElement;
        type(field, "https://example.com/new");
        press(field, "Enter");

        expect(document.activeElement).not.toBe(field);
    });

    it("keeps what was typed when the caret goes elsewhere", async () => {
        // Clicking away is not a decision to abandon the address.
        const markdown = "See [docs](https://example.com/old).\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "docs]");
        const field = addressField() as HTMLInputElement;
        type(field, "https://example.com/new");
        field.blur();

        expect(host.getMarkdown()).toBe("See [docs](https://example.com/new).\n");
    });

    it("puts the document's address back when the edit is abandoned", async () => {
        const markdown = "See [docs](https://example.com/old).\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "docs]");
        const field = addressField() as HTMLInputElement;
        type(field, "https://example.com/new");
        press(field, "Escape");

        expect(host.getMarkdown()).toBe(markdown);
        // Including after the blur that follows focus going back to the text.
        field.blur();
        expect(host.getMarkdown()).toBe(markdown);
        expect(field.value).toBe("https://example.com/old");
    });

    it("refuses an address that says nothing", async () => {
        // A link with no target is not a link; removing one is a different act
        // than editing its address.
        const markdown = "See [docs](https://example.com/old).\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "docs]");
        const field = addressField() as HTMLInputElement;
        type(field, "   ");
        press(field, "Enter");

        expect(host.getMarkdown()).toBe(markdown);
    });

    it("offers nothing in a document that cannot be edited", async () => {
        const markdown = "See [docs](https://example.com).\n";
        const { host } = await mount(markdown, { editable: false });

        caretAt(host, markdown, "docs]");

        expect(addressField()).toBeNull();
    });

    it("opens the link it is editing", async () => {
        const markdown = "See [docs](https://example.com/docs).\n";
        const { host, activations } = await mount(markdown);

        caretAt(host, markdown, "docs]");
        button("data-mdx-link-editor-open")?.click();

        expect(activations).toEqual([{ href: "https://example.com/docs" }]);
    });

    it("opens the address just typed, not the one it replaced", async () => {
        // The field is what the user is looking at, so opening the address it
        // replaced would open a page they can see they did not ask for.
        const markdown = "See [docs](https://example.com/old).\n";
        const { host, activations } = await mount(markdown);

        caretAt(host, markdown, "docs]");
        type(addressField() as HTMLInputElement, "https://example.com/new");
        button("data-mdx-link-editor-open")?.click();

        expect(activations).toEqual([{ href: "https://example.com/new" }]);
        expect(host.getMarkdown()).toBe("See [docs](https://example.com/new).\n");
    });

    it("takes the link off its label, leaving the words", async () => {
        const markdown = "See [the docs](https://example.com/docs) now.\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "docs]");
        button("data-mdx-link-editor-remove")?.click();

        expect(host.getMarkdown()).toBe("See the docs now.\n");
        // Nothing left to edit the address of.
        expect(addressField()).toBeNull();
    });

    it("keeps the caret on the link when a button is pressed", async () => {
        // The caret is what says which link this is about, so a press that moved
        // focus out of the document would take the subject away with it.
        const markdown = "See [docs](https://example.com).\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "docs]");
        const press = new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
        });
        button("data-mdx-link-editor-open")?.dispatchEvent(press);

        expect(press.defaultPrevented).toBe(true);
    });

    it("leaves nothing behind when the editor goes away", async () => {
        const markdown = "See [docs](https://example.com).\n";
        const { host } = await mount(markdown);

        caretAt(host, markdown, "docs]");
        expect(addressField()).not.toBeNull();
        await host.destroy();
        mounted.pop();

        expect(
            document.body.querySelector("[data-mdx-link-editor]"),
        ).toBeNull();
    });
});
