import { describe, expect, it, vi } from "vitest";
import {
    assignEditorViewportRef,
    isEditorFindShortcut,
    isEditorReplaceShortcut,
    resolveEditorRootFromContent,
} from "./editor-pane";

vi.mock("./editor-kernel-adapter", () => ({
    DOMD: () => null,
    DOMDProvider: ({ children }: { children: React.ReactNode }) => children,
    toMarkdown: () => "",
    useEditor: () => null,
    useEditorStoreApi: () => null,
    useRenderData: () => null,
}));

vi.mock("./editor-mermaid-preview-layer", () => ({
    EditorMermaidPreviewLayer: () => null,
}));

describe("editor find/replace shortcuts", () => {
    it("recognizes Command+F and Ctrl+F without alt", () => {
        expect(
            isEditorFindShortcut({
                altKey: false,
                code: "KeyF",
                ctrlKey: false,
                metaKey: true,
            }),
        ).toBe(true);
        expect(
            isEditorFindShortcut({
                altKey: false,
                code: "KeyF",
                ctrlKey: true,
                metaKey: false,
            }),
        ).toBe(true);
        expect(
            isEditorFindShortcut({
                altKey: true,
                code: "KeyF",
                ctrlKey: false,
                metaKey: true,
            }),
        ).toBe(false);
    });

    it("recognizes Command+R and Ctrl+R without alt", () => {
        expect(
            isEditorReplaceShortcut({
                altKey: false,
                code: "KeyR",
                ctrlKey: false,
                metaKey: true,
            }),
        ).toBe(true);
        expect(
            isEditorReplaceShortcut({
                altKey: false,
                code: "KeyR",
                ctrlKey: true,
                metaKey: false,
            }),
        ).toBe(true);
        expect(
            isEditorReplaceShortcut({
                altKey: true,
                code: "KeyR",
                ctrlKey: false,
                metaKey: true,
            }),
        ).toBe(false);
    });
});

describe("editor pane root helpers", () => {
    it("assigns external editor viewport refs", () => {
        const viewport = {} as HTMLDivElement;
        const editorViewportRef: { current: HTMLDivElement | null } = {
            current: null,
        };

        assignEditorViewportRef(editorViewportRef, viewport);

        expect(editorViewportRef.current).toBe(viewport);

        assignEditorViewportRef(editorViewportRef, null);

        expect(editorViewportRef.current).toBeNull();
    });

    it("resolves the content wrapper when no MDX editor root exists", () => {
        const wrapper = {
            querySelector: vi.fn(() => null),
        } as unknown as HTMLElement;

        expect(resolveEditorRootFromContent(wrapper)).toBe(wrapper);
        expect(resolveEditorRootFromContent(null)).toBeNull();
    });

    it("prefers the MDX editor root inside the content wrapper", () => {
        const editorRoot = {} as HTMLElement;
        const wrapper = {
            querySelector: vi.fn(() => editorRoot),
        } as unknown as HTMLElement;

        expect(resolveEditorRootFromContent(wrapper)).toBe(editorRoot);
        expect(wrapper.querySelector).toHaveBeenCalledWith(
            "[data-mdx-editor-root]",
        );
    });

    it("can resolve from wrapper to the MDX editor root after it appears later", () => {
        const editorRoot = {} as HTMLElement;
        const querySelector = vi.fn<() => HTMLElement | null>()
            .mockReturnValueOnce(null)
            .mockReturnValueOnce(editorRoot);
        const wrapper = {
            querySelector,
        } as unknown as HTMLElement;

        expect(resolveEditorRootFromContent(wrapper)).toBe(wrapper);
        expect(resolveEditorRootFromContent(wrapper)).toBe(editorRoot);
    });
});
