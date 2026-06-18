// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMD, DOMDProvider } from "../components/editor-kernel-adapter";
import { useEditorBridge } from "./use-editor-bridge";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

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
                    <DOMD />
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
                <DOMDProvider initMd="Hello">
                    <Harness />
                </DOMDProvider>,
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
            host.querySelector("[data-mdx-editor-root]")?.textContent,
        ).toContain("Hello world!Diagram");
    });
});
