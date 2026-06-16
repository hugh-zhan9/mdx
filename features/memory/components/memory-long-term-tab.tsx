import type { ReactNode } from "react";
import { TextControlButton } from "../../../common/components/ui-controls";
import type { MemorySummary } from "../lib/types";

interface MemoryLongTermTabProps {
  memories: MemorySummary[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onArchive: (target: string) => Promise<void>;
  isActionPending: (key: string) => boolean;
}

export function MemoryLongTermTab({
  memories,
  loading,
  onRefresh,
  onArchive,
  isActionPending,
}: MemoryLongTermTabProps) {
  return (
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
              <div
                className="truncate font-medium text-base-content"
                title={memory.title}
              >
                {memory.title}
              </div>
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
  );
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
