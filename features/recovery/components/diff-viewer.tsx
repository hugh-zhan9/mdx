"use client";

import { X } from "lucide-react";
import { useMemo } from "react";
import { buildLineDiff } from "../lib/line-diff";

interface DiffViewerProps {
    open: boolean;
    title: string;
    leftTitle: string;
    rightTitle: string;
    leftText: string;
    rightText: string;
    primaryAction: { label: string; onClick: () => void };
    secondaryActions: Array<{
        label: string;
        onClick: () => void;
        destructive?: boolean;
    }>;
    onClose: () => void;
}

export function DiffViewer({
    open,
    title,
    leftTitle,
    rightTitle,
    leftText,
    rightText,
    primaryAction,
    secondaryActions,
    onClose,
}: DiffViewerProps) {
    const diffLines = useMemo(
        () => buildLineDiff(leftText, rightText),
        [leftText, rightText],
    );

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex min-w-0 items-center justify-center bg-black/35 p-4">
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="mdx-recovery-diff-title"
                className="flex max-h-[90vh] w-full max-w-6xl min-w-0 flex-col border border-base-300 bg-base-100 text-base-content shadow-xl"
            >
                <header className="flex min-w-0 items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                    <h2
                        id="mdx-recovery-diff-title"
                        className="min-w-0 break-words text-sm font-semibold"
                    >
                        {title}
                    </h2>
                    <button
                        type="button"
                        aria-label="关闭"
                        title="关闭"
                        className="flex h-8 w-8 shrink-0 items-center justify-center text-base-content/70 outline-none transition-colors hover:bg-base-200 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        onClick={onClose}
                    >
                        <X aria-hidden="true" size={16} />
                    </button>
                </header>

                <div className="min-h-0 max-h-[70vh] overflow-auto">
                    <div className="grid min-w-[48rem] grid-cols-2 border-b border-base-300 bg-base-200 text-xs font-semibold text-base-content/75">
                        <div className="border-r border-base-300 px-3 py-2">
                            {leftTitle}
                        </div>
                        <div className="px-3 py-2">{rightTitle}</div>
                    </div>
                    <div className="min-w-[48rem] font-mono text-xs leading-relaxed">
                        {diffLines.map((line, index) => (
                            <DiffRow
                                key={`${index}-${line.kind}-${line.leftLine ?? ""}-${line.rightLine ?? ""}`}
                                kind={line.kind}
                                leftLine={line.leftLine}
                                rightLine={line.rightLine}
                                text={line.text}
                            />
                        ))}
                    </div>
                </div>

                <footer className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-base-300 px-4 py-3">
                    {secondaryActions.map((action) => (
                        <button
                            key={action.label}
                            type="button"
                            className={[
                                "h-8 px-3 text-sm outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                                action.destructive
                                    ? "text-error hover:bg-error/10"
                                    : "text-base-content/70 hover:bg-base-200",
                            ].join(" ")}
                            onClick={action.onClick}
                        >
                            {action.label}
                        </button>
                    ))}
                    <button
                        type="button"
                        className="h-8 bg-base-content px-3 text-sm text-base-100 outline-none transition-colors hover:bg-base-content/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        onClick={primaryAction.onClick}
                    >
                        {primaryAction.label}
                    </button>
                </footer>
            </section>
        </div>
    );
}

function DiffRow({
    kind,
    leftLine,
    rightLine,
    text,
}: {
    kind: "equal" | "added" | "removed";
    leftLine: number | null;
    rightLine: number | null;
    text: string;
}) {
    const removed = kind === "removed";
    const added = kind === "added";

    return (
        <div
            className={[
                "grid grid-cols-2 border-b border-base-300/70",
                removed ? "bg-error/10" : "",
                added ? "bg-success/10" : "",
            ]
                .filter(Boolean)
                .join(" ")}
        >
            <DiffCell
                lineNumber={leftLine}
                text={removed || kind === "equal" ? text : ""}
                active={removed}
                muted={added}
                border
            />
            <DiffCell
                lineNumber={rightLine}
                text={added || kind === "equal" ? text : ""}
                active={added}
                muted={removed}
            />
        </div>
    );
}

function DiffCell({
    lineNumber,
    text,
    active,
    muted,
    border,
}: {
    lineNumber: number | null;
    text: string;
    active: boolean;
    muted: boolean;
    border?: boolean;
}) {
    return (
        <div
            className={[
                "grid min-w-0 grid-cols-[4rem_minmax(0,1fr)]",
                border ? "border-r border-base-300" : "",
                muted ? "text-base-content/35" : "text-base-content/85",
                active ? "font-semibold" : "",
            ]
                .filter(Boolean)
                .join(" ")}
        >
            <div className="select-none border-r border-base-300/70 px-2 py-1 text-right text-base-content/45">
                {lineNumber ?? ""}
            </div>
            <pre className="min-w-0 whitespace-pre-wrap break-words px-3 py-1">
                {text || " "}
            </pre>
        </div>
    );
}
