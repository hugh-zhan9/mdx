"use client";

import { useEffect, useRef } from "react";
import {
    startDocumentWatch,
    startWorkspaceWatch,
    stopWatch,
} from "../lib/file-watch-client";
import type {
    FileWatchPayload,
    FrontendFileWatchEvent,
    WatchErrorPayload,
} from "../lib/types";

type FileWatchMode = "workspace" | "document";

interface UseFileWatchOptions {
    mode: FileWatchMode;
    rootPath?: string | null;
    path?: string | null;
    preferences: {
        fileWatchEnabled: boolean;
    };
    onEvent: (event: FrontendFileWatchEvent) => void;
    onError?: (error: WatchErrorPayload) => void;
}

export function useFileWatch({
    mode,
    rootPath,
    path,
    preferences,
    onEvent,
    onError,
}: UseFileWatchOptions) {
    const onEventRef = useRef(onEvent);
    const onErrorRef = useRef(onError);

    useEffect(() => {
        onEventRef.current = onEvent;
        onErrorRef.current = onError;
    }, [onError, onEvent]);

    useEffect(() => {
        if (!isTauriRuntime() || !preferences.fileWatchEnabled) {
            return;
        }

        const watchTarget = mode === "workspace" ? rootPath : path;

        if (!watchTarget) {
            return;
        }
        const resolvedWatchTarget = watchTarget;

        let cancelled = false;
        let activeWatchId: string | null = null;
        const unlisteners: Array<() => void> = [];
        const isActiveWatchPayload = (payload: { watchId: string }) =>
            !cancelled &&
            activeWatchId !== null &&
            payload.watchId === activeWatchId;

        async function start() {
            const { listen } = await import("@tauri-apps/api/event");
            const nextUnlisteners = await Promise.all([
                listen<FileWatchPayload>("mdx-file-created", (event) => {
                    if (!isActiveWatchPayload(event.payload)) {
                        return;
                    }

                    onEventRef.current(toFileWatchEvent("created", event.payload));
                }),
                listen<FileWatchPayload>("mdx-file-changed", (event) => {
                    if (!isActiveWatchPayload(event.payload)) {
                        return;
                    }

                    onEventRef.current(toFileWatchEvent("changed", event.payload));
                }),
                listen<FileWatchPayload>("mdx-file-deleted", (event) => {
                    if (!isActiveWatchPayload(event.payload)) {
                        return;
                    }

                    onEventRef.current(toFileWatchEvent("deleted", event.payload));
                }),
                listen<FileWatchPayload>("mdx-file-renamed", (event) => {
                    const payload = event.payload;

                    if (!isActiveWatchPayload(payload)) {
                        return;
                    }

                    if (!payload.newPath) {
                        return;
                    }

                    onEventRef.current({
                        ...payload,
                        kind: "renamed",
                        newPath: payload.newPath,
                    });
                }),
                listen<WatchErrorPayload>("mdx-watch-error", (event) => {
                    if (!isActiveWatchPayload(event.payload)) {
                        return;
                    }

                    onErrorRef.current?.(event.payload);
                }),
            ]);

            if (cancelled) {
                nextUnlisteners.forEach((unlisten) => unlisten());
                return;
            }

            unlisteners.push(...nextUnlisteners);
            const started =
                mode === "workspace"
                    ? await startWorkspaceWatch(resolvedWatchTarget)
                    : await startDocumentWatch(resolvedWatchTarget);

            if (cancelled) {
                await stopWatch(started.watchId).catch((error) => {
                    console.warn("Failed to stop cancelled file watch.", error);
                });
                return;
            }

            activeWatchId = started.watchId;
        }

        void start().catch((error) => {
            if (!cancelled) {
                console.warn("Failed to start file watch.", error);
                onErrorRef.current?.({
                    watchId: activeWatchId ?? "",
                    message: formatErrorMessage(error),
                    eventTime: new Date().toISOString(),
                });
            }
        });

        return () => {
            cancelled = true;
            unlisteners.forEach((unlisten) => unlisten());

            const watchIdToStop = activeWatchId;
            activeWatchId = null;

            if (watchIdToStop) {
                void stopWatch(watchIdToStop).catch((error) => {
                    console.warn("Failed to stop file watch.", error);
                });
            }
        };
    }, [mode, path, preferences.fileWatchEnabled, rootPath]);
}

function toFileWatchEvent(
    kind: "created" | "changed" | "deleted",
    payload: FileWatchPayload,
): FrontendFileWatchEvent {
    return {
        ...payload,
        kind,
    };
}

function isTauriRuntime() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    if (typeof error === "string" && error.length > 0) {
        return error;
    }

    return "File watch failed.";
}
