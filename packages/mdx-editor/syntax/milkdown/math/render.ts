import katex from "katex";

export interface MathRender {
    /** KaTeX markup, empty when the LaTeX could not be rendered. */
    html: string;
    /** Why the render failed, empty when it succeeded. */
    error: string;
}

/**
 * Renders LaTeX for preview only.
 *
 * Every KaTeX failure is caught here: a NodeView that let one escape would tear
 * down the editor over a half-typed formula, and the LaTeX itself is the
 * document's truth whether or not it renders.
 */
export function renderMath(latex: string, displayMode: boolean): MathRender {
    try {
        return {
            html: katex.renderToString(latex, {
                displayMode,
                throwOnError: true,
                strict: "ignore",
            }),
            error: "",
        };
    } catch (error) {
        return {
            html: "",
            error: error instanceof Error ? error.message : "invalid math",
        };
    }
}
