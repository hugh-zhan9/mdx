"use client";

import type { AppWindowSession } from "@/features/app/lib/app-session";
import { AppDialogProvider } from "@/features/workspace/components/app-dialogs";
import { DocumentShell } from "./document-shell";

export function DocumentApp({
    session,
}: {
    session: Extract<AppWindowSession, { kind: "document" }>;
}) {
    return (
        <AppDialogProvider>
            <DocumentShell session={session} />
        </AppDialogProvider>
    );
}
