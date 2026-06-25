import type { ComplexBlockOp } from "./index";

export function CodeBlock({ op }: { op: ComplexBlockOp }) {
    const code = typeof op.data?.code === "string" ? op.data.code : "";
    const language =
        typeof op.data?.language === "string" ? op.data.language : undefined;

    return (
        <pre
            data-complex-block-id={op.blockId}
            data-complex-block-kind="code"
            data-complex-block-language={language}
        >
            <code>{code}</code>
        </pre>
    );
}
