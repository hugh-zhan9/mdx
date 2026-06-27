// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMdxEditor } from "../../../packages/mdx-editor";
import { EditorKernelProvider } from "../components/editor-kernel-adapter";
import { useEditorBridge } from "./use-editor-bridge";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

function EditorRootFixture() {
    const { registerRoot } = useMdxEditor();
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        registerRoot(rootRef.current);

        return () => {
            registerRoot(null);
        };
    }, [registerRoot]);

    return <div ref={rootRef} data-mdx-editor-root tabIndex={0} />;
}

describe("useEditorBridge", () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it("keeps the markdown bridge synchronized for text and image insertions", async () => {
        const onMarkdownChange = vi.fn();

        function Harness() {
            const bridge = useEditorBridge({
                tabId: "tab-1",
                markdown: "Hello",
                onMarkdownChange,
            });

            return (
                <>
                    <EditorRootFixture />
                    <button
                        type="button"
                        data-testid="insert"
                        onClick={() => bridge.insertText(" world")}
                    />
                    <button
                        type="button"
                        data-testid="insert-image"
                        onClick={() =>
                            bridge.insertImage(".assets/diagram.png", "Diagram")
                        }
                    />
                </>
            );
        }

        await act(async () => {
            root.render(
                <EditorKernelProvider initMd="Hello">
                    <Harness />
                </EditorKernelProvider>,
            );
        });

        await act(async () => {
            host.querySelector<HTMLButtonElement>("[data-testid='insert']")?.click();
        });

        expect(onMarkdownChange).toHaveBeenLastCalledWith("tab-1", "Hello world");

        await act(async () => {
            host.querySelector<HTMLButtonElement>(
                "[data-testid='insert-image']",
            )?.click();
        });

        expect(onMarkdownChange).toHaveBeenLastCalledWith(
            "tab-1",
            "Hello world![Diagram](.assets/diagram.png)",
        );
        expect(
            host.querySelector("img[data-mdx-node-type='image']")?.getAttribute("alt"),
        ).toBe("Diagram");
    });

    it("exposes the current ProseMirror document layout source", async () => {
        let capturedBridge: ReturnType<typeof useEditorBridge> | null = null;

        function Harness() {
            const bridge = useEditorBridge({
                tabId: "tab-1",
                markdown: "Hello",
                onMarkdownChange: vi.fn(),
            });

            useEffect(() => {
                capturedBridge = bridge;
            }, [bridge]);

            return (
                <>
                    <EditorRootFixture />
                    <button
                        type="button"
                        data-testid="insert"
                        onClick={() => bridge.insertText(" world")}
                    />
                </>
            );
        }

        await act(async () => {
            root.render(
                <EditorKernelProvider initMd="Hello">
                    <Harness />
                </EditorKernelProvider>,
            );
        });

        const initialSource = capturedBridge?.getLayoutSource();
        expect(initialSource?.doc.textContent).toBe("Hello");

        await act(async () => {
            host.querySelector<HTMLButtonElement>("[data-testid='insert']")?.click();
        });

        const nextSource = capturedBridge?.getLayoutSource();
        expect(nextSource?.doc.textContent).toBe("Hello world");
        expect(nextSource?.revision).toBeGreaterThan(initialSource?.revision ?? 0);
    });
});
