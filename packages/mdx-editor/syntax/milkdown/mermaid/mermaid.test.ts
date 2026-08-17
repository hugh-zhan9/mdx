// @vitest-environment jsdom
import { $prose } from "@milkdown/kit/utils";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBaseMilkdownPlugins } from "../../../milkdown/base-plugins";
import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../../milkdown/editor-host";
import { mermaidFixtures } from "../../../test/syntax-fixtures";
import {
    MDX_SEARCH_ATTRIBUTE,
    MDX_SEARCH_EXCLUDE,
    MERMAID_DOM_MARKER,
    MERMAID_ERROR_MARKER,
    MERMAID_NODE_NAME,
    MERMAID_PREVIEW_MARKER,
    MERMAID_RENDER_DELAY_MS,
    MERMAID_SOURCE_MARKER,
    mermaidPlugins,
    mermaidRendererCtx,
    renderMermaidDiagram,
    type MermaidRenderRequest,
    type MermaidRenderResult,
    type MermaidRenderer,
} from "./index";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

const SVG = '<svg id="diagram"><g><text>Start</text></g></svg>';

function succeedingRenderer(svg: string = SVG): MermaidRenderer {
    return async () => ({ ok: true, svg });
}

function installRenderer(renderer: MermaidRenderer): MilkdownPlugin {
    return (ctx) => () => {
        ctx.set(mermaidRendererCtx.key, renderer);
    };
}

interface Mounted {
    host: MilkdownEditorHost;
    root: HTMLElement;
    view: EditorView;
    requests: MermaidRenderRequest[];
}

/**
 * Every test mounts through here so removing `mermaidPlugins()` from this one
 * list is the whole vacuity check.
 */
function pluginsFor(renderer?: MermaidRenderer): MilkdownPlugin[] {
    return [
        ...createBaseMilkdownPlugins(),
        ...mermaidPlugins(),
        ...(renderer ? [installRenderer(renderer)] : []),
    ];
}

async function mount(
    markdown: string,
    renderer?: MermaidRenderer,
): Promise<Mounted> {
    const root = document.createElement("div");
    document.body.append(root);

    const requests: MermaidRenderRequest[] = [];
    const recording: MermaidRenderer | undefined = renderer
        ? (request) => {
              requests.push(request);
              return renderer(request);
          }
        : undefined;

    let view: EditorView | null = null;
    const capture = $prose(
        () =>
            new Plugin({
                key: new PluginKey("mermaid-test-capture"),
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
        plugins: [...pluginsFor(recording), capture],
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);
    if (!view) throw new Error("editor view was never created");
    return { host, root, view, requests };
}

/**
 * The host only reserializes once the document changes, so fidelity is measured
 * by editing an anchor paragraph that sits outside the fixture and reading the
 * whole document back.
 */
const ANCHOR = "Anchor.\n\n";

async function roundTrip(
    fixture: string,
    renderer?: MermaidRenderer,
): Promise<string> {
    const { host } = await mount(`${ANCHOR}${fixture}`, renderer);
    expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
    host.flush();
    return host.getMarkdown();
}

async function expectRoundTrip(
    fixture: string,
    renderer?: MermaidRenderer,
): Promise<void> {
    expect(await roundTrip(fixture, renderer)).toBe(`X${ANCHOR}${fixture}`);
}

function requireElement<T extends Element>(
    root: ParentNode,
    selector: string,
): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`missing element: ${selector}`);
    return found;
}

async function tick(ms: number): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        if (predicate()) return;
        await tick(10);
    }
    throw new Error(`timed out waiting for ${what}`);
}

/** Rewrites the whole source of the first Mermaid node in the document. */
function rewriteSource(view: EditorView, text: string): void {
    let from: number | null = null;
    let to: number | null = null;
    view.state.doc.descendants((node, pos) => {
        if (from !== null) return false;
        if (node.type.name !== MERMAID_NODE_NAME) return true;
        from = pos + 1;
        to = pos + 1 + node.content.size;
        return false;
    });
    if (from === null || to === null) throw new Error("no mermaid node");
    const tr = view.state.tr.insertText(text, from, to);
    tr.setSelection(TextSelection.create(tr.doc, from));
    view.dispatch(tr);
}

interface TimerCounts {
    /** Pending timers while the editor is alive. */
    live: number;
    /** Pending timers once the editor has been torn down. */
    afterDestroy: number;
    /** Renders that ran after teardown, which must be none. */
    requests: MermaidRenderRequest[];
}

/** Mounts `markdown` under fake timers and counts what it leaves behind. */
async function timerCounts(markdown: string): Promise<TimerCounts> {
    vi.useFakeTimers();
    try {
        const requests: MermaidRenderRequest[] = [];
        const root = document.createElement("div");
        document.body.append(root);
        const host = await createMilkdownEditorHost({
            root,
            markdown,
            editable: true,
            plugins: pluginsFor(async (request) => {
                requests.push(request);
                return { ok: true, svg: SVG };
            }),
            onMarkdownChange: () => {},
            onSelectionChange: () => {},
            scheduleChangeEmission: (emit) => {
                emit();
            },
        });
        const live = vi.getTimerCount();
        await host.destroy();
        const afterDestroy = vi.getTimerCount();
        vi.advanceTimersByTime(MERMAID_RENDER_DELAY_MS * 100);
        return { live, afterDestroy, requests };
    } finally {
        vi.useRealTimers();
    }
}

const GRAPH = "```mermaid\ngraph TD\n  A[Start] --> B{Choice}\n```\n";

describe("mermaid fence fidelity", () => {
    for (const fixture of mermaidFixtures) {
        it(`round-trips ${fixture.name} byte for byte`, async () => {
            await expectRoundTrip(fixture.markdown, succeedingRenderer());
        });
    }

    it("keeps interior indentation of the diagram source", async () => {
        const result = await roundTrip(GRAPH, succeedingRenderer());
        expect(result).toContain("graph TD\n  A[Start] --> B{Choice}");
    });

    it("round-trips a longer fence wrapping a shorter one", async () => {
        await expectRoundTrip(
            "````mermaid\ngraph TD\n```\nA --> B\n````\n",
            succeedingRenderer(),
        );
    });

    it("round-trips an empty diagram", async () => {
        await expectRoundTrip("```mermaid\n```\n", succeedingRenderer());
    });

    it("round-trips a diagram nested in a list item", async () => {
        await expectRoundTrip(
            "- item\n\n  ```mermaid\n  graph TD\n    A --> B\n  ```\n",
            succeedingRenderer(),
        );
    });

    it("keeps a syntactically invalid diagram exactly as written", async () => {
        const failing: MermaidRenderer = async () => ({
            ok: false,
            error: "No diagram type detected",
        });
        await expectRoundTrip(
            "```mermaid\nthis is not a diagram (((\n```\n",
            failing,
        );
    });
});

describe("mermaid node boundaries", () => {
    it("leaves a fence with another info string as a code block", async () => {
        const { host, root } = await mount(
            `${ANCHOR}\`\`\`js\nconst a = x[1];\n\`\`\`\n`,
            succeedingRenderer(),
        );
        expect(root.querySelector(`[${MERMAID_DOM_MARKER}]`)).toBeNull();
        expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
        host.flush();
        expect(host.getMarkdown()).toBe(
            `X${ANCHOR}\`\`\`js\nconst a = x[1];\n\`\`\`\n`,
        );
    });

    it("leaves a fence with no info string as a code block", async () => {
        const { host, root } = await mount(
            `${ANCHOR}\`\`\`\nplain\n\`\`\`\n`,
            succeedingRenderer(),
        );
        expect(root.querySelector(`[${MERMAID_DOM_MARKER}]`)).toBeNull();
        expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
        host.flush();
        expect(host.getMarkdown()).toBe(`X${ANCHOR}\`\`\`\nplain\n\`\`\`\n`);
    });

    it("leaves a fence whose info string carries more than the language", async () => {
        const { root } = await mount(
            `${ANCHOR}\`\`\`mermaid title=x\nA\n\`\`\`\n`,
            succeedingRenderer(),
        );
        expect(root.querySelector(`[${MERMAID_DOM_MARKER}]`)).toBeNull();
    });

    it("claims a fence whose info string is exactly mermaid", async () => {
        const { root } = await mount(`${ANCHOR}${GRAPH}`, succeedingRenderer());
        expect(root.querySelector(`[${MERMAID_DOM_MARKER}]`)).not.toBeNull();
    });
});

describe("mermaid preview chrome", () => {
    it("renders the diagram outside the editable source", async () => {
        const { root, requests } = await mount(
            `${ANCHOR}${GRAPH}`,
            succeedingRenderer(),
        );
        await waitFor(() => requests.length === 1, "the first render");
        const preview = requireElement(root, `[${MERMAID_PREVIEW_MARKER}]`);
        await waitFor(
            () => preview.querySelector("svg") !== null,
            "the rendered svg",
        );

        const source = requireElement(root, `[${MERMAID_SOURCE_MARKER}]`);
        expect(source.contains(preview)).toBe(false);
        expect(source.textContent).toBe("graph TD\n  A[Start] --> B{Choice}");
        expect(requests[0].code).toBe("graph TD\n  A[Start] --> B{Choice}");
    });

    it("marks the preview and the error report as excluded from search", async () => {
        const { root } = await mount(`${ANCHOR}${GRAPH}`, succeedingRenderer());
        const preview = requireElement(root, `[${MERMAID_PREVIEW_MARKER}]`);
        const error = requireElement(root, `[${MERMAID_ERROR_MARKER}]`);
        expect(preview.getAttribute(MDX_SEARCH_ATTRIBUTE)).toBe(
            MDX_SEARCH_EXCLUDE,
        );
        expect(error.getAttribute(MDX_SEARCH_ATTRIBUTE)).toBe(
            MDX_SEARCH_EXCLUDE,
        );
    });

    it("never serializes anything the preview produced", async () => {
        const { host, root, requests } = await mount(
            `${ANCHOR}${GRAPH}`,
            succeedingRenderer(
                '<svg id="diagram"><text>LEAKED PREVIEW TEXT</text></svg>',
            ),
        );
        const preview = requireElement(root, `[${MERMAID_PREVIEW_MARKER}]`);
        await waitFor(() => requests.length === 1, "the first render");
        await waitFor(
            () => preview.querySelector("svg") !== null,
            "the rendered svg",
        );
        expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
        host.flush();
        const markdown = host.getMarkdown();
        expect(markdown).toBe(`X${ANCHOR}${GRAPH}`);
        expect(markdown).not.toContain("LEAKED");
        expect(markdown).not.toContain("svg");
    });

    it("shows a local error and keeps the source when rendering fails", async () => {
        const failing: MermaidRenderer = async () => ({
            ok: false,
            error: "No diagram type detected",
        });
        const { host, root, requests } = await mount(
            `${ANCHOR}\`\`\`mermaid\nthis is not a diagram (((\n\`\`\`\n`,
            failing,
        );
        const error = requireElement<HTMLElement>(
            root,
            `[${MERMAID_ERROR_MARKER}]`,
        );
        await waitFor(() => requests.length === 1, "the first render");
        await waitFor(() => !error.hidden, "the error report");
        expect(error.textContent).toBe("No diagram type detected");

        const source = requireElement(root, `[${MERMAID_SOURCE_MARKER}]`);
        expect(source.textContent).toBe("this is not a diagram (((");
        expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
        host.flush();
        expect(host.getMarkdown()).toContain(
            "```mermaid\nthis is not a diagram (((\n```",
        );
    });

    it("reports a renderer that rejects instead of letting it escape", async () => {
        const throwing: MermaidRenderer = () =>
            Promise.reject(new Error("renderer exploded"));
        const { root } = await mount(`${ANCHOR}${GRAPH}`, throwing);
        const error = requireElement<HTMLElement>(
            root,
            `[${MERMAID_ERROR_MARKER}]`,
        );
        await waitFor(() => !error.hidden, "the error report");
        expect(error.textContent).toBe("renderer exploded");
    });

    it("reports a renderer that throws synchronously", async () => {
        const throwing = (() => {
            throw new Error("renderer exploded early");
        }) as unknown as MermaidRenderer;
        const { root } = await mount(`${ANCHOR}${GRAPH}`, throwing);
        const error = requireElement<HTMLElement>(
            root,
            `[${MERMAID_ERROR_MARKER}]`,
        );
        await waitFor(() => !error.hidden, "the error report");
        expect(error.textContent).toBe("renderer exploded early");
    });

    it("rejects rendered markup that is not an SVG", async () => {
        const { root } = await mount(
            `${ANCHOR}${GRAPH}`,
            succeedingRenderer('<img src="x" onerror="window.__pwned = true">'),
        );
        const preview = requireElement(root, `[${MERMAID_PREVIEW_MARKER}]`);
        const error = requireElement<HTMLElement>(
            root,
            `[${MERMAID_ERROR_MARKER}]`,
        );
        await waitFor(() => !error.hidden, "the error report");
        expect(preview.childElementCount).toBe(0);
        expect(error.textContent).toContain("did not return an SVG");
    });

    it("does not execute script that arrives inside rendered markup", async () => {
        const probe = "__mdxMermaidPwned";
        const scripted =
            '<svg id="diagram"><script>window.__mdxMermaidPwned = true;</script></svg>';
        const { root } = await mount(
            `${ANCHOR}${GRAPH}`,
            succeedingRenderer(scripted),
        );
        const preview = requireElement(root, `[${MERMAID_PREVIEW_MARKER}]`);
        await waitFor(
            () => preview.querySelector("svg") !== null,
            "the rendered svg",
        );
        await tick(20);
        expect((window as unknown as Record<string, unknown>)[probe]).toBe(
            undefined,
        );
    });
});

describe("mermaid render lifecycle", () => {
    it("re-renders with the edited source and keeps only the last result", async () => {
        const { host, view, requests } = await mount(
            `${ANCHOR}${GRAPH}`,
            succeedingRenderer(),
        );
        await waitFor(() => requests.length === 1, "the first render");

        rewriteSource(view, "graph LR\n  X --> Y");
        rewriteSource(view, "graph LR\n  X --> Z");
        await waitFor(() => requests.length === 2, "the coalesced re-render");
        expect(requests[1].code).toBe("graph LR\n  X --> Z");

        host.flush();
        expect(host.getMarkdown()).toBe(
            `${ANCHOR}\`\`\`mermaid\ngraph LR\n  X --> Z\n\`\`\`\n`,
        );
    });

    it("writes nothing after a view destroyed mid-render", async () => {
        let settle: ((result: MermaidRenderResult) => void) | null = null;
        const pending = new Promise<MermaidRenderResult>((resolve) => {
            settle = resolve;
        });
        const { host, root, requests } = await mount(
            `${ANCHOR}${GRAPH}`,
            () => pending,
        );
        await waitFor(() => requests.length === 1, "the render to start");
        const preview = requireElement(root, `[${MERMAID_PREVIEW_MARKER}]`);
        const error = requireElement<HTMLElement>(
            root,
            `[${MERMAID_ERROR_MARKER}]`,
        );

        await host.destroy();
        if (!settle) throw new Error("renderer was never called");
        (settle as (result: MermaidRenderResult) => void)({
            ok: true,
            svg: SVG,
        });
        await pending;
        await tick(MERMAID_RENDER_DELAY_MS * 4);

        expect(preview.childElementCount).toBe(0);
        expect(error.hidden).toBe(true);
        expect(error.textContent).toBe("");
    });

    it("leaves no pending render timer behind when destroyed", async () => {
        // Milkdown schedules timers of its own, so the render timer is counted
        // as the difference against the same document without a diagram in it.
        const plain = await timerCounts(`${ANCHOR}Plain paragraph.\n`);
        const diagram = await timerCounts(`${ANCHOR}${GRAPH}`);

        expect(diagram.live - plain.live).toBe(1);
        expect(diagram.afterDestroy - plain.afterDestroy).toBe(0);
        expect(diagram.requests).toHaveLength(0);
    });
});

describe("mermaid default renderer", () => {
    // The real renderer, which means the real `import("mermaid")` — the whole
    // library, loaded once, and slow enough in jsdom to sit either side of the
    // 5s default under parallel load. The import is what is being exercised (a
    // stub could not fail the way this asserts), so the time is inherent rather
    // than incidental and the budget says so.
    it(
        "reports a failure rather than throwing when it cannot render",
        async () => {
            const result = await renderMermaidDiagram({
                code: "graph TD\n  A --> B",
                id: "mdx-mermaid-default-probe",
            });
            expect(result.ok).toBe(false);
            if (result.ok) throw new Error("unreachable");
            expect(result.error.length).toBeGreaterThan(0);
        },
        30_000,
    );

    it("shows the failure locally and leaves the document alone", async () => {
        const { host, root } = await mount(`${ANCHOR}${GRAPH}`);
        const error = requireElement<HTMLElement>(
            root,
            `[${MERMAID_ERROR_MARKER}]`,
        );
        await waitFor(() => !error.hidden, "the error report");
        expect(error.textContent?.length ?? 0).toBeGreaterThan(0);
        expect(host.hasFailed()).toBe(false);
        expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
        host.flush();
        expect(host.getMarkdown()).toBe(`X${ANCHOR}${GRAPH}`);
    });
});
