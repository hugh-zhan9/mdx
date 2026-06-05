import mermaid from "mermaid";

export type MermaidEditorTheme = "light" | "dark";

export type MermaidRenderResult =
    | { ok: true; svg: string }
    | { ok: false; error: string };

export interface MermaidRenderRequest {
    code: string;
    id: string;
    theme: MermaidEditorTheme;
}

let initializedTheme: MermaidEditorTheme | null = null;

export async function renderMermaidDiagram({
    code,
    id,
    theme,
}: MermaidRenderRequest): Promise<MermaidRenderResult> {
    initializeMermaid(theme);

    try {
        const result = await mermaid.render(id, code);
        return { ok: true, svg: result.svg };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export function initializeMermaid(theme: MermaidEditorTheme): void {
    if (initializedTheme === theme) {
        return;
    }

    mermaid.initialize({
        securityLevel: "strict",
        startOnLoad: false,
        theme,
    });
    initializedTheme = theme;
}
