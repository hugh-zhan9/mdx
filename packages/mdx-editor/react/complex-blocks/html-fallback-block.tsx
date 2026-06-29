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
                data-mdx-node-type="html_block"
                className="mdx-html-block"
                style={{
                    boxSizing: "border-box",
                    height: "100%",
                    margin: 0,
                    width: "100%",
                }}
            >
                <div
                    aria-label="Edit HTML block"
                    className="mdx-html-block-preview"
                    contentEditable={false}
                    dangerouslySetInnerHTML={{ __html: sanitizeClipboardHtml(html) }}
                />
            </div>
        );
    }

    return (
        <div
            data-mdx-node-type="source_fallback"
            data-complex-block-id={op.blockId}
            data-complex-block-kind="fallback"
            className="mdx-source-fallback"
            style={{
                boxSizing: "border-box",
                height: "100%",
                margin: 0,
                width: "100%",
            }}
        >
            <div
                aria-label="Edit source fallback"
                className="mdx-source-fallback-preview"
                contentEditable={false}
                dangerouslySetInnerHTML={{
                    __html: sanitizeClipboardHtml(content),
                }}
            />
        </div>
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
