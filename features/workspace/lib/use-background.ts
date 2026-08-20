"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
    backgroundImageUrl,
    clearStoredBackgroundImage,
    releaseBackgroundImageUrl,
    storeBackgroundImage,
} from "./background-image";
import {
    DEFAULT_BACKGROUND_OPACITY,
    applyBackgroundToRoot,
    clampOpacity,
    readBackgroundSetting,
    subscribeToBackgroundSetting,
    writeBackgroundSetting,
    type BackgroundFit,
    type BackgroundSetting,
} from "./background-preference";

/**
 * Keeps the background image on the page, and changes it.
 *
 * One hook does both because applying is idempotent: the blob is read once and
 * held, so a second mount paints the same URL rather than a second copy. That
 * matters because two places need it — the shell, which has to paint the
 * background whether or not anyone opens settings, and the panel, which has to
 * show what is set and what went wrong with it.
 *
 * The failure it reports is the one that cannot be guessed from looking: a
 * preference naming a file that is no longer in `~/.loam/background/`. A
 * background that silently does nothing is a state the user cannot diagnose.
 */
export interface BackgroundControls {
    setting: BackgroundSetting | null;
    /** Why the stored image is not on screen, when it is not. */
    error: string | null;
    /** True while a file is being stored or removed. */
    busy: boolean;
    choose: (file: File) => Promise<void>;
    remove: () => Promise<void>;
    setOpacity: (opacity: number) => void;
    setFit: (fit: BackgroundFit) => void;
}

export function useBackground(): BackgroundControls {
    const setting = useSyncExternalStore(
        subscribeToBackgroundSetting,
        readBackgroundSetting,
        () => null,
    );
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const root = document.documentElement;

        if (setting === null) {
            applyBackgroundToRoot(root, null);
            releaseBackgroundImageUrl();
            // The message is deliberately left alone. This branch also runs the
            // moment a background is removed, and clearing here wiped whatever
            // `remove` had just reported. Every action clears the message when it
            // starts, so nothing stale survives.
            return;
        }

        let cancelled = false;

        void backgroundImageUrl(setting.fileName)
            .then((url) => {
                if (cancelled) return;

                applyBackgroundToRoot(root, {
                    url,
                    opacity: setting.opacity,
                    fit: setting.fit,
                });
                setError(null);
            })
            .catch((reason: unknown) => {
                if (cancelled) return;

                // Nothing is painted rather than something wrong being painted,
                // and the preference is left alone: the file may come back, and
                // silently forgetting the choice would be a second surprise.
                applyBackgroundToRoot(root, null);
                setError(messageOf(reason));
            });

        return () => {
            cancelled = true;
        };
    }, [setting]);

    const choose = useCallback(async (file: File) => {
        setBusy(true);
        setError(null);

        try {
            const fileName = await storeBackgroundImage(file);
            const current = readBackgroundSetting();

            // The strength and the layout are kept across a change of picture:
            // someone comparing two images is comparing them at the setting they
            // already chose, not re-dialling it each time.
            writeBackgroundSetting({
                fileName,
                opacity: current?.opacity ?? DEFAULT_BACKGROUND_OPACITY,
                fit: current?.fit ?? "cover",
            });
        } catch (reason) {
            setError(messageOf(reason));
        } finally {
            setBusy(false);
        }
    }, []);

    const remove = useCallback(async () => {
        setBusy(true);
        setError(null);

        // The preference goes first, so the background is off the window even if
        // the command fails. The other order leaves someone looking at a
        // background they asked to remove.
        //
        // A copy that cannot be deleted is not among the failures reachable here:
        // Rust treats that as wasted disk rather than lost work and does not
        // report it. What can still fail is the command itself — no home
        // directory, or no bridge to Rust at all.
        writeBackgroundSetting(null);

        try {
            await clearStoredBackgroundImage();
        } catch (reason) {
            setError(messageOf(reason));
        } finally {
            setBusy(false);
        }
    }, []);

    const setOpacity = useCallback((opacity: number) => {
        const current = readBackgroundSetting();

        if (current === null) return;

        writeBackgroundSetting({ ...current, opacity: clampOpacity(opacity) });
    }, []);

    const setFit = useCallback((fit: BackgroundFit) => {
        const current = readBackgroundSetting();

        if (current === null) return;

        writeBackgroundSetting({ ...current, fit });
    }, []);

    return { setting, error, busy, choose, remove, setOpacity, setFit };
}

function messageOf(reason: unknown): string {
    if (reason instanceof Error) return reason.message;

    if (typeof reason === "object" && reason !== null) {
        const { message } = reason as Record<string, unknown>;

        if (typeof message === "string") return message;
    }

    return String(reason);
}
