"use client";

import { formatSearchSummary } from "../lib/workspace-search";
import type {
    AppPreferences,
    WorkspaceFullTextSearchState,
    WorkspaceSearchResultItem,
} from "../lib/types";

interface WorkspaceSearchPanelProps {
    state: WorkspaceFullTextSearchState;
    preferences: AppPreferences;
    onCaseSensitiveToggle: () => void;
    onResultClick: (result: WorkspaceSearchResultItem) => void;
}

export function WorkspaceSearchPanel({
    state,
    preferences,
    onCaseSensitiveToggle,
    onResultClick,
}: WorkspaceSearchPanelProps) {
    const hasQuery = state.query.trim().length > 0;
    const summaryLabel =
        state.status === "complete" ? formatSearchSummary(state.summary) : null;

    return (
        <div className="flex min-h-0 flex-col">
            {/*
             * No query field of its own: content search and the file filter are
             * driven by the one search box above the tree. Two boxes asking for
             * a search in the same panel made the user decide which kind of
             * search they wanted before they had typed anything.
             */}
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] text-base-content/55">
                <span className="min-w-0 break-words">
                    {state.status === "typing"
                        ? "停止输入后开始搜索…"
                        : state.status === "searching"
                          ? "正在搜索…"
                          : state.status === "error"
                            ? (state.error ?? "搜索失败。")
                            : state.status === "complete"
                              ? summaryLabel
                              : `最多显示 ${preferences.searchMaxResults} 条结果`}
                </span>
                <button
                    type="button"
                    aria-pressed={state.caseSensitive}
                    title="区分大小写"
                    className={[
                        "h-5 shrink-0 rounded-[5px] px-1.5 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/25",
                        state.caseSensitive
                            ? "bg-primary/12 text-primary"
                            : "text-base-content/55 hover:bg-base-content/6 hover:text-base-content/80",
                    ].join(" ")}
                    onClick={onCaseSensitiveToggle}
                >
                    Aa
                </button>
            </div>

            <div className="min-h-0 flex-1">
                {!hasQuery ? null : state.status === "complete" &&
                  state.results.length === 0 ? (
                    <div className="px-3 py-4 text-sm leading-relaxed text-base-content/60">
                        未找到匹配项。
                    </div>
                ) : (
                    state.results.map((result) => (
                        <button
                            key={resultKey(result)}
                            type="button"
                            className="w-full border-b border-base-300/70 px-3 py-3 text-left outline-none transition-colors hover:bg-base-200/70 focus-visible:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                            onClick={() => onResultClick(result)}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 text-xs leading-relaxed text-base-content/60 break-words">
                                    {result.path}
                                </div>
                                <div className="shrink-0 text-[11px] text-base-content/55">
                                    {`第 ${result.lineNumber} 行`}
                                </div>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                                {result.dirty ? (
                                    <span className="inline-flex shrink-0 border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">
                                        未保存
                                    </span>
                                ) : null}
                            </div>
                            {result.before ? (
                                <div className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-base-content/45">
                                    {result.before}
                                </div>
                            ) : null}
                            <div className="mt-1 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-base-content">
                                {renderMatchedLine(result)}
                            </div>
                            {result.after ? (
                                <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-base-content/45">
                                    {result.after}
                                </div>
                            ) : null}
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}

function renderMatchedLine(result: WorkspaceSearchResultItem) {
    const start = Math.max(0, Math.min(result.columnStart, result.line.length));
    const end = Math.max(start, Math.min(result.columnEnd, result.line.length));

    return (
        <>
            <span>{result.line.slice(0, start)}</span>
            <mark className="bg-warning/30 px-0 text-base-content">
                {result.line.slice(start, end)}
            </mark>
            <span>{result.line.slice(end)}</span>
        </>
    );
}

function resultKey(result: WorkspaceSearchResultItem) {
    return [
        result.path,
        result.lineNumber,
        result.columnStart,
        result.columnEnd,
    ].join(":");
}
