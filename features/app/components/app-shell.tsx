"use client";

import { useEffect, useState } from "react";
import { tauriCore } from "@/common/lib/tauri";
import { DocumentApp } from "@/features/document/components/document-app";
import { DocumentError } from "@/features/document/components/document-error";
import { WorkspaceApp } from "@/features/workspace/components/workspace-app";
import {
    normalizeAppWindowSession,
    type AppWindowSession,
} from "../lib/app-session";

export function AppShell() {
    const [session, setSession] = useState<AppWindowSession | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadSession() {
            if (!isTauriRuntime()) {
                setSession({ kind: "workspace" });
                return;
            }

            try {
                const { invoke } = await tauriCore();
                const rawSession = await invoke("get_window_session");
                if (!cancelled) {
                    setSession(normalizeAppWindowSession(rawSession));
                }
            } catch (error) {
                console.warn("Failed to load MDX window session.", error);
                if (!cancelled) {
                    setSession(normalizeSessionFromLocation());
                }
            }
        }

        void loadSession();

        return () => {
            cancelled = true;
        };
    }, []);

    if (!session) {
        return (
            <main className="flex h-screen items-center justify-center bg-base-100 text-sm text-base-content/70">
                正在打开 MDX...
            </main>
        );
    }

    if (session.kind === "document") {
        return <DocumentApp session={session} />;
    }

    if (session.kind === "documentError") {
        return <DocumentError session={session} />;
    }

    return <WorkspaceApp />;
}

function normalizeSessionFromLocation(): AppWindowSession {
    if (typeof window === "undefined") {
        return { kind: "workspace" };
    }

    const params = new URLSearchParams(window.location.search);
    const realPath = params.get("realPath");

    if (params.get("mode") !== "document" || !realPath) {
        return { kind: "workspace" };
    }

    return normalizeAppWindowSession({
        kind: "document",
        fileName: fileNameFromPath(realPath),
        displayPath: realPath,
        realPath,
    });
}

function fileNameFromPath(path: string) {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) ?? path;
}

function isTauriRuntime() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
