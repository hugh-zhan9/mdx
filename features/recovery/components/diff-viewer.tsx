"use client";

import { ChevronsUpDown, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
    PrimaryTextControlButton,
    TextControlButton,
} from "../../../common/components/ui-controls";
import {
    buildDiffSegments,
    type DiffSegment,
    summarizeDiff,
} from "../lib/diff-segments";
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
    const diffLines = useMemo(() => {
        if (!open) {
            return [];
        }

        return buildLineDiff(leftText, rightText);
    }, [leftText, open, rightText]);

    const summary = useMemo(() => summarizeDiff(diffLines), [diffLines]);
    const segments = useMemo(() => buildDiffSegments(diffLines), [diffLines]);

    if (!open) {
        return null;
    }

    const identical = summary.changes === 0;

    return (
        <div className="fixed inset-0 z-50 flex min-w-0 items-center justify-center bg-black/35 p-4">
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="mdx-recovery-diff-title"
                className="flex max-h-[90vh] w-full max-w-6xl min-w-0 flex-col rounded-[var(--mdx-control-radius)] border border-[var(--mdx-field-border)] bg-base-100 text-base-content shadow-xl"
            >
                <header className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--mdx-separator)] px-4 py-3">
                    <div className="flex min-w-0 items-baseline gap-3">
                        <h2
                            id="mdx-recovery-diff-title"
                            className="min-w-0 break-words text-sm font-semibold"
                        >
                            {title}
                        </h2>
                        <p className="shrink-0 text-xs text-base-content/60">
                            {identical ? (
                                "两侧内容一致"
                            ) : (
                                <>
                                    {`${summary.changes} 处差异 · `}
                                    <span className="text-success">
                                        +{summary.added}
                                    </span>
                                    {" / "}
                                    <span className="text-error">
                                        −{summary.removed}
                                    </span>
                                </>
                            )}
                        </p>
                    </div>
                    <button
                        type="button"
                        aria-label="关闭"
                        title="关闭"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--mdx-control-radius)] text-base-content/70 outline-none transition-colors hover:bg-base-200 hover:text-base-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                        onClick={onClose}
                    >
                        <X aria-hidden="true" size={16} />
                    </button>
                </header>

                <div className="min-h-0 max-h-[70vh] overflow-auto">
                    <div className="sticky top-0 z-10 grid min-w-[48rem] grid-cols-2 border-b border-[var(--mdx-separator)] bg-base-200 text-xs font-semibold text-base-content/75">
                        <div className="border-r border-[var(--mdx-separator)] px-3 py-2">
                            {leftTitle}
                        </div>
                        <div className="px-3 py-2">{rightTitle}</div>
                    </div>
                    {identical ? (
                        <div className="px-4 py-10 text-center text-xs text-base-content/60">
                            两个版本逐行相同，没有需要选择的差异。
                        </div>
                    ) : (
                        // Keyed on the compared content so a different pair of
                        // versions opens folded again, instead of inheriting
                        // whatever the previous one had expanded.
                        <DiffBody
                            key={`${leftText.length}:${rightText.length}:${diffLines.length}:${summary.added}:${summary.removed}`}
                            segments={segments}
                        />
                    )}
                </div>

                <footer className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--mdx-separator)] px-4 py-3">
                    {secondaryActions.map((action) => (
                        <TextControlButton
                            key={action.label}
                            onClick={action.onClick}
                            className={
                                action.destructive
                                    ? "hover:bg-error/10 hover:text-error active:bg-error/15"
                                    : undefined
                            }
                        >
                            {action.label}
                        </TextControlButton>
                    ))}
                    <PrimaryTextControlButton onClick={primaryAction.onClick}>
                        {primaryAction.label}
                    </PrimaryTextControlButton>
                </footer>
            </section>
        </div>
    );
}

function DiffBody({ segments }: { segments: DiffSegment[] }) {
    const [expandedIds, setExpandedIds] = useState<string[]>([]);

    return (
        <div className="min-w-[48rem] font-mono text-xs leading-relaxed">
            {segments.map((segment, segmentIndex) =>
                segment.kind === "collapsed" &&
                !expandedIds.includes(segment.id) ? (
                    <CollapsedRun
                        key={segment.id}
                        hiddenCount={segment.lines.length}
                        onExpand={() =>
                            setExpandedIds((current) => [
                                ...current,
                                segment.id,
                            ])
                        }
                    />
                ) : (
                    segment.lines.map((line, index) => (
                        <DiffRow
                            key={`${segmentIndex}-${index}-${line.kind}-${line.leftLine ?? ""}-${line.rightLine ?? ""}`}
                            kind={line.kind}
                            leftLine={line.leftLine}
                            rightLine={line.rightLine}
                            text={line.text}
                        />
                    ))
                ),
            )}
        </div>
    );
}

function CollapsedRun({
    hiddenCount,
    onExpand,
}: {
    hiddenCount: number;
    onExpand: () => void;
}) {
    return (
        <button
            type="button"
            className="flex w-full items-center gap-2 border-b border-[var(--mdx-separator)]/70 bg-base-200/60 px-3 py-1.5 text-left text-xs text-base-content/55 outline-none transition-colors hover:bg-base-200 hover:text-base-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            onClick={onExpand}
        >
            <ChevronsUpDown aria-hidden="true" size={14} />
            {`展开 ${hiddenCount} 行未变化内容`}
        </button>
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
                "grid grid-cols-2 border-b border-[var(--mdx-separator)]/70",
                removed ? "bg-error/10" : "",
                added ? "bg-success/10" : "",
            ]
                .filter(Boolean)
                .join(" ")}
        >
            <DiffCell
                lineNumber={leftLine}
                marker={removed ? "−" : null}
                text={removed || kind === "equal" ? text : ""}
                active={removed}
                muted={added}
                border
            />
            <DiffCell
                lineNumber={rightLine}
                marker={added ? "+" : null}
                text={added || kind === "equal" ? text : ""}
                active={added}
                muted={removed}
            />
        </div>
    );
}

function DiffCell({
    lineNumber,
    marker,
    text,
    active,
    muted,
    border,
}: {
    lineNumber: number | null;
    marker: "+" | "−" | null;
    text: string;
    active: boolean;
    muted: boolean;
    border?: boolean;
}) {
    return (
        <div
            className={[
                "grid min-w-0 grid-cols-[4rem_1rem_minmax(0,1fr)]",
                border ? "border-r border-[var(--mdx-separator)]" : "",
                muted ? "text-base-content/35" : "text-base-content/85",
                active ? "font-semibold" : "",
            ]
                .filter(Boolean)
                .join(" ")}
        >
            <div className="select-none border-r border-[var(--mdx-separator)]/70 px-2 py-1 text-right text-base-content/45">
                {lineNumber ?? ""}
            </div>
            {/* The tint alone is easy to miss on a pale theme, and invisible to
                anyone reading the diff without colour. */}
            <div
                aria-hidden={marker ? undefined : "true"}
                className={[
                    "select-none py-1 text-center",
                    marker === "+" ? "text-success" : "",
                    marker === "−" ? "text-error" : "",
                ]
                    .filter(Boolean)
                    .join(" ")}
            >
                {marker ?? ""}
            </div>
            <pre className="min-w-0 whitespace-pre-wrap break-words px-3 py-1">
                {text || " "}
            </pre>
        </div>
    );
}
