import type { ComplexBlockOp } from "./index";

export function CodeBlock({ op }: { op: ComplexBlockOp }) {
    const code = typeof op.data?.code === "string" ? op.data.code : "";
    const language =
        typeof op.data?.language === "string" ? op.data.language : undefined;

    return (
        <pre
            data-complex-block-id={op.blockId}
            data-complex-block-kind="code"
            data-mdx-code-block=""
            data-mdx-node-type="code_block"
            data-mdx-language={language}
            data-complex-block-language={language}
            style={{
                boxSizing: "border-box",
                height: "100%",
                margin: 0,
                width: "100%",
            }}
        >
            <code>{code}</code>
        </pre>
    );
}
