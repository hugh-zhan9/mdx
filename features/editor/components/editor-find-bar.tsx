"use client";

import type { ChangeEvent, CompositionEvent, KeyboardEvent } from "react";

export interface EditorFindBarProps {
    caseSensitive: boolean;
    countLabel: string;
    isReplaceExpanded: boolean;
    matchCount: number;
    query: string;
    replacement: string;
    onCaseSensitiveToggle: () => void;
    onClose: () => void;
    onNext: () => void;
    onPrevious: () => void;
    onQueryChange: (query: string) => void;
    onReplaceAll: () => void;
    onReplaceCurrent: () => void;
    onReplacementChange: (replacement: string) => void;
    onReplaceToggle: () => void;
}

export function EditorFindBar({
    caseSensitive,
    countLabel,
    isReplaceExpanded,
    matchCount,
    query,
    replacement,
    onCaseSensitiveToggle,
    onClose,
    onNext,
    onPrevious,
    onQueryChange,
    onReplaceAll,
    onReplaceCurrent,
    onReplacementChange,
    onReplaceToggle,
}: EditorFindBarProps) {
    const hasReplaceTarget = query.length > 0 && matchCount > 0;
    const hasMatches = matchCount > 0;

    function handleFindKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) {
                onPrevious();
                return;
            }
            onNext();
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            onClose();
        }
    }

    function handleFindChange(event: ChangeEvent<HTMLInputElement>) {
        if (isComposingChange(event)) {
            return;
        }

        onQueryChange(event.target.value);
    }

    function handleFindCompositionEnd(
        event: CompositionEvent<HTMLInputElement>,
    ) {
        onQueryChange(event.currentTarget.value);
    }

    function handleReplacementChange(event: ChangeEvent<HTMLInputElement>) {
        if (isComposingChange(event)) {
            return;
        }

        onReplacementChange(event.target.value);
    }

    function handleReplacementCompositionEnd(
        event: CompositionEvent<HTMLInputElement>,
    ) {
        onReplacementChange(event.currentTarget.value);
    }

    function handleReplacementKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Enter") {
            event.preventDefault();
            if (hasReplaceTarget) {
                onReplaceCurrent();
            }
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            onClose();
        }
    }

    return (
        <div className="border-b border-[var(--mdx-separator)] bg-[var(--mdx-chrome-bg)] px-2 py-2">
            <div className="flex items-center gap-2">
                <span
                    aria-hidden="true"
                    className="w-5 text-center text-sm text-base-content/60"
                >
                    /
                </span>
                <input
                    aria-label="查找"
                    autoFocus
                    className="input input-sm input-bordered h-8 min-w-0 flex-1"
                    value={query}
                    onChange={handleFindChange}
                    onCompositionEnd={handleFindCompositionEnd}
                    onKeyDown={handleFindKeyDown}
                />
                <span className="min-w-12 text-center text-xs tabular-nums text-base-content/60">
                    {countLabel}
                </span>
                <button
                    aria-label="上一处"
                    className="btn btn-ghost btn-sm h-8 min-h-8 w-8 px-0"
                    disabled={!hasMatches}
                    type="button"
                    onClick={onPrevious}
                >
                    ↑
                </button>
                <button
                    aria-label="下一处"
                    className="btn btn-ghost btn-sm h-8 min-h-8 w-8 px-0"
                    disabled={!hasMatches}
                    type="button"
                    onClick={onNext}
                >
                    ↓
                </button>
                <button
                    aria-label="大小写敏感"
                    aria-pressed={caseSensitive}
                    className="btn btn-ghost btn-sm h-8 min-h-8 px-2"
                    type="button"
                    onClick={onCaseSensitiveToggle}
                >
                    Aa
                </button>
                <button
                    aria-label="替换"
                    aria-pressed={isReplaceExpanded}
                    className="btn btn-ghost btn-sm h-8 min-h-8 w-8 px-0"
                    type="button"
                    onClick={onReplaceToggle}
                >
                    ⇄
                </button>
                <button
                    aria-label="关闭查找"
                    className="btn btn-ghost btn-sm h-8 min-h-8 w-8 px-0"
                    type="button"
                    onClick={onClose}
                >
                    ×
                </button>
            </div>
            {isReplaceExpanded ? (
                <div className="mt-2 flex items-center gap-2 pl-7">
                    <input
                        aria-label="替换为"
                        className="input input-sm input-bordered h-8 min-w-0 flex-1"
                        value={replacement}
                        onChange={handleReplacementChange}
                        onCompositionEnd={handleReplacementCompositionEnd}
                        onKeyDown={handleReplacementKeyDown}
                    />
                    <button
                        className="btn btn-sm h-8 min-h-8"
                        disabled={!hasReplaceTarget}
                        type="button"
                        onClick={onReplaceCurrent}
                    >
                        替换
                    </button>
                    <button
                        className="btn btn-sm h-8 min-h-8"
                        disabled={!hasReplaceTarget}
                        type="button"
                        onClick={onReplaceAll}
                    >
                        替换全部
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function isComposingChange(event: ChangeEvent<HTMLInputElement>) {
    return Boolean(
        (event.nativeEvent as Event & { isComposing?: boolean }).isComposing,
    );
}
