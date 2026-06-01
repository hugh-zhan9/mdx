import { afterEach, describe, expect, it, vi } from "vitest";
import { loadImage, storeImageForWorkspace } from "./image-storage";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("storeImage", () => {
    it("uses workspace .assets first and falls back to ~/.mdx/assets", async () => {
        const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
        const invoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
            calls.push({ cmd, args });
            return {
                markdownPath: ".assets/abc123.png",
                storedPath: "/tmp/ws/.assets/abc123.png",
                usedFallback: false,
            };
        });
        const file = new File([new Uint8Array([1, 2, 3])], "paste.png", {
            type: "image/png",
        });

        const stored = storeImageForWorkspace(file, {
            rootPath: "/tmp/ws",
            currentFilePath: "/tmp/ws/doc.md",
            invoke,
        });

        await expect(stored).resolves.toMatchObject({
            url: ".assets/abc123.png",
            altText: "paste.png",
        });
        expect(calls[0].cmd).toBe("save_image_asset");
    });

    it("returns the absolute global fallback path from Tauri", async () => {
        const invoke = vi.fn(async () => ({
            markdownPath: "/Users/test/.mdx/assets/abc123.png",
            storedPath: "/Users/test/.mdx/assets/abc123.png",
            usedFallback: true,
        }));
        const file = new File([new Uint8Array([4, 5, 6])], "fallback.png", {
            type: "image/png",
        });

        await expect(
            storeImageForWorkspace(file, {
                rootPath: "/tmp/ws",
                currentFilePath: "/tmp/ws/doc.md",
                invoke,
            }),
        ).resolves.toMatchObject({
            url: "/Users/test/.mdx/assets/abc123.png",
            altText: "fallback.png",
            storedPath: "/Users/test/.mdx/assets/abc123.png",
            usedFallback: true,
        });
    });

    it("returns URLs unchanged and invokes Rust for local image paths", async () => {
        const invoke = vi.fn(async () => ({
            bytes: [1, 2, 3],
            mimeType: "image/png",
            path: "/tmp/ws/.assets/abc123.png",
        }));
        const createObjectURL = vi
            .spyOn(URL, "createObjectURL")
            .mockReturnValue("blob:mock");

        await expect(loadImage("https://example.com/image.png")).resolves.toBe(
            "https://example.com/image.png",
        );
        await expect(loadImage("data:image/png;base64,AAAA")).resolves.toBe(
            "data:image/png;base64,AAAA",
        );

        await expect(
            loadImage(".assets/abc123.png", {
                rootPath: "/tmp/ws",
                currentFilePath: "/tmp/ws/doc.md",
                invoke,
            }),
        ).resolves.toBe("blob:mock");
        await expect(
            loadImage("images/abc123.png", {
                rootPath: "/tmp/ws",
                currentFilePath: "/tmp/ws/doc.md",
                invoke,
            }),
        ).resolves.toBe("blob:mock");

        expect(invoke).toHaveBeenCalledWith("load_image_asset", {
            rootPath: "/tmp/ws",
            currentFilePath: "/tmp/ws/doc.md",
            src: ".assets/abc123.png",
        });
        expect(invoke).toHaveBeenCalledWith("load_image_asset", {
            rootPath: "/tmp/ws",
            currentFilePath: "/tmp/ws/doc.md",
            src: "images/abc123.png",
        });
        expect(createObjectURL).toHaveBeenCalledTimes(2);
    });
});
