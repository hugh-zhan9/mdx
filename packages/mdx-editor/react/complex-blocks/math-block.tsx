import type { ComplexBlockOp } from "./index";

export function MathBlock({ op }: { op: ComplexBlockOp }) {
    const content =
        typeof op.data?.content === "string"
            ? op.data.content
            : typeof op.data?.latex === "string"
              ? op.data.latex
              : "";

    return (
        <div
            data-complex-block-id={op.blockId}
            data-complex-block-kind="math"
        >
            <code>{content}</code>
        </div>
    );
}
