// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DomTextRunLayer } from "./dom-text-run-layer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<{
    container: HTMLDivElement;
    root: ReturnType<typeof createRoot>;
}> = [];

afterEach(() => {
    for (const mounted of mountedRoots.splice(0)) {
        act(() => mounted.root.unmount());
        mounted.container.remove();
    }
});

describe("DomTextRunLayer", () => {
    it("renders editable text runs and reports ProseMirror source ranges on input", () => {
        const onInput = vi.fn();
        const onPointerDown = vi.fn();
        const container = renderLayer(
            <DomTextRunLayer
                lines={[
                    {
                        id: "line-1",
                        blockId: "block-1",
                        y: 2,
                        baseline: 16,
                        height: 20,
                        textRuns: [
                            {
                                blockId: "block-1",
                                pmFrom: 1,
                                pmTo: 6,
                                left: 4,
                                baseline: 16,
                                width: 48,
                                height: 20,
                                fontFamily: "Inter",
                                fontSize: 14,
                                text: "Hello",
                            },
                        ],
                    },
                ]}
                onInput={onInput}
                onPointerDown={onPointerDown}
            />,
        );

        const run = container.querySelector<HTMLElement>(
            "[data-layout-run-id]",
        );

        expect(container.querySelector("[data-layout-dom-text-layer]")).not.toBeNull();
        expect(container.querySelector("[data-tex-dom-text-layer]")).not.toBeNull();
        expect(run?.getAttribute("contenteditable")).toBe("true");
        expect(run?.getAttribute("data-layout-pm-from")).toBe("1");
        expect(run?.getAttribute("data-layout-pm-to")).toBe("6");
        expect(run?.getAttribute("data-layout-run-id")).toBe("line-1:block-1:0");

        run!.textContent = "Hallo";
        act(() => {
            run!.dispatchEvent(new Event("input", { bubbles: true }));
        });

        expect(onInput).toHaveBeenCalledWith({
            runId: "line-1:block-1:0",
            sourceFrom: 1,
            sourceTo: 6,
            text: "Hallo",
        });
    });

    it("reports a source offset when the user points into a run", () => {
        const onPointerDown = vi.fn();
        const container = renderLayer(
            <DomTextRunLayer
                lines={[
                    {
                        id: "line-1",
                        blockId: "block-1",
                        y: 0,
                        baseline: 16,
                        height: 20,
                        textRuns: [
                            {
                                blockId: "block-1",
                                pmFrom: 10,
                                pmTo: 14,
                                left: 0,
                                baseline: 16,
                                width: 40,
                                height: 20,
                                fontFamily: "Inter",
                                fontSize: 14,
                                text: "Text",
                            },
                        ],
                    },
                ]}
                onInput={() => {}}
                onPointerDown={onPointerDown}
            />,
        );

        const run = container.querySelector<HTMLElement>(
            "[data-layout-run-id]",
        )!;
        Object.defineProperty(run, "getBoundingClientRect", {
            value: () => ({
                bottom: 20,
                height: 20,
                left: 0,
                right: 40,
                top: 0,
                width: 40,
                x: 0,
                y: 0,
                toJSON: () => {},
            }),
        });

        act(() => {
            run.dispatchEvent(
                new MouseEvent("pointerdown", {
                    bubbles: true,
                    clientX: 20,
                    clientY: 10,
                }),
            );
        });

        expect(onPointerDown).toHaveBeenCalledWith({
            runId: "line-1:block-1:0",
            sourceOffset: 12,
        });
    });

    it("intercepts typed key text as a ProseMirror insertion range", () => {
        const onInput = vi.fn();
        const container = renderLayer(
            <DomTextRunLayer
                lines={[
                    {
                        id: "line-1",
                        blockId: "block-1",
                        y: 0,
                        baseline: 16,
                        height: 20,
                        textRuns: [
                            {
                                blockId: "block-1",
                                pmFrom: 10,
                                pmTo: 14,
                                left: 0,
                                baseline: 16,
                                width: 40,
                                height: 20,
                                fontFamily: "Inter",
                                fontSize: 14,
                                text: "Text",
                            },
                        ],
                    },
                ]}
                onInput={onInput}
                onPointerDown={vi.fn()}
            />,
        );

        const run = container.querySelector<HTMLElement>(
            "[data-layout-run-id]",
        )!;
        const range = document.createRange();
        range.setStart(run.firstChild!, 4);
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);

        act(() => {
            run.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "!",
                }),
            );
        });

        expect(onInput).toHaveBeenCalledWith({
            runId: "line-1:block-1:0",
            sourceFrom: 14,
            sourceTo: 14,
            text: "!",
        });
    });
});

function renderLayer(element: React.ReactElement) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });

    act(() => root.render(element));

    return container;
}
