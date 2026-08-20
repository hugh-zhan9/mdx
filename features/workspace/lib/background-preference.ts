"use client";

/**
 * The background image behind the document, and how strongly it shows.
 *
 * Deliberately not part of the theme contract. `docs/loopx/specs/theme.md`
 * promises a theme cannot load anything, and that promise is what makes an
 * unfamiliar theme safe to try — so a picture is a preference of this machine
 * rather than a property a shared `.css` file may set. The stored copy lives in
 * `~/.loam/background/` and is named by `fileName`; Rust owns that directory.
 *
 * What reaches CSS is two custom properties and one attribute, and nothing else:
 *
 * - `--mdx-bg-image` — the `url()` of a blob this application created from bytes
 *   it read itself. Never a path, and never anything the user typed.
 * - `--mdx-bg-veil-strength` — how much of the theme's own background colour is
 *   laid back over the image. This is the whole reason the image can be faded
 *   without fading the text: the picture and the veil are two background layers
 *   of the same element, so the words on top keep their full contrast, and the
 *   image fades towards the theme's colour rather than towards white.
 * - `data-mdx-bg` on the root — absent, `"cover"` or `"tile"`. Absent means the
 *   rules do not apply at all, which is how "no background" costs nothing.
 */

/** How the image is laid out: one copy scaled to fill, or repeated. */
export type BackgroundFit = "cover" | "tile";

export interface BackgroundSetting {
    /** The stored copy's file name, as `save_background_image` answered with. */
    fileName: string;
    /** How much of the image shows through, `0`–`1`. */
    opacity: number;
    fit: BackgroundFit;
}

const STORAGE_KEY = "backgroundImage";
const CHANGE_EVENT = "mdx-background-change";

/**
 * Low, because a background is a ground and not a picture.
 *
 * At this strength a texture reads as paper and a photograph as a tint, and body
 * text keeps the contrast the theme gave it. Someone who wants more can say so;
 * someone who did not think about it should not have to undo anything.
 */
export const DEFAULT_BACKGROUND_OPACITY = 0.12;

/** The attribute the stylesheet keys the whole feature off. */
export const BACKGROUND_ROOT_ATTRIBUTE = "data-mdx-bg";
export const BACKGROUND_IMAGE_PROPERTY = "--mdx-bg-image";
export const BACKGROUND_VEIL_PROPERTY = "--mdx-bg-veil-strength";

export function clampOpacity(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_OPACITY;

    return Math.min(1, Math.max(0, value));
}

/**
 * A stored value, or null when it is not one.
 *
 * Validated rather than trusted: `localStorage` is ordinary storage the user can
 * edit, and the file name goes on to be sent to a command that reads a file. The
 * separator check is not the check that matters — Rust refuses a name that is not
 * a single file name — but a value refused here never becomes a failed command.
 */
export function parseBackgroundSetting(raw: unknown): BackgroundSetting | null {
    if (typeof raw !== "object" || raw === null) return null;

    const { fileName, opacity, fit } = raw as Record<string, unknown>;

    if (typeof fileName !== "string") return null;

    const name = fileName.trim();

    if (
        name.length === 0 ||
        name.startsWith(".") ||
        name.includes("/") ||
        name.includes("\\")
    ) {
        return null;
    }

    // The name is refused outright above; the strength and the layout are
    // repaired here. That asymmetry is the point: a wrong name would send a
    // command looking for a file nobody chose, while a missing layout has one
    // obvious answer and no way to be dangerous.
    return {
        fileName: name,
        opacity:
            typeof opacity === "number"
                ? clampOpacity(opacity)
                : DEFAULT_BACKGROUND_OPACITY,
        fit: fit === "tile" ? "tile" : "cover",
    };
}

/**
 * The last stored text and what it parsed to.
 *
 * `readBackgroundSetting` is a `useSyncExternalStore` snapshot, so it has to
 * answer with the *same object* while nothing has changed — a fresh one every
 * call is a render loop. Keyed on the stored text rather than invalidated by the
 * writer, so a change made in another window through `storage` is picked up too.
 */
let cache: { raw: string | null; setting: BackgroundSetting | null } | null = null;

export function readBackgroundSetting(): BackgroundSetting | null {
    if (typeof localStorage === "undefined") return null;

    let raw: string | null;

    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch {
        // Unreadable storage. There is no background, which is a state the
        // window can be in.
        return null;
    }

    if (cache !== null && cache.raw === raw) {
        return cache.setting;
    }

    let setting: BackgroundSetting | null = null;

    try {
        setting = raw === null ? null : parseBackgroundSetting(JSON.parse(raw));
    } catch {
        // Text that is not JSON. Treated as no background rather than repaired.
        setting = null;
    }

    cache = { raw, setting };

    return setting;
}

/** Stores the setting, or removes it, and tells the window to re-read it. */
export function writeBackgroundSetting(setting: BackgroundSetting | null): void {
    // Dropped before the write, not after: a write is an event, and the next read
    // has to answer with a new object even when the text is unchanged. Without
    // this, re-choosing a picture whose stored copy had gone missing wrote a
    // byte-identical preference, the snapshot stayed `Object.is`-equal, and the
    // effect that paints never ran again — the file was back, the error message
    // was gone, and there was no way to make the background appear.
    cache = null;

    try {
        if (setting === null) {
            localStorage.removeItem(STORAGE_KEY);
        } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(setting));
        }
    } catch {
        // Private or locked-down storage, or an exhausted quota. Storage is the
        // only source of truth here, so nothing takes effect — not even for this
        // window — and the panel goes on showing the value that is still stored.
        // Left as it is rather than reported: on a desktop application holding a
        // handful of small keys there is no reachable way to get here, and an
        // error path nothing can trigger is one nothing can be trusted to do.
    }

    if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(CHANGE_EVENT));
    }
}

export function subscribeToBackgroundSetting(callback: () => void): () => void {
    if (typeof window === "undefined") return () => {};

    const handleStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY) callback();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(CHANGE_EVENT, callback);

    return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(CHANGE_EVENT, callback);
    };
}

/**
 * Puts a resolved background on the page, or takes it off.
 *
 * `url` is a blob this application made; it is written into a custom property
 * inside `url("…")` with quotes and backslashes escaped, because a property
 * value is the one place a string could otherwise end early.
 */
export function applyBackgroundToRoot(
    root: HTMLElement,
    resolved: { url: string; opacity: number; fit: BackgroundFit } | null,
): void {
    if (resolved === null) {
        root.removeAttribute(BACKGROUND_ROOT_ATTRIBUTE);
        root.style.removeProperty(BACKGROUND_IMAGE_PROPERTY);
        root.style.removeProperty(BACKGROUND_VEIL_PROPERTY);
        return;
    }

    root.style.setProperty(
        BACKGROUND_IMAGE_PROPERTY,
        `url("${cssUrlSafe(resolved.url)}")`,
    );
    root.style.setProperty(
        BACKGROUND_VEIL_PROPERTY,
        veilStrength(resolved.opacity),
    );
    root.setAttribute(BACKGROUND_ROOT_ATTRIBUTE, resolved.fit);
}

/**
 * How much theme colour is laid back over the image, as a percentage.
 *
 * The inverse of the opacity the user set: a veil of 100% is the theme's own
 * background and hides the picture completely, and 0% shows it as it is.
 */
export function veilStrength(opacity: number): string {
    return `${String(Math.round((1 - clampOpacity(opacity)) * 100))}%`;
}

function cssUrlSafe(url: string): string {
    return url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
