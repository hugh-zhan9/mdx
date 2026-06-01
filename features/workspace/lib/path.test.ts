import { describe, expect, it } from "vitest";
import {
    isMarkdownFilePath,
    isPathInsideRoot,
    normalizeWorkspacePath,
} from "./path";

describe("normalizeWorkspacePath", () => {
    it("normalizes separators and dot segments", () => {
        expect(normalizeWorkspacePath("/tmp/ws//Drafts/./Idea.md")).toBe(
            "/tmp/ws/Drafts/Idea.md",
        );
        expect(normalizeWorkspacePath("C:\\Users\\me\\ws\\..\\ws\\A.md")).toBe(
            "C:/Users/me/ws/A.md",
        );
    });
});

describe("isPathInsideRoot", () => {
    it("accepts the root and descendants only", () => {
        expect(isPathInsideRoot("/tmp/ws", "/tmp/ws")).toBe(true);
        expect(isPathInsideRoot("/tmp/ws", "/tmp/ws/Drafts/Idea.md")).toBe(
            true,
        );
        expect(isPathInsideRoot("/tmp/ws", "/tmp/workspace/Idea.md")).toBe(
            false,
        );
        expect(isPathInsideRoot("/tmp/ws", "/tmp/ws/../outside.md")).toBe(
            false,
        );
    });

    it("handles filesystem roots as workspace roots", () => {
        expect(isPathInsideRoot("/", "/tmp/ws/Idea.md")).toBe(true);
        expect(isPathInsideRoot("C:/", "C:/Users/me/ws/Idea.md")).toBe(true);
    });
});

describe("isMarkdownFilePath", () => {
    it("allows md and markdown files only", () => {
        expect(isMarkdownFilePath("/tmp/ws/Idea.md")).toBe(true);
        expect(isMarkdownFilePath("/tmp/ws/Idea.markdown")).toBe(true);
        expect(isMarkdownFilePath("/tmp/ws/Idea.MD")).toBe(true);
        expect(isMarkdownFilePath("/tmp/ws/Idea.mdx")).toBe(false);
        expect(isMarkdownFilePath("/tmp/ws/Idea.txt")).toBe(false);
    });
});
