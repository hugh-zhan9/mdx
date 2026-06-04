"use client";

import type { ChangeEvent, KeyboardEvent } from "react";

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
        <div className="border-b border-base-300 bg-base-100 px-2 py-2">
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
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        onQueryChange(event.target.value)
                    }
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
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            onReplacementChange(event.target.value)
                        }
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
