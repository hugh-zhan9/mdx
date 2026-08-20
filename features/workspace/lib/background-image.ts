"use client";

import { tauriCore } from "@/common/lib/tauri";

import type { BackgroundFit } from "./background-preference";

/**
 * The stored copy of the background image, and the URL the page paints with.
 *
 * The picture is copied into `~/.loam/background/` rather than referenced where
 * the user found it, for the same reason a pasted image is copied into the
 * workspace: a reference breaks the first time a photo is moved out of
 * Downloads. Rust owns that directory and answers with raw bytes; what CSS gets
 * is a blob this module made, never a path.
 */

/** Largest image accepted, matching the cap Rust enforces. */
export const MAX_BACKGROUND_BYTES = 12 * 1024 * 1024;

/**
 * The image kinds a background may be, and what each one is.
 *
 * The keys are `IMAGE_EXTENSIONS` in `src-tauri/src/assets.rs`, which is the
 * list Rust will actually store — pinned against it by test, because a picker
 * offering a kind Rust refuses is a file chosen and then rejected.
 *
 * The types are needed on this side because the load command answers with bytes
 * and nothing else: a raw response has no room for a MIME type, and a blob with
 * no type is an image the browser will not decode.
 */
export const BACKGROUND_IMAGE_TYPES: Record<string, string> = {
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

/**
 * What the file picker offers.
 *
 * The extensions themselves rather than `image/*`, so the picker greys out what
 * cannot be stored. `image/*` let macOS offer a `.tif` — an extension Rust does
 * not list — and choosing one answered with an English sentence in an otherwise
 * Chinese panel.
 */
export const BACKGROUND_ACCEPT = Object.keys(BACKGROUND_IMAGE_TYPES)
    .map((extension) => `.${extension}`)
    .join(",");

/** A caller's own bridge, for tests. Defaults to the real one. */
interface InvokeOptions {
    invoke?: <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;
}

interface SaveBackgroundImageResponse {
    fileName: string;
}

/**
 * The blob URL currently in effect.
 *
 * Module state, and one entry, because one background is in effect at a time and
 * every window that asks wants the same one. Held so that re-applying the same
 * setting — which happens on every opacity drag — does not read the file again
 * or leak a second blob.
 */
let current: { fileName: string; url: string } | null = null;

/**
 * The read in flight, and the record of which read is still wanted.
 *
 * Both the shell and the appearance panel apply the background, so two callers
 * can ask at once; a second ask for the same file joins the first rather than
 * starting its own. It is also how a read learns it was abandoned — see
 * `readBackgroundImage`.
 */
let pending: { fileName: string; promise: Promise<string> } | null = null;

/** Stores the chosen file, answering with the name to keep in the preference. */
export async function storeBackgroundImage(
    file: File,
    options: InvokeOptions = {},
): Promise<string> {
    if (!(extensionOf(file.name) in BACKGROUND_IMAGE_TYPES)) {
        throw new Error(
            `不支持这种图片格式，可用的是 ${Object.keys(BACKGROUND_IMAGE_TYPES).join("、")}`,
        );
    }

    if (file.size > MAX_BACKGROUND_BYTES) {
        throw new Error(
            `图片超过 ${String(MAX_BACKGROUND_BYTES / (1024 * 1024))} MiB 上限`,
        );
    }

    // The typed array is sent as it is, like every other stored image: turning
    // twelve megabytes into a twelve-million-element JSON array is the one way
    // to make choosing a wallpaper feel slow.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { invoke } = await bridge(options);
    const stored = await invoke<SaveBackgroundImageResponse>(
        "save_background_image",
        { name: file.name, bytes },
    );

    return stored.fileName;
}

/** Deletes the stored copy. The preference is the caller's to clear. */
export async function clearStoredBackgroundImage(
    options: InvokeOptions = {},
): Promise<void> {
    const { invoke } = await bridge(options);

    await invoke("clear_background_image", {});
    releaseBackgroundImageUrl();
}

/**
 * The URL for a stored image, reading it only when it is not the one in effect.
 *
 * The previous blob is revoked as the new one replaces it. Revoking is what keeps
 * a window that has been through a dozen pictures from holding all twelve.
 */
export async function backgroundImageUrl(
    fileName: string,
    options: InvokeOptions = {},
): Promise<string> {
    if (current?.fileName === fileName) {
        return current.url;
    }

    if (pending?.fileName === fileName) {
        return pending.promise;
    }

    const promise = readBackgroundImage(fileName, options);
    pending = { fileName, promise };

    try {
        return await promise;
    } finally {
        if (pending?.promise === promise) {
            pending = null;
        }
    }
}

async function readBackgroundImage(
    fileName: string,
    options: InvokeOptions,
): Promise<string> {
    const { invoke } = await bridge(options);
    const bytes = await invoke<ArrayBuffer>("load_background_image", { fileName });
    const url = URL.createObjectURL(
        new Blob([bytes], { type: BACKGROUND_IMAGE_TYPES[extensionOf(fileName)] }),
    );

    if (pending?.fileName !== fileName) {
        // Abandoned while it was reading: the background was removed, or another
        // picture became the current one. Dropping this blob here rather than
        // installing it is what keeps a late read from revoking the URL that is
        // already painted — and from leaving a blob nothing will ever revoke.
        URL.revokeObjectURL(url);
        throw new Error("背景图已改变");
    }

    releaseBackgroundImageUrl();
    current = { fileName, url };

    return url;
}

/** Drops the blob in effect, and abandons any read still on its way. */
export function releaseBackgroundImageUrl(): void {
    pending = null;

    if (current === null) return;

    URL.revokeObjectURL(current.url);
    current = null;
}

function extensionOf(fileName: string): string {
    const dot = fileName.lastIndexOf(".");

    return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

async function bridge(options: InvokeOptions) {
    return options.invoke ? { invoke: options.invoke } : await tauriCore();
}

/** What each layout is called, and what it does to the picture. */
export const BACKGROUND_FIT_OPTIONS: Array<{
    value: BackgroundFit;
    label: string;
    hint: string;
}> = [
    {
        value: "cover",
        label: "铺满",
        hint: "整张图缩放到填满，超出的边裁掉。照片用这个。",
    },
    {
        value: "tile",
        label: "平铺",
        hint: "按原始尺寸重复。纸纹、格线这类能接缝的图案用这个。",
    },
];
