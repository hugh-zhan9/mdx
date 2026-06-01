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

const EXT_TO_MIME: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    avif: "image/avif",
    heic: "image/heic",
    tiff: "image/tiff",
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

function extOf(file: File | Blob, nameHint?: string): string {
    const name = (file instanceof File ? file.name : nameHint) || "";
    const dot = name.lastIndexOf(".");
    if (dot > 0 && dot < name.length - 1) {
        return name.slice(dot + 1).toLowerCase();
    }
    return MIME_TO_EXT[file.type] || "bin";
}

function mimeFromPath(path: string): string {
    const dot = path.lastIndexOf(".");
    if (dot < 0) return "application/octet-stream";
    return (
        EXT_TO_MIME[path.slice(dot + 1).toLowerCase()] ||
        "application/octet-stream"
    );
}

function dirname(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const index = normalized.lastIndexOf("/");
    return index >= 0 ? normalized.slice(0, index) : "";
}

function resolveRelative(baseDir: string, rel: string): string {
    const parts = baseDir.replace(/\\/g, "/").split("/").filter(Boolean);
    for (const segment of rel.replace(/\\/g, "/").split("/")) {
        if (!segment || segment === ".") continue;
        if (segment === "..") {
            parts.pop();
            continue;
        }
        parts.push(segment);
    }
    return parts.length > 0 ? `/${parts.join("/")}` : "/";
}

function isAbsoluteFsPath(path: string): boolean {
    return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}

function isUrlScheme(path: string): boolean {
    return /^[a-z][a-z0-9+.-]*:/i.test(path);
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
    options: { rootPath?: string; currentFilePath?: string } = {},
): Promise<string> {
    if (isUrlScheme(src) || src.startsWith("data:")) {
        return src;
    }

    let absPath: string | null = null;
    if (isAbsoluteFsPath(src)) {
        absPath = src;
    } else if (src.startsWith(".assets/") && options.rootPath) {
        absPath = resolveRelative(options.rootPath, src);
    } else if (!isUrlScheme(src) && options.currentFilePath) {
        absPath = resolveRelative(dirname(options.currentFilePath), src);
    }

    if (absPath && isTauri()) {
        const { invoke } = await tauriCore();
        const bytes = await invoke<number[]>("read_file_bytes", { path: absPath });
        const blob = new Blob([new Uint8Array(bytes)], {
            type: mimeFromPath(absPath),
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
