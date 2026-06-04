"use client";

import type { AppWindowSession } from "@/features/app/lib/app-session";

export function DocumentError({ session }: { session: AppWindowSession }) {
    const message =
        session.kind === "documentError" ? session.message : "无法打开文档。";

    return (
        <main className="flex h-screen items-center justify-center bg-base-100 text-base-content">
            <div className="text-sm text-error">{message}</div>
        </main>
    );
}
