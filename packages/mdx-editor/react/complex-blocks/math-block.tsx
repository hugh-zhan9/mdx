import katex from "katex";
import type { ComplexBlockOp } from "./index";

export function MathBlock({ op }: { op: ComplexBlockOp }) {
    const content =
        typeof op.data?.content === "string"
            ? op.data.content
            : typeof op.data?.latex === "string"
              ? op.data.latex
              : "";
    const rendered = renderLatex(content);

    return (
        <div
            data-complex-block-id={op.blockId}
            data-complex-block-kind="math"
            data-mdx-node-type="math_block"
            className="mdx-math-node"
            style={{
                boxSizing: "border-box",
                height: "100%",
                margin: 0,
                width: "100%",
            }}
        >
            <span className="mdx-math-preview" contentEditable={false}>
                {rendered.error ? (
                    <code>{content}</code>
                ) : (
                    <span dangerouslySetInnerHTML={{ __html: rendered.html }} />
                )}
            </span>
        </div>
    );
}

function renderLatex(latex: string) {
    try {
        return {
            error: "",
            html: katex.renderToString(latex, {
                displayMode: true,
                throwOnError: true,
            }),
        };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : "Invalid math",
            html: "",
        };
    }
}
