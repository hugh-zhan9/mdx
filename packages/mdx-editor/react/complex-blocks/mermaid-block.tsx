import { useEffect, useId, useState } from "react";
import {
    renderMermaidDiagram,
    type MermaidEditorTheme,
} from "../mermaid-renderer";
import type { ComplexBlockOp } from "./index";

interface RenderState {
    code: string;
    error: string | null;
    svg: string | null;
}

export function MermaidBlock({ op }: { op: ComplexBlockOp }) {
    const code = typeof op.data?.code === "string" ? op.data.code : "";
    const renderId = useMermaidRenderId(op.blockId);
    const [themeRevision, setThemeRevision] = useState(0);
    const [state, setState] = useState<RenderState>({
        code: "",
        error: null,
        svg: null,
    });

    useEffect(() => {
        const observer = new MutationObserver((mutations) => {
            if (
                mutations.some(
                    (mutation) =>
                        mutation.type === "attributes" &&
                        mutation.attributeName === "data-theme",
                )
            ) {
                setThemeRevision((revision) => revision + 1);
            }
        });

        observer.observe(document.documentElement, {
            attributeFilter: ["data-theme"],
            attributes: true,
        });

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        let cancelled = false;

        if (code.trim().length === 0) {
            setState({
                code,
                error: null,
                svg: null,
            });
            return;
        }

        void renderMermaidDiagram({
            code,
            id: renderId,
            theme: currentMermaidTheme(),
        }).then((result) => {
            if (cancelled) {
                return;
            }

            setState(
                result.ok
                    ? { code, error: null, svg: result.svg }
                    : { code, error: result.error, svg: null },
            );
        });

        return () => {
            cancelled = true;
        };
    }, [code, renderId, themeRevision]);

    return (
        <div
            data-complex-block-id={op.blockId}
            data-complex-block-kind="mermaid"
            data-mdx-node-type="mermaid_block"
            data-mdx-code-block=""
            data-mdx-language="mermaid"
        >
            <textarea aria-label="Mermaid source" readOnly value={code} />
            <div
                className="mdx-mermaid-preview"
                data-mdx-mermaid-preview={op.blockId ?? "mermaid-block"}
                contentEditable={false}
            >
                {state.code === code && state.error ? (
                    <div className="mdx-mermaid-error" title={state.error}>
                        Mermaid 语法无法渲染
                    </div>
                ) : (
                    <div
                        className="mdx-mermaid-svg"
                        dangerouslySetInnerHTML={{
                            __html: state.code === code ? (state.svg ?? "") : "",
                        }}
                    />
                )}
            </div>
        </div>
    );
}

function useMermaidRenderId(blockId: string | undefined): string {
    const reactId = useId();
    const suffix =
        typeof blockId === "string" && blockId.length > 0
            ? blockId
            : "mermaid-block";

    return `mdx-${reactId}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "");
}

function currentMermaidTheme(): MermaidEditorTheme {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
