import { isMarkdownFilePath } from "./path";
import type {
    DirtySearchOverride,
    WorkspaceFullTextSearchState,
    WorkspaceSearchState,
    WorkspaceSearchResponse,
    WorkspaceSearchSummary,
    WorkspaceState,
    WorkspaceTab,
} from "./types";

export function createEmptySearchSummary(): WorkspaceSearchSummary {
    return {
        skippedLargeFiles: 0,
        skippedUnreadableFiles: 0,
        truncated: false,
        searchedFiles: 0,
    };
}

export function createEmptyWorkspaceSearchState(): WorkspaceFullTextSearchState {
    return {
        query: "",
        caseSensitive: false,
        status: "idle",
        requestId: null,
        results: [],
        summary: createEmptySearchSummary(),
        error: null,
    };
}

export function ensureWorkspaceSearchState(
    state: WorkspaceSearchState | undefined,
): WorkspaceFullTextSearchState {
    const empty = createEmptyWorkspaceSearchState();

    return {
        ...empty,
        ...state,
        summary: state?.summary ?? empty.summary,
        results: state?.results ?? empty.results,
        requestId: state?.requestId ?? empty.requestId,
        error: state?.error ?? empty.error,
        caseSensitive: state?.caseSensitive ?? empty.caseSensitive,
        status: state?.status ?? empty.status,
    };
}

export function collectDirtySearchOverrides(
    workspace: WorkspaceState,
): DirtySearchOverride[] {
    return workspace.tabOrder
        .map((tabId) => workspace.tabs[tabId])
        .flatMap((tab) =>
            isDirtyMarkdownTab(tab)
                ? [{ path: tab.path, markdown: tab.markdown }]
                : [],
        );
}

export function normalizeSearchQuery(query: string) {
    return query.trim();
}

export function shouldAcceptSearchResponse(
    currentRequestId: string | null,
    response: Pick<WorkspaceSearchResponse, "requestId">,
) {
    return currentRequestId !== null && currentRequestId === response.requestId;
}

export function formatSearchSummary(summary: WorkspaceSearchSummary) {
    const parts = [`已搜索 ${summary.searchedFiles} 个文件`];
    const skipped: string[] = [];

    if (summary.skippedLargeFiles > 0) {
        skipped.push(`${summary.skippedLargeFiles} 个大文件`);
    }

    if (summary.skippedUnreadableFiles > 0) {
        skipped.push(`${summary.skippedUnreadableFiles} 个无法读取文件`);
    }

    if (skipped.length > 0) {
        parts.push(`跳过 ${skipped.join("、")}`);
    }

    if (summary.truncated) {
        parts.push("仅显示前若干结果");
    }

    return `${parts.join("，")}。`;
}

function isDirtyMarkdownTab(
    tab: WorkspaceTab | undefined,
): tab is WorkspaceTab & { markdown: string } {
    return Boolean(
        tab?.dirty &&
            tab.markdown !== undefined &&
            isMarkdownFilePath(tab.path),
    );
}
