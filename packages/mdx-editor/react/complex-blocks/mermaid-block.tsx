import type { ComplexBlockOp } from "./index";

export function MermaidBlock({ op }: { op: ComplexBlockOp }) {
    const code = typeof op.data?.code === "string" ? op.data.code : "";

    return (
        <div
            data-complex-block-id={op.blockId}
            data-complex-block-kind="mermaid"
        >
            <code>{code}</code>
        </div>
    );
}
