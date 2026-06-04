import { describe, expect, it } from "vitest";
import {
    isHtmlFilePath,
    isImageFilePath,
    isMarkdownFilePath,
    isPdfFilePath,
    isPathInsideRoot,
    isPlainTextFilePath,
    isPreviewableFilePath,
    shouldOpenWithDefaultApplication,
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

describe("isPdfFilePath", () => {
    it("allows pdf files only", () => {
        expect(isPdfFilePath("/tmp/ws/Source.pdf")).toBe(true);
        expect(isPdfFilePath("/tmp/ws/Source.PDF")).toBe(true);
        expect(isPdfFilePath("/tmp/ws/Source.md")).toBe(false);
    });
});

describe("isPlainTextFilePath", () => {
    it("allows common plain text and source files", () => {
        expect(isPlainTextFilePath("/tmp/ws/notes.txt")).toBe(true);
        expect(isPlainTextFilePath("/tmp/ws/notes.TXT")).toBe(true);
        expect(isPlainTextFilePath("/tmp/ws/Main.java")).toBe(true);
        expect(isPlainTextFilePath("/tmp/ws/script.py")).toBe(true);
        expect(isPlainTextFilePath("/tmp/ws/config.json")).toBe(true);
        expect(isPlainTextFilePath("/tmp/ws/app.yaml")).toBe(true);
        expect(isPlainTextFilePath("/tmp/ws/archive.mhtml")).toBe(true);
        expect(isPlainTextFilePath("/tmp/ws/LICENSE")).toBe(true);
        expect(isPlainTextFilePath("/tmp/ws/notes.md")).toBe(false);
        expect(isPlainTextFilePath("/tmp/ws/movie.mp4")).toBe(false);
    });
});

describe("isHtmlFilePath", () => {
    it("allows html and htm files only", () => {
        expect(isHtmlFilePath("/tmp/ws/page.html")).toBe(true);
        expect(isHtmlFilePath("/tmp/ws/page.htm")).toBe(true);
        expect(isHtmlFilePath("/tmp/ws/page.HTML")).toBe(true);
        expect(isHtmlFilePath("/tmp/ws/page.md")).toBe(false);
    });
});

describe("isImageFilePath", () => {
    it("allows common image files only", () => {
        expect(isImageFilePath("/tmp/ws/image.png")).toBe(true);
        expect(isImageFilePath("/tmp/ws/image.jpg")).toBe(true);
        expect(isImageFilePath("/tmp/ws/image.jpeg")).toBe(true);
        expect(isImageFilePath("/tmp/ws/image.jfif")).toBe(true);
        expect(isImageFilePath("/tmp/ws/image.gif")).toBe(true);
        expect(isImageFilePath("/tmp/ws/image.webp")).toBe(true);
        expect(isImageFilePath("/tmp/ws/image.awebp")).toBe(true);
        expect(isImageFilePath("/tmp/ws/image.svg")).toBe(true);
        expect(isImageFilePath("/tmp/ws/image.bmp")).toBe(true);
        expect(isImageFilePath("/tmp/ws/image.avif")).toBe(true);
        expect(isImageFilePath("/tmp/ws/image.heic")).toBe(true);
        expect(isImageFilePath("/tmp/ws/image.tiff")).toBe(true);
        expect(isImageFilePath("/tmp/ws/image.Png")).toBe(true);
        expect(isImageFilePath("/tmp/ws/archive.zip")).toBe(false);
    });
});

describe("isPreviewableFilePath", () => {
    it("allows markdown, pdf, txt, html, and image files", () => {
        expect(isPreviewableFilePath("/tmp/ws/Idea.md")).toBe(true);
        expect(isPreviewableFilePath("/tmp/ws/Book.pdf")).toBe(true);
        expect(isPreviewableFilePath("/tmp/ws/notes.txt")).toBe(true);
        expect(isPreviewableFilePath("/tmp/ws/page.html")).toBe(true);
        expect(isPreviewableFilePath("/tmp/ws/page.htm")).toBe(true);
        expect(isPreviewableFilePath("/tmp/ws/photo.png")).toBe(true);
        expect(isPreviewableFilePath("/tmp/ws/source.java")).toBe(true);
        expect(isPreviewableFilePath("/tmp/ws/archive.mhtml")).toBe(true);
        expect(isPreviewableFilePath("/tmp/ws/photo.jfif")).toBe(true);
        expect(isPreviewableFilePath("/tmp/ws/archive.zip")).toBe(false);
    });
});

describe("shouldOpenWithDefaultApplication", () => {
    it("uses the default application for files without an in-app preview", () => {
        expect(shouldOpenWithDefaultApplication("/tmp/ws/Brief.doc")).toBe(true);
        expect(shouldOpenWithDefaultApplication("/tmp/ws/Brief.docx")).toBe(true);
        expect(shouldOpenWithDefaultApplication("/tmp/ws/Budget.xlsx")).toBe(true);
        expect(shouldOpenWithDefaultApplication("/tmp/ws/Deck.pptx")).toBe(true);
        expect(shouldOpenWithDefaultApplication("/tmp/ws/archive.zip")).toBe(true);
    });

    it("keeps previewable files inside the app", () => {
        expect(shouldOpenWithDefaultApplication("/tmp/ws/Idea.md")).toBe(false);
        expect(shouldOpenWithDefaultApplication("/tmp/ws/Book.pdf")).toBe(false);
        expect(shouldOpenWithDefaultApplication("/tmp/ws/notes.txt")).toBe(false);
        expect(shouldOpenWithDefaultApplication("/tmp/ws/photo.png")).toBe(false);
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
