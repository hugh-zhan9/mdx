"use client";

import { EmptyState } from "@/common/components/ui-controls";
import type { AppWindowSession } from "@/features/app/lib/app-session";

export function DocumentError({
    session,
}: {
    session: Extract<AppWindowSession, { kind: "documentError" }>;
}) {
    return (
        <main className="flex h-screen items-center justify-center bg-base-100 px-6 text-base-content">
            <EmptyState
                title="无法打开 Markdown 文档"
                description={[session.message, session.path]
                    .filter(Boolean)
                    .join(" ")}
                actionLabel={null}
            />
        </main>
    );
}
