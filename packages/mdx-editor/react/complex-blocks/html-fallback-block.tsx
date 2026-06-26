import { sanitizeClipboardHtml } from "../../kernel/clipboard";
import type { ComplexBlockOp } from "./index";

export function HtmlFallbackBlock({ op }: { op: ComplexBlockOp }) {
    const html = readString(op.data, "html");
    const markdown = readString(op.data, "markdown");
    const content = html || markdown;

    if (op.kind === "html" && html.length > 0) {
        return (
            <div
                data-complex-block-id={op.blockId}
                data-complex-block-kind="html"
                dangerouslySetInnerHTML={{ __html: sanitizeClipboardHtml(html) }}
            />
        );
    }

    return (
        <pre
            data-complex-block-id={op.blockId}
            data-complex-block-kind={op.kind === "html" ? "html" : "fallback"}
        >
            <code>{content}</code>
        </pre>
    );
}

function readString(
    data: ComplexBlockOp["data"],
    key: "html" | "markdown",
): string {
    if (!data || typeof data !== "object") {
        return "";
    }

    const value = (data as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
}
