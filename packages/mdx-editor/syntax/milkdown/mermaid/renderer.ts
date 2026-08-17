/** Outcome of one diagram render. A failure is data, never an exception. */
export type MermaidRenderResult =
    | { ok: true; svg: string }
    | { ok: false; error: string };

export interface MermaidRenderRequest {
    /** The fence source, byte for byte as the author wrote it. */
    code: string;
    /** Unique element id Mermaid needs while it builds the diagram. */
    id: string;
}

export type MermaidRenderer = (
    request: MermaidRenderRequest,
) => Promise<MermaidRenderResult>;

let initialized = false;

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Renders through Mermaid itself.
 *
 * Mermaid is imported lazily so that merely composing the syntax layer does not
 * pull a diagram engine into the editor's start-up path, and so a host that
 * cannot run it — a server, a test environment without layout — reports a
 * render failure instead of failing to load the plugin.
 */
export const renderMermaidDiagram: MermaidRenderer = async ({ code, id }) => {
    try {
        const { default: mermaid } = await import("mermaid");
        if (!initialized) {
            // `strict` blocks scripts and foreign markup inside the diagram
            // source; `suppressErrorRendering` stops Mermaid from injecting its
            // own error graphic, because the error UI belongs to this plugin.
            mermaid.initialize({
                startOnLoad: false,
                securityLevel: "strict",
                suppressErrorRendering: true,
            });
            initialized = true;
        }
        const { svg } = await mermaid.render(id, code);
        return { ok: true, svg };
    } catch (error) {
        return { ok: false, error: describe(error) };
    }
};
