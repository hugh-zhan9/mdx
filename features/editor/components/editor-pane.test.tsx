import { describe, expect, it, vi } from "vitest";
import {
    assignEditorViewportRef,
    isEditorFindShortcut,
    isEditorReplaceShortcut,
    resolveEditorRootFromContent,
} from "./editor-pane";

vi.mock("@do-md/react", () => ({
    DOMD: () => null,
    DOMDProvider: ({ children }: { children: React.ReactNode }) => children,
    toMarkdown: () => "",
    useEditor: () => null,
    useEditorStoreApi: () => null,
    useRenderData: () => null,
}));

vi.mock("@do-md/react/style.css", () => ({}));

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

    it("resolves the content wrapper when no DOMD root exists", () => {
        const wrapper = {
            querySelector: vi.fn(() => null),
        } as unknown as HTMLElement;

        expect(resolveEditorRootFromContent(wrapper)).toBe(wrapper);
        expect(resolveEditorRootFromContent(null)).toBeNull();
    });

    it("prefers DOMD root inside the content wrapper", () => {
        const domdRoot = {} as HTMLElement;
        const wrapper = {
            querySelector: vi.fn(() => domdRoot),
        } as unknown as HTMLElement;

        expect(resolveEditorRootFromContent(wrapper)).toBe(domdRoot);
        expect(wrapper.querySelector).toHaveBeenCalledWith(".DOMD-Root");
    });

    it("can resolve from wrapper to DOMD root after it appears later", () => {
        const domdRoot = {} as HTMLElement;
        const querySelector = vi.fn<() => HTMLElement | null>()
            .mockReturnValueOnce(null)
            .mockReturnValueOnce(domdRoot);
        const wrapper = {
            querySelector,
        } as unknown as HTMLElement;

        expect(resolveEditorRootFromContent(wrapper)).toBe(wrapper);
        expect(resolveEditorRootFromContent(wrapper)).toBe(domdRoot);
    });
});
