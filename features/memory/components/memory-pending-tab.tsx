import type { ReactNode } from "react";
import { TextControlButton } from "../../../common/components/ui-controls";
import type { InboxRecord } from "../lib/types";

interface MemoryPendingTabProps {
  inbox: InboxRecord[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onAccept: (entry: InboxRecord) => Promise<void>;
  onReject: (inboxId: string) => Promise<void>;
  isActionPending: (key: string) => boolean;
}

export function MemoryPendingTab({
  inbox,
  loading,
  onRefresh,
  onAccept,
  onReject,
  isActionPending,
}: MemoryPendingTabProps) {
  return (
    <ListPanel
      title="待确认"
      loading={loading}
      empty="暂无待确认记忆"
      onRefresh={onRefresh}
    >
      {inbox.map((entry) => {
        const inboxPending = isActionPending(
          `inbox:${entry.frontmatter.inbox_id}`,
        );
        return (
          <div
            key={entry.frontmatter.inbox_id}
            className="border-t border-base-300 py-2 first:border-t-0 first:pt-0"
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div
                  className="truncate font-medium text-base-content"
                  title={entry.frontmatter.title}
                >
                  {entry.frontmatter.title}
                </div>
                <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-base-content/70">
                  {entry.body}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <TextControlButton
                  disabled={inboxPending}
                  onClick={() => void onAccept(entry)}
                >
                  {inboxPending ? "处理中" : "接受"}
                </TextControlButton>
                <TextControlButton
                  className="text-error hover:bg-error/10 hover:text-error"
                  disabled={inboxPending}
                  onClick={() => void onReject(entry.frontmatter.inbox_id)}
                >
                  {inboxPending ? "处理中" : "拒绝"}
                </TextControlButton>
              </div>
            </div>
          </div>
        );
      })}
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
