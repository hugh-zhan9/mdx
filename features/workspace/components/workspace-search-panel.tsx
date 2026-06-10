"use client";

import { formatSearchSummary } from "../lib/workspace-search";
import type {
    AppPreferences,
    WorkspaceFullTextSearchState,
    WorkspaceSearchResultItem,
} from "../lib/types";

interface WorkspaceSearchPanelProps {
    rootPath: string;
    state: WorkspaceFullTextSearchState;
    preferences: AppPreferences;
    onQueryChange: (query: string) => void;
    onCaseSensitiveToggle: () => void;
    onResultClick: (result: WorkspaceSearchResultItem) => void;
}

export function WorkspaceSearchPanel({
    rootPath,
    state,
    preferences,
    onQueryChange,
    onCaseSensitiveToggle,
    onResultClick,
}: WorkspaceSearchPanelProps) {
    const hasQuery = state.query.trim().length > 0;
    const summaryLabel =
        state.status === "complete" ? formatSearchSummary(state.summary) : null;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-base-300 bg-base-100 px-2 py-2">
                <input
                    type="search"
                    className="h-8 w-full border border-base-300 bg-base-100 px-2 text-xs text-base-content outline-none transition-colors placeholder:text-base-content/65 focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                    value={state.query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="搜索 Markdown 内容"
                    aria-label="搜索工作区 Markdown 内容"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                        type="button"
                        aria-pressed={state.caseSensitive}
                        className={[
                            "h-7 shrink-0 border px-2 text-xs outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
                            state.caseSensitive
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-base-300 text-base-content/75 hover:bg-base-200 hover:text-base-content",
                        ].join(" ")}
                        onClick={onCaseSensitiveToggle}
                    >
                        区分大小写
                    </button>
                    <div className="min-w-0 text-right text-[11px] leading-relaxed text-base-content/55 break-words">
                        {`当前工作区：${rootPath}`}
                    </div>
                </div>
            </div>

            <div className="border-b border-base-300 bg-base-200/40 px-3 py-2 text-xs text-base-content/70 break-words">
                {state.status === "idle"
                    ? `输入后自动搜索，最多显示 ${preferences.searchMaxResults} 条结果。`
                    : state.status === "typing"
                      ? "停止输入后开始搜索..."
                      : state.status === "searching"
                        ? "正在搜索..."
                        : state.status === "error"
                          ? state.error ?? "搜索失败。"
                          : summaryLabel}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                {!hasQuery ? (
                    <div className="px-3 py-4 text-sm leading-relaxed text-base-content/60">
                        {`支持搜索 .md 和 .markdown，最多显示 ${preferences.searchMaxResults} 条结果，每个文件最多 ${preferences.searchMaxMatchesPerFile} 条匹配。`}
                    </div>
                ) : state.status === "complete" && state.results.length === 0 ? (
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
