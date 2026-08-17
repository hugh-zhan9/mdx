import type { ReactNode } from "react";
import {
  Card,
  TextControlButton,
} from "../../../common/components/ui-controls";
import type { MemoryThreadRecord, ThreadListItem } from "../lib/types";

interface MemorySessionsTabProps {
  sessions: ThreadListItem[];
  selectedThread: MemoryThreadRecord | null;
  selectedThreadId: string | null;
  loading: boolean;
  threadLoading: boolean;
  onRefresh: () => Promise<void>;
  onSelect: (threadId: string) => void;
  onPromote: () => Promise<void>;
  isActionPending: (key: string) => boolean;
}

export function MemorySessionsTab({
  sessions,
  selectedThread,
  selectedThreadId,
  loading,
  threadLoading,
  onRefresh,
  onSelect,
  onPromote,
  isActionPending,
}: MemorySessionsTabProps) {
  return (
    <div className="space-y-3">
      <ListPanel
        title="会话"
        loading={loading}
        empty="暂无会话"
        onRefresh={onRefresh}
      >
        {sessions.map((thread) => (
          <button
            key={thread.thread_id}
            type="button"
            className={[
              "block w-full border-t border-[var(--mdx-separator)] py-2 text-left outline-none first:border-t-0 first:pt-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
              selectedThreadId === thread.thread_id
                ? "text-base-content"
                : "text-base-content/75",
            ].join(" ")}
            onClick={() => onSelect(thread.thread_id)}
          >
            <div className="truncate font-medium" title={thread.title}>
              {thread.title}
            </div>
            <div className="mt-1 truncate text-base-content/60">
              {thread.source} · {formatThreadMessageCount(thread.message_count)}
            </div>
          </button>
        ))}
      </ListPanel>
      {selectedThreadId ? (
        <Card className="space-y-2">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0 truncate font-medium text-base-content">
              {selectedThread?.frontmatter.title ?? selectedThreadId}
            </div>
            <TextControlButton
              onClick={() => void onPromote()}
              disabled={
                threadLoading ||
                Boolean(
                  selectedThreadId &&
                    isActionPending(`promote:${selectedThreadId}`),
                )
              }
            >
              {selectedThreadId && isActionPending(`promote:${selectedThreadId}`)
                ? "提升中"
                : "提升"}
            </TextControlButton>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-base-content/75">
            {threadLoading ? "加载中..." : previewBody(selectedThread?.body ?? "")}
          </pre>
        </Card>
      ) : null}
    </div>
  );
}

function formatThreadMessageCount(messageCount: number | null) {
  return messageCount === null ? "消息数未知" : `${messageCount} 条消息`;
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
    <Card className="space-y-2">
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
    </Card>
  );
}
