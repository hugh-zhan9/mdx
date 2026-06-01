import { isTauri } from "./platform";
import { tauriCore } from "./tauri";

const MIME_TO_EXT: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/avif": "avif",
    "image/heic": "heic",
    "image/tiff": "tiff",
};

export interface StoredImage {
    url: string;
    altText: string;
}

export interface StoredWorkspaceImage extends StoredImage {
    storedPath: string;
    usedFallback: boolean;
}

export interface StoreImageForWorkspaceOptions {
    rootPath?: string | null;
    currentFilePath?: string | null;
    invoke?: <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;
}

interface SaveImageAssetResponse {
    markdownPath: string;
    storedPath: string;
    usedFallback: boolean;
}

interface LoadImageAssetResponse {
    bytes: number[];
    mimeType: string;
    path: string;
}

function extOf(file: File | Blob, nameHint?: string): string {
    const name = (file instanceof File ? file.name : nameHint) || "";
    const dot = name.lastIndexOf(".");
    if (dot > 0 && dot < name.length - 1) {
        return name.slice(dot + 1).toLowerCase();
    }
    return MIME_TO_EXT[file.type] || "bin";
}

function isPassthroughImageUrl(src: string): boolean {
    return src.startsWith("//") || /^(https?:|data:|blob:)/i.test(src);
}

export async function storeImageForWorkspace(
    file: File,
    options: StoreImageForWorkspaceOptions = {},
): Promise<StoredWorkspaceImage> {
    const ext = extOf(file);
    const name = file.name || `image.${ext}`;
    const altText = name;
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (options.invoke || isTauri()) {
        const { invoke } = options.invoke
            ? { invoke: options.invoke }
            : await tauriCore();
        const response = await invoke<SaveImageAssetResponse>("save_image_asset", {
            rootPath: options.rootPath ?? null,
            currentFilePath: options.currentFilePath ?? null,
            name,
            bytes,
        });

        return {
            url: response.markdownPath,
            altText,
            storedPath: response.storedPath,
            usedFallback: response.usedFallback,
        };
    }

    const url = URL.createObjectURL(file);
    return {
        url,
        altText,
        storedPath: url,
        usedFallback: false,
    };
}

export async function storeImage(file: File): Promise<StoredWorkspaceImage> {
    return storeImageForWorkspace(file);
}

export async function loadImage(
    src: string,
    options: {
        rootPath?: string | null;
        currentFilePath?: string | null;
        invoke?: <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;
    } = {},
): Promise<string> {
    if (isPassthroughImageUrl(src)) {
        return src;
    }

    if (options.invoke || isTauri()) {
        const { invoke } = options.invoke
            ? { invoke: options.invoke }
            : await tauriCore();
        const image = await invoke<LoadImageAssetResponse>("load_image_asset", {
            rootPath: options.rootPath ?? null,
            currentFilePath: options.currentFilePath ?? null,
            src,
        });
        const blob = new Blob([new Uint8Array(image.bytes)], {
            type: image.mimeType,
        });
        return URL.createObjectURL(blob);
    }

    return src;
}

export const IMAGE_EXTENSIONS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "bmp",
    "avif",
    "heic",
    "tiff",
]);

export function isImagePath(p: string): boolean {
    const dot = p.lastIndexOf(".");
    if (dot < 0) return false;
    return IMAGE_EXTENSIONS.has(p.slice(dot + 1).toLowerCase());
}
