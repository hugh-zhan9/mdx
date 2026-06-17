import type { ReactNode } from "react";
import { TextControlButton } from "../../../common/components/ui-controls";
import type { MemoryRecord, MemorySummary } from "../lib/types";

interface MemoryLongTermTabProps {
  memories: MemorySummary[];
  selectedMemory: MemoryRecord | null;
  selectedMemoryId: string | null;
  loading: boolean;
  memoryLoading: boolean;
  onRefresh: () => Promise<void>;
  onSelect: (memoryId: string) => void;
  onArchive: (target: string) => Promise<void>;
  isActionPending: (key: string) => boolean;
}

export function MemoryLongTermTab({
  memories,
  selectedMemory,
  selectedMemoryId,
  loading,
  memoryLoading,
  onRefresh,
  onSelect,
  onArchive,
  isActionPending,
}: MemoryLongTermTabProps) {
  return (
    <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <ListPanel
        title="长期记忆"
        loading={loading}
        empty="暂无活跃长期记忆"
        onRefresh={onRefresh}
      >
        {memories.map((memory) => (
          <div
            key={memory.memory_id}
            className="border-t border-base-300 py-2 first:border-t-0 first:pt-0"
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <button
                  type="button"
                  className={[
                    "block max-w-full truncate text-left font-medium outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    selectedMemoryId === memory.memory_id
                      ? "text-base-content"
                      : "text-base-content/75 hover:text-base-content",
                  ].join(" ")}
                  title={memory.title}
                  onClick={() => onSelect(memory.memory_id)}
                >
                  {memory.title}
                </button>
                <div
                  className="mt-1 truncate text-base-content/60"
                  title={memory.path}
                >
                  {memory.status} · {memory.path}
                </div>
                {memory.tags.length > 0 ? (
                  <div className="mt-1 truncate text-base-content/60">
                    {memory.tags.join(", ")}
                  </div>
                ) : null}
              </div>
              <TextControlButton
                disabled={isActionPending(`archive:${memory.memory_id}`)}
                onClick={() => void onArchive(memory.memory_id)}
              >
                {isActionPending(`archive:${memory.memory_id}`)
                  ? "归档中"
                  : "归档"}
              </TextControlButton>
            </div>
          </div>
        ))}
      </ListPanel>
      <MemoryPreviewPanel
        loading={memoryLoading}
        selectedMemory={selectedMemory}
        selectedMemoryId={selectedMemoryId}
      />
    </div>
  );
}

function MemoryPreviewPanel({
  loading,
  selectedMemory,
  selectedMemoryId,
}: {
  loading: boolean;
  selectedMemory: MemoryRecord | null;
  selectedMemoryId: string | null;
}) {
  const preview = selectedMemory ? previewBody(selectedMemory.body) : "";

  return (
    <div className="space-y-2 border border-base-300 bg-base-200/60 p-2">
      <div className="min-w-0 truncate font-medium text-base-content">
        {selectedMemory?.frontmatter.title ??
          (selectedMemoryId ? "加载记忆" : "预览")}
      </div>
      {selectedMemory ? (
        <div className="space-y-2">
          <div className="truncate text-base-content/60">
            {selectedMemory.frontmatter.status}
            {selectedMemory.frontmatter.tags.length > 0
              ? ` · ${selectedMemory.frontmatter.tags.join(", ")}`
              : ""}
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-base-content/75">
            {preview}
          </pre>
        </div>
      ) : (
        <div className="text-base-content/60">
          {loading
            ? "加载中"
            : selectedMemoryId
              ? "正在准备预览"
              : "选择一条长期记忆查看正文"}
        </div>
      )}
    </div>
  );
}

function previewBody(body: string) {
  const maxChars = 4000;
  if (body.length <= maxChars) {
    return body;
  }
  return `${body.slice(0, maxChars)}\n\n...`;
}

function ListPanel({
  title,
  loading,
  empty,
  onRefresh,
  children,
}: {
  title: string;
  loading: boolean;
  empty: string;
  onRefresh: () => Promise<void>;
  children: ReactNode;
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);

  return (
    <div className="space-y-2 border border-base-300 bg-base-200/60 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="truncate font-medium text-base-content">{title}</div>
        <TextControlButton onClick={() => void onRefresh()} disabled={loading}>
          刷新
        </TextControlButton>
      </div>
      <div className="max-h-72 overflow-auto pr-1">
        {loading ? (
          <div className="text-base-content/60">加载中</div>
        ) : hasChildren ? (
          children
        ) : (
          <div className="text-base-content/60">{empty}</div>
        )}
      </div>
    </div>
  );
}
