"use client";

import { useMemo } from "react";

import { documentStats } from "../lib/document-stats";

/**
 * What the document amounts to, along the bottom of the editor.
 *
 * A status bar rather than a panel: it is read out of the corner of the eye
 * while writing something else, so it states its numbers and offers nothing to
 * click. The numbers are tabular so that a count changing as you type does not
 * shift the ones beside it.
 */
export function DocumentStatusBar({ markdown }: { markdown: string }) {
    const stats = useMemo(() => documentStats(markdown), [markdown]);

    return (
        <footer
            data-mdx-document-status-bar=""
            className="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--mdx-separator)] bg-[var(--mdx-chrome-bg)] px-3 text-[11px] tabular-nums text-base-content/55"
        >
            <span>{stats.words} 词</span>
            <span>{stats.characters} 字符</span>
            {/*
             * A document with no prose in it has no reading time, and printing
             * "about 0 minutes" would be stating one it does not have.
             */}
            {stats.minutes > 0 ? <span>约 {stats.minutes} 分钟</span> : null}
        </footer>
    );
}
