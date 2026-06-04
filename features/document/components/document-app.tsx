"use client";

import type { AppWindowSession } from "@/features/app/lib/app-session";

export function DocumentApp({ session }: { session: AppWindowSession }) {
    return (
        <main className="flex h-screen items-center justify-center bg-base-100 text-base-content">
            <div className="text-sm text-base-content/70">
                {session.kind === "document"
                    ? session.fileName
                    : "正在打开文档..."}
            </div>
        </main>
    );
}
