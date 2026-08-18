"use client";

/**
 * The `D-015` performance harness, as a route the app itself serves.
 *
 * `D-015` requires the numbers to come from a release-like Tauri build with
 * release web assets and no DevTools. A Playwright-driven Chromium is not that
 * build, so the protocol cannot live in a Node script that pokes at the page
 * from outside: it has to run inside the WebView that ships. This route is that
 * protocol. `scripts/measure-editor-qualification.mjs` can drive it in a
 * browser for a development smoke run, and the artifact it produces is stamped
 * as non-qualifying for exactly that reason.
 *
 * It is reachable only when the build sets
 * `NEXT_PUBLIC_LOAM_MILKDOWN_QUALIFICATION=1`, the same build-time flag
 * `features/editor/lib/editor-surface-qualification.ts` already uses to reach
 * the Milkdown surface. Nothing links here: it is not in navigation, not in
 * settings, and not a preference. A build without the flag folds the whole
 * protocol away and the route renders a refusal.
 *
 * It imports the product contract from `packages/mdx-editor` and nothing else.
 * No Milkdown context, no ProseMirror position, no plugin key, and no
 * implementation-private selector appears here — the harness finds what it
 * needs to type into and scroll by walking generic DOM, the same way a user's
 * click and wheel do.
 */

import dynamic from "next/dynamic";

import { usesMilkdownQualificationSurface } from "@/features/editor/lib/editor-surface-qualification";

/**
 * The runner never renders on the server, and never reaches a build that has
 * not opted in: `usesMilkdownQualificationSurface()` compares against the
 * literal `process.env.NEXT_PUBLIC_*` name, so a build without the flag folds
 * this branch to `false` and drops the protocol entirely.
 */
const HarnessRunner = dynamic(() => import("./harness-runner"), { ssr: false });

export default function MdxEditorQualificationPage() {
    if (!usesMilkdownQualificationSurface()) {
        return (
            <main className="p-8 font-mono text-sm">
                <h1 className="text-base font-semibold">
                    Loam editor qualification harness
                </h1>
                <p className="mt-2 max-w-2xl">
                    This route is inert. It runs only in a build that sets
                    <code className="mx-1">NEXT_PUBLIC_LOAM_MILKDOWN_QUALIFICATION=1</code>
                    , the same build-time flag that reaches the Milkdown
                    qualification surface. There is no product-level switch, and
                    nothing in navigation or settings links here.
                </p>
            </main>
        );
    }
    return <HarnessRunner />;
}
