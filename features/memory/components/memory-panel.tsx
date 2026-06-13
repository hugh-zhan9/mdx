"use client";

import { RefreshCw } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  IconButton,
  PanelHeader,
  TextControlButton,
} from "../../../common/components/ui-controls";
import { useMemoryWorkspace } from "../hooks/use-memory-workspace";
import {
  acceptMemoryInbox,
  archiveMemory,
  getMemoryThread,
  getWorkingMemory,
  listMemories,
  listMemoryInbox,
  listMemoryThreads,
  promoteMemory,
  rebuildMemoryIndex,
  recallMemory,
  rejectMemoryInbox,
  repairMemoryWorkspace,
  setWorkingMemory,
  setupMemoryAgents,
} from "../lib/memory-client";
import { formatMemoryError } from "../lib/memory-error";
import type { MemoryPanelTabId } from "../lib/memory-panel-state";
import type {
  InboxRecord,
  MemoryIndexStatus,
  MemoryRepairResult,
  MemorySummary,
  MemoryThreadRecord,
  RecallResult,
  ThreadListItem,
} from "../lib/types";

interface MemoryPanelProps {
  rootPath: string;
}

export function MemoryPanel({ rootPath }: MemoryPanelProps) {
  const memory = useMemoryWorkspace(rootPath);
  const activeRootPathRef = useRef(rootPath);
  activeRootPathRef.current = rootPath;
  const mountedRef = useRef(false);
  const recallRequestIdRef = useRef(0);
  const workingRequestIdRef = useRef(0);
  const workingSaveRequestIdRef = useRef(0);
  const memoriesRequestIdRef = useRef(0);
  const inboxRequestIdRef = useRef(0);
  const threadsRequestIdRef = useRef(0);
  const [activeTab, setActiveTab] = useState<MemoryPanelTabId>("settings");
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingActionsRef = useRef<Map<string, symbol>>(new Map());
  const [pendingActions, setPendingActions] = useState<Set<string>>(
    () => new Set(),
  );
  const effectiveTab =
    memory.tabs.find((tab) => tab.id === activeTab)?.disabled === true
      ? "settings"
      : activeTab;
  const initializeDisabled =
    memory.loading || memory.viewState?.canInitialize === false;

  const [recallQuery, setRecallQuery] = useState("");
  const [recallResult, setRecallResult] = useState<RecallResult | null>(null);
  const [recallLoading, setRecallLoading] = useState(false);

  const [workingText, setWorkingText] = useState("");
  const [workingLoaded, setWorkingLoaded] = useState(false);
  const [workingLoading, setWorkingLoading] = useState(false);
  const [workingSaving, setWorkingSaving] = useState(false);

  const [memories, setMemories] = useState<MemorySummary[]>([]);
  const [memoriesLoaded, setMemoriesLoaded] = useState(false);
  const [memoriesLoading, setMemoriesLoading] = useState(false);

  const [inbox, setInbox] = useState<InboxRecord[]>([]);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);

  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] =
    useState<MemoryThreadRecord | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);

  const [repairResult, setRepairResult] = useState<MemoryRepairResult | null>(
    null,
  );
  const [indexStatus, setIndexStatus] = useState<MemoryIndexStatus | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [agentSetupOptions, setAgentSetupOptions] = useState({
    codex: true,
    claude: true,
    cursor: true,
    hooks: true,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeRootPathRef.current = rootPath;
    recallRequestIdRef.current += 1;
    workingRequestIdRef.current += 1;
    workingSaveRequestIdRef.current += 1;
    memoriesRequestIdRef.current += 1;
    inboxRequestIdRef.current += 1;
    threadsRequestIdRef.current += 1;
    setActionError(null);
    setStatusMessage(null);
    setRecallResult(null);
    setWorkingText("");
    setWorkingLoaded(false);
    setWorkingLoading(false);
    setWorkingSaving(false);
    setMemories([]);
    setMemoriesLoaded(false);
    setMemoriesLoading(false);
    setInbox([]);
    setInboxLoaded(false);
    setInboxLoading(false);
    setThreads([]);
    setThreadsLoaded(false);
    setThreadsLoading(false);
    setSelectedThreadId(null);
    setSelectedThread(null);
    setThreadLoading(false);
    setRepairResult(null);
    setIndexStatus(null);
    setSettingsLoading(false);
    setAgentSetupOptions({
      codex: true,
      claude: true,
      cursor: true,
      hooks: true,
    });
    pendingActionsRef.current = new Map();
    setPendingActions(new Set());
  }, [rootPath]);

  const setError = useCallback((error: unknown) => {
    setActionError(formatMemoryError(error));
  }, []);

  const isCurrentRoot = useCallback(
    (requestRootPath: string) =>
      mountedRef.current && activeRootPathRef.current === requestRootPath,
    [],
  );

  const setActionPending = useCallback((key: string, pending: boolean) => {
    setPendingActions((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const pendingKey = useCallback(
    (key: string) => `${rootPath}:${key}`,
    [rootPath],
  );
  const isActionPending = useCallback(
    (key: string) => pendingActions.has(pendingKey(key)),
    [pendingActions, pendingKey],
  );

  const runExclusiveAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
      const scopedKey = pendingKey(key);
      if (pendingActionsRef.current.has(scopedKey)) {
        return;
      }

      const token = Symbol(scopedKey);
      pendingActionsRef.current.set(scopedKey, token);
      setActionPending(scopedKey, true);
      try {
        await action();
      } finally {
        if (pendingActionsRef.current.get(scopedKey) === token) {
          pendingActionsRef.current.delete(scopedKey);
          setActionPending(scopedKey, false);
        }
      }
    },
    [pendingKey, setActionPending],
  );

  const refreshWorking = useCallback(async () => {
    if (!rootPath || !memory.hasMemory) {
      return;
    }

    const requestRootPath = rootPath;
    const requestId = workingRequestIdRef.current + 1;
    workingRequestIdRef.current = requestId;
    setWorkingLoading(true);
    setActionError(null);
    try {
      const markdown = await getWorkingMemory(requestRootPath);
      if (
        !isCurrentRoot(requestRootPath) ||
        workingRequestIdRef.current !== requestId
      ) {
        return;
      }
      setWorkingText(markdown);
      setWorkingLoaded(true);
    } catch (error) {
      if (
        isCurrentRoot(requestRootPath) &&
        workingRequestIdRef.current === requestId
      ) {
        setError(error);
      }
    } finally {
      if (
        isCurrentRoot(requestRootPath) &&
        workingRequestIdRef.current === requestId
      ) {
        setWorkingLoading(false);
      }
    }
  }, [isCurrentRoot, memory.hasMemory, rootPath, setError]);

  const refreshMemories = useCallback(async () => {
    if (!rootPath || !memory.hasMemory) {
      return;
    }

    const requestRootPath = rootPath;
    const requestId = memoriesRequestIdRef.current + 1;
    memoriesRequestIdRef.current = requestId;
    setMemoriesLoading(true);
    setActionError(null);
    try {
      const nextMemories = await listMemories(requestRootPath, {
        include_archived: false,
      });
      if (
        !isCurrentRoot(requestRootPath) ||
        memoriesRequestIdRef.current !== requestId
      ) {
        return;
      }
      setMemories(nextMemories);
      setMemoriesLoaded(true);
    } catch (error) {
      if (
        isCurrentRoot(requestRootPath) &&
        memoriesRequestIdRef.current === requestId
      ) {
        setError(error);
      }
    } finally {
      if (
        isCurrentRoot(requestRootPath) &&
        memoriesRequestIdRef.current === requestId
      ) {
        setMemoriesLoading(false);
      }
    }
  }, [isCurrentRoot, memory.hasMemory, rootPath, setError]);

  const refreshInbox = useCallback(async () => {
    if (!rootPath || !memory.hasMemory) {
      return;
    }

    const requestRootPath = rootPath;
    const requestId = inboxRequestIdRef.current + 1;
    inboxRequestIdRef.current = requestId;
    setInboxLoading(true);
    setActionError(null);
    try {
      const nextInbox = await listMemoryInbox(requestRootPath, false);
      if (
        !isCurrentRoot(requestRootPath) ||
        inboxRequestIdRef.current !== requestId
      ) {
        return;
      }
      setInbox(nextInbox);
      setInboxLoaded(true);
    } catch (error) {
      if (
        isCurrentRoot(requestRootPath) &&
        inboxRequestIdRef.current === requestId
      ) {
        setError(error);
      }
    } finally {
      if (
        isCurrentRoot(requestRootPath) &&
        inboxRequestIdRef.current === requestId
      ) {
        setInboxLoading(false);
      }
    }
  }, [isCurrentRoot, memory.hasMemory, rootPath, setError]);

  const refreshThreads = useCallback(async () => {
    if (!rootPath || !memory.hasMemory) {
      return;
    }

    const requestRootPath = rootPath;
    const requestId = threadsRequestIdRef.current + 1;
    threadsRequestIdRef.current = requestId;
    setThreadsLoading(true);
    setActionError(null);
    try {
      const items = await listMemoryThreads(requestRootPath, {});
      if (
        !isCurrentRoot(requestRootPath) ||
        threadsRequestIdRef.current !== requestId
      ) {
        return;
      }
      setThreads(items);
      setThreadsLoaded(true);
      setSelectedThreadId((current) =>
        current && items.some((thread) => thread.thread_id === current)
          ? current
          : (items[0]?.thread_id ?? null),
      );
    } catch (error) {
      if (
        isCurrentRoot(requestRootPath) &&
        threadsRequestIdRef.current === requestId
      ) {
        setError(error);
      }
    } finally {
      if (
        isCurrentRoot(requestRootPath) &&
        threadsRequestIdRef.current === requestId
      ) {
        setThreadsLoading(false);
      }
    }
  }, [isCurrentRoot, memory.hasMemory, rootPath, setError]);

  useEffect(() => {
    if (effectiveTab === "working" && !workingLoaded) {
      void refreshWorking();
    }
  }, [effectiveTab, refreshWorking, workingLoaded]);

  useEffect(() => {
    if (effectiveTab === "memories" && !memoriesLoaded) {
      void refreshMemories();
    }
  }, [effectiveTab, memoriesLoaded, refreshMemories]);

  useEffect(() => {
    if (effectiveTab === "inbox" && !inboxLoaded) {
      void refreshInbox();
    }
  }, [effectiveTab, inboxLoaded, refreshInbox]);

  useEffect(() => {
    if (effectiveTab === "threads" && !threadsLoaded) {
      void refreshThreads();
    }
  }, [effectiveTab, refreshThreads, threadsLoaded]);

  useEffect(() => {
    if (effectiveTab !== "threads" || !selectedThreadId || !rootPath) {
      return;
    }

    let cancelled = false;
    setThreadLoading(true);
    setActionError(null);
    void getMemoryThread(rootPath, selectedThreadId)
      .then((thread) => {
        if (!cancelled) {
          setSelectedThread(thread);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setError(error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setThreadLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveTab, rootPath, selectedThreadId, setError]);

  const handleRecall = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const query = recallQuery.trim();
      if (!query) {
        return;
      }

      const requestRootPath = rootPath;
      const requestId = recallRequestIdRef.current + 1;
      recallRequestIdRef.current = requestId;
      setRecallLoading(true);
      setActionError(null);
      try {
        const result = await recallMemory(requestRootPath, {
          query,
          limit: 8,
          byte_budget: 12000,
          include_working: true,
          include_threads: true,
          include_wiki_refs: false,
          include_wiki_snippets: false,
        });
        if (
          !isCurrentRoot(requestRootPath) ||
          recallRequestIdRef.current !== requestId
        ) {
          return;
        }
        setRecallResult(result);
      } catch (error) {
        if (
          isCurrentRoot(requestRootPath) &&
          recallRequestIdRef.current === requestId
        ) {
          setError(error);
        }
      } finally {
        if (
          isCurrentRoot(requestRootPath) &&
          recallRequestIdRef.current === requestId
        ) {
          setRecallLoading(false);
        }
      }
    },
    [isCurrentRoot, recallQuery, rootPath, setError],
  );

  const handleSaveWorking = useCallback(async () => {
    const requestRootPath = rootPath;
    const requestId = workingSaveRequestIdRef.current + 1;
    workingSaveRequestIdRef.current = requestId;
    setWorkingSaving(true);
    setActionError(null);
    try {
      const savedText = await setWorkingMemory(requestRootPath, workingText);
      if (
        !isCurrentRoot(requestRootPath) ||
        workingSaveRequestIdRef.current !== requestId
      ) {
        return;
      }
      setWorkingText(savedText);
      setWorkingLoaded(true);
      setStatusMessage("Working memory saved");
    } catch (error) {
      if (
        isCurrentRoot(requestRootPath) &&
        workingSaveRequestIdRef.current === requestId
      ) {
        setError(error);
      }
    } finally {
      if (
        isCurrentRoot(requestRootPath) &&
        workingSaveRequestIdRef.current === requestId
      ) {
        setWorkingSaving(false);
      }
    }
  }, [isCurrentRoot, rootPath, setError, workingText]);

  const handleArchiveMemory = useCallback(
    async (target: string) => {
      await runExclusiveAction(`archive:${target}`, async () => {
        setActionError(null);
        try {
          await archiveMemory(rootPath, target);
          await refreshMemories();
        } catch (error) {
          setError(error);
        }
      });
    },
    [refreshMemories, rootPath, runExclusiveAction, setError],
  );

  const handleAcceptInbox = useCallback(
    async (entry: InboxRecord) => {
      const inboxId = entry.frontmatter.inbox_id;
      await runExclusiveAction(`inbox:${inboxId}`, async () => {
        setActionError(null);
        try {
          await acceptMemoryInbox(rootPath, {
            inbox_id: inboxId,
            title: entry.frontmatter.title,
            body: entry.body,
            tags: entry.frontmatter.tags,
          });
          await refreshInbox();
          setMemoriesLoaded(false);
        } catch (error) {
          setError(error);
        }
      });
    },
    [refreshInbox, rootPath, runExclusiveAction, setError],
  );

  const handleRejectInbox = useCallback(
    async (inboxId: string) => {
      await runExclusiveAction(`inbox:${inboxId}`, async () => {
        setActionError(null);
        try {
          await rejectMemoryInbox(rootPath, inboxId);
          await refreshInbox();
        } catch (error) {
          setError(error);
        }
      });
    },
    [refreshInbox, rootPath, runExclusiveAction, setError],
  );

  const handlePromoteThread = useCallback(async () => {
    if (!selectedThreadId) {
      return;
    }

    await runExclusiveAction(`promote:${selectedThreadId}`, async () => {
      setActionError(null);
      try {
        const result = await promoteMemory(rootPath, {
          target: selectedThreadId,
          ingest: true,
        });
        setStatusMessage(`Promoted ${result.promoted_path}`);
        await refreshThreads();
        setMemoriesLoaded(false);
      } catch (error) {
        setError(error);
      }
    });
  }, [refreshThreads, rootPath, runExclusiveAction, selectedThreadId, setError]);

  const handleInitialize = useCallback(async () => {
    await memory.initialize();
    setWorkingLoaded(false);
    setMemoriesLoaded(false);
    setInboxLoaded(false);
    setThreadsLoaded(false);
  }, [memory]);

  const handleRepair = useCallback(async () => {
    setSettingsLoading(true);
    setActionError(null);
    setRepairResult(null);
    try {
      const result = await repairMemoryWorkspace(rootPath, {
        rebuild_index: false,
      });
      setRepairResult(result);
      await memory.refresh();
    } catch (error) {
      setError(error);
    } finally {
      setSettingsLoading(false);
    }
  }, [memory, rootPath, setError]);

  const handleRebuildIndex = useCallback(async () => {
    setSettingsLoading(true);
    setActionError(null);
    setIndexStatus(null);
    try {
      setIndexStatus(await rebuildMemoryIndex(rootPath));
      await memory.refresh();
    } catch (error) {
      setError(error);
    } finally {
      setSettingsLoading(false);
    }
  }, [memory, rootPath, setError]);

  const handleSetupAgents = useCallback(async () => {
    setSettingsLoading(true);
    setActionError(null);
    try {
      const result = await setupMemoryAgents(rootPath, {
        ...agentSetupOptions,
        dry_run: false,
      });
      setStatusMessage(
        `Agent integration configured (${result.changed_paths.length} files)`,
      );
    } catch (error) {
      setError(error);
    } finally {
      setSettingsLoading(false);
    }
  }, [agentSetupOptions, rootPath, setError]);

  return (
    <section className="min-h-0 border-t border-base-300 bg-base-100">
      <PanelHeader
        title="Memory"
        actions={
          <IconButton
            label="Refresh memory status"
            icon={
              <RefreshCw className={memory.loading ? "animate-spin" : undefined} />
            }
            onClick={() => void memory.refresh()}
            disabled={memory.loading}
          />
        }
      />

      <div className="space-y-3 overflow-auto p-3 text-xs">
        <div className="grid grid-cols-3 gap-1 bg-base-200 p-1">
          {memory.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={[
                "h-7 truncate px-2 text-xs outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-base-content/40",
                effectiveTab === tab.id
                  ? "bg-base-100 text-base-content shadow-sm"
                  : "text-base-content/70 hover:text-base-content",
              ].join(" ")}
              disabled={tab.disabled}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {memory.error ? (
          <ErrorBlock
            message={memory.error}
            actionLabel="Retry"
            onAction={memory.refresh}
          />
        ) : null}
        {actionError ? (
          <ErrorBlock
            message={actionError}
            actionLabel="Dismiss"
            onAction={() => setActionError(null)}
          />
        ) : null}
        {statusMessage ? (
          <div className="border border-base-300 bg-base-200/60 p-2 text-base-content/70">
            {statusMessage}
          </div>
        ) : null}

        {effectiveTab === "recall" ? (
          <RecallTab
            query={recallQuery}
            result={recallResult}
            loading={recallLoading}
            onQueryChange={setRecallQuery}
            onSubmit={handleRecall}
          />
        ) : effectiveTab === "working" ? (
          <WorkingTab
            text={workingText}
            loading={workingLoading}
            saving={workingSaving}
            onTextChange={setWorkingText}
            onRefresh={refreshWorking}
            onSave={handleSaveWorking}
          />
        ) : effectiveTab === "memories" ? (
          <MemoriesTab
            memories={memories}
            loading={memoriesLoading}
            onRefresh={refreshMemories}
            onArchive={handleArchiveMemory}
            isActionPending={isActionPending}
          />
        ) : effectiveTab === "inbox" ? (
          <InboxTab
            inbox={inbox}
            loading={inboxLoading}
            onRefresh={refreshInbox}
            onAccept={handleAcceptInbox}
            onReject={handleRejectInbox}
            isActionPending={isActionPending}
          />
        ) : effectiveTab === "threads" ? (
          <ThreadsTab
            threads={threads}
            selectedThread={selectedThread}
            selectedThreadId={selectedThreadId}
            loading={threadsLoading}
            threadLoading={threadLoading}
            onRefresh={refreshThreads}
            onSelect={setSelectedThreadId}
            onPromote={handlePromoteThread}
            isActionPending={isActionPending}
          />
        ) : (
          <SettingsTab
            memory={memory}
            initializeDisabled={initializeDisabled}
            settingsLoading={settingsLoading}
            repairResult={repairResult}
            indexStatus={indexStatus}
            onInitialize={handleInitialize}
            onRepair={handleRepair}
            onRebuildIndex={handleRebuildIndex}
            agentSetupOptions={agentSetupOptions}
            onAgentSetupOptionsChange={setAgentSetupOptions}
            onSetupAgents={handleSetupAgents}
          />
        )}
      </div>
    </section>
  );
}

function ErrorBlock({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void | Promise<void>;
}) {
  return (
    <div className="space-y-2 border border-error/40 bg-error/5 p-2 text-error">
      <div className="break-words">{message}</div>
      <TextControlButton
        className="border-error/40 text-error hover:bg-error/10 hover:text-error"
        onClick={() => void onAction()}
      >
        {actionLabel}
      </TextControlButton>
    </div>
  );
}

function RecallTab({
  query,
  result,
  loading,
  onQueryChange,
  onSubmit,
}: {
  query: string;
  result: RecallResult | null;
  loading: boolean;
  onQueryChange: (query: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="space-y-3">
      <form className="flex min-w-0 gap-2" onSubmit={onSubmit}>
        <input
          className="h-8 min-w-0 flex-1 border border-base-300 bg-base-100 px-2 text-xs outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Query memory"
        />
        <button
          type="submit"
          className="h-8 shrink-0 border border-base-content bg-base-content px-3 text-xs text-base-100 outline-none transition-colors hover:bg-base-content/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:border-base-content/30 disabled:bg-base-content/30"
          disabled={loading || query.trim().length === 0}
        >
          {loading ? "Recalling" : "Recall"}
        </button>
      </form>
      {result ? (
        <div className="space-y-3">
          {result.working ? (
            <ResultBlock title="Working" body={result.working} />
          ) : null}
          <SummaryList title="Memories" items={result.memories} />
          <SummaryList title="Threads" items={result.threads} />
          {result.index_degraded || result.warnings.length > 0 ? (
            <div className="space-y-1 border border-warning/40 bg-warning/5 p-2 text-base-content/75">
              {result.index_degraded ? <div>Index degraded</div> : null}
              {result.warnings.map((warning) => (
                <div key={warning} className="break-words">
                  {warning}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkingTab({
  text,
  loading,
  saving,
  onTextChange,
  onRefresh,
  onSave,
}: {
  text: string;
  loading: boolean;
  saving: boolean;
  onTextChange: (text: string) => void;
  onRefresh: () => Promise<void>;
  onSave: () => Promise<void>;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-1">
        <TextControlButton onClick={() => void onRefresh()} disabled={loading}>
          Refresh
        </TextControlButton>
        <TextControlButton onClick={() => void onSave()} disabled={saving}>
          {saving ? "Saving" : "Save"}
        </TextControlButton>
      </div>
      <textarea
        className="min-h-72 w-full resize-y border border-base-300 bg-base-100 p-2 font-mono text-xs leading-relaxed outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        value={loading ? "Loading..." : text}
        disabled={loading}
        onChange={(event) => onTextChange(event.currentTarget.value)}
      />
    </div>
  );
}

function MemoriesTab({
  memories,
  loading,
  onRefresh,
  onArchive,
  isActionPending,
}: {
  memories: MemorySummary[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onArchive: (target: string) => Promise<void>;
  isActionPending: (key: string) => boolean;
}) {
  return (
    <ListPanel
      title="Memories"
      loading={loading}
      empty="No memories"
      onRefresh={onRefresh}
    >
      {memories.map((memory) => (
        <div key={memory.memory_id} className="border-t border-base-300 py-2 first:border-t-0 first:pt-0">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium text-base-content" title={memory.title}>
                {memory.title}
              </div>
              <div className="mt-1 truncate text-base-content/60" title={memory.path}>
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
                ? "Archiving"
                : "Archive"}
            </TextControlButton>
          </div>
        </div>
      ))}
    </ListPanel>
  );
}

function InboxTab({
  inbox,
  loading,
  onRefresh,
  onAccept,
  onReject,
  isActionPending,
}: {
  inbox: InboxRecord[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onAccept: (entry: InboxRecord) => Promise<void>;
  onReject: (inboxId: string) => Promise<void>;
  isActionPending: (key: string) => boolean;
}) {
  return (
    <ListPanel title="Inbox" loading={loading} empty="Inbox empty" onRefresh={onRefresh}>
      {inbox.map((entry) => (
        <div key={entry.frontmatter.inbox_id} className="border-t border-base-300 py-2 first:border-t-0 first:pt-0">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium text-base-content" title={entry.frontmatter.title}>
                {entry.frontmatter.title}
              </div>
              <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-base-content/70">
                {entry.body}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              {(() => {
                const inboxPending = isActionPending(
                  `inbox:${entry.frontmatter.inbox_id}`,
                );
                return (
                  <>
              <TextControlButton
                disabled={inboxPending}
                onClick={() => void onAccept(entry)}
              >
                {inboxPending ? "Working" : "Accept"}
              </TextControlButton>
              <TextControlButton
                className="text-error hover:bg-error/10 hover:text-error"
                disabled={inboxPending}
                onClick={() => void onReject(entry.frontmatter.inbox_id)}
              >
                {inboxPending ? "Working" : "Reject"}
              </TextControlButton>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      ))}
    </ListPanel>
  );
}

function ThreadsTab({
  threads,
  selectedThread,
  selectedThreadId,
  loading,
  threadLoading,
  onRefresh,
  onSelect,
  onPromote,
  isActionPending,
}: {
  threads: ThreadListItem[];
  selectedThread: MemoryThreadRecord | null;
  selectedThreadId: string | null;
  loading: boolean;
  threadLoading: boolean;
  onRefresh: () => Promise<void>;
  onSelect: (threadId: string) => void;
  onPromote: () => Promise<void>;
  isActionPending: (key: string) => boolean;
}) {
  return (
    <div className="space-y-3">
      <ListPanel
        title="Threads"
        loading={loading}
        empty="No threads"
        onRefresh={onRefresh}
      >
        {threads.map((thread) => (
          <button
            key={thread.thread_id}
            type="button"
            className={[
              "block w-full border-t border-base-300 py-2 text-left outline-none first:border-t-0 first:pt-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              selectedThreadId === thread.thread_id ? "text-base-content" : "text-base-content/75",
            ].join(" ")}
            onClick={() => onSelect(thread.thread_id)}
          >
            <div className="truncate font-medium" title={thread.title}>
              {thread.title}
            </div>
            <div className="mt-1 truncate text-base-content/60">
              {thread.source} · {thread.message_count ?? 0} messages
            </div>
          </button>
        ))}
      </ListPanel>
      {selectedThreadId ? (
        <div className="space-y-2 border border-base-300 bg-base-200/60 p-2">
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
                ? "Promoting"
                : "Promote"}
            </TextControlButton>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-base-content/75">
            {threadLoading ? "Loading..." : (selectedThread?.body ?? "")}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function SettingsTab({
  memory,
  initializeDisabled,
  settingsLoading,
  repairResult,
  indexStatus,
  onInitialize,
  onRepair,
  onRebuildIndex,
  agentSetupOptions,
  onAgentSetupOptionsChange,
  onSetupAgents,
}: {
  memory: ReturnType<typeof useMemoryWorkspace>;
  initializeDisabled: boolean;
  settingsLoading: boolean;
  repairResult: MemoryRepairResult | null;
  indexStatus: MemoryIndexStatus | null;
  onInitialize: () => Promise<void>;
  onRepair: () => Promise<void>;
  onRebuildIndex: () => Promise<void>;
  agentSetupOptions: {
    codex: boolean;
    claude: boolean;
    cursor: boolean;
    hooks: boolean;
  };
  onAgentSetupOptionsChange: (options: {
    codex: boolean;
    claude: boolean;
    cursor: boolean;
    hooks: boolean;
  }) => void;
  onSetupAgents: () => Promise<void>;
}) {
  const selectedAgentCount = [
    agentSetupOptions.codex,
    agentSetupOptions.claude,
    agentSetupOptions.cursor,
  ].filter(Boolean).length;
  const setupDisabled =
    settingsLoading || !memory.hasMemory || selectedAgentCount === 0;
  const setAgentOption = (
    key: keyof typeof agentSetupOptions,
    value: boolean,
  ) => {
    onAgentSetupOptionsChange({ ...agentSetupOptions, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1 border border-base-300 bg-base-200/60 p-2 text-base-content/75">
        <StatusLine
          label="Status"
          value={
            memory.loading && !memory.status
              ? "Loading"
              : memory.hasMemory
                ? "Ready"
                : "Not initialized"
          }
        />
        {memory.viewState ? (
          <StatusLine label="Mode" value={memory.viewState.mode} />
        ) : null}
        {indexStatus ? (
          <>
            <StatusLine label="Index" value={indexStatus.index_status} />
            <StatusLine
              label="Documents"
              value={String(indexStatus.document_count)}
            />
          </>
        ) : null}
      </div>

      {!memory.hasMemory ? (
        <button
          type="button"
          className="h-8 w-full border border-base-content bg-base-content px-3 text-xs text-base-100 outline-none transition-colors hover:bg-base-content/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:border-base-content/30 disabled:bg-base-content/30"
          disabled={initializeDisabled}
          onClick={() => void onInitialize()}
        >
          {memory.loading ? "Initializing" : "Initialize Memory"}
        </button>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <TextControlButton disabled={settingsLoading} onClick={() => void onRepair()}>
              {settingsLoading ? "Working" : "Repair"}
            </TextControlButton>
            <TextControlButton disabled={settingsLoading} onClick={() => void onRebuildIndex()}>
              Rebuild Index
            </TextControlButton>
          </div>

          <div className="space-y-2 border border-base-300 bg-base-200/60 p-2">
            <div className="font-medium text-base-content">Agent Integration</div>
            <div className="grid grid-cols-2 gap-2">
              <CheckboxControl
                label="Codex"
                checked={agentSetupOptions.codex}
                disabled={settingsLoading}
                onChange={(checked) => setAgentOption("codex", checked)}
              />
              <CheckboxControl
                label="Claude"
                checked={agentSetupOptions.claude}
                disabled={settingsLoading}
                onChange={(checked) => setAgentOption("claude", checked)}
              />
              <CheckboxControl
                label="Cursor"
                checked={agentSetupOptions.cursor}
                disabled={settingsLoading}
                onChange={(checked) => setAgentOption("cursor", checked)}
              />
              <CheckboxControl
                label="PreCompact hooks"
                checked={agentSetupOptions.hooks}
                disabled={settingsLoading}
                onChange={(checked) => setAgentOption("hooks", checked)}
              />
            </div>
            <TextControlButton
              className="w-full justify-center"
              disabled={setupDisabled}
              onClick={() => void onSetupAgents()}
            >
              {settingsLoading ? "Configuring" : "Configure Agents"}
            </TextControlButton>
          </div>
        </>
      )}

      {repairResult ? (
        <div className="space-y-1 border border-base-300 bg-base-200/60 p-2 text-base-content/70">
          <div>Repaired paths: {repairResult.repaired_paths.length}</div>
          {repairResult.warnings.map((warning) => (
            <div key={warning} className="break-words">
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      {memory.viewState && memory.viewState.missingPaths.length > 0 ? (
        <div className="space-y-1 border border-base-300 bg-base-200/60 p-2 text-base-content/70">
          {memory.viewState.missingPaths.map((path) => (
            <div key={path} className="truncate" title={path}>
              {path}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CheckboxControl({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-base-content/75">
      <input
        type="checkbox"
        className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="truncate">{label}</span>
    </label>
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
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <div className="space-y-2 border border-base-300 bg-base-200/60 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="truncate font-medium text-base-content">{title}</div>
        <TextControlButton onClick={() => void onRefresh()} disabled={loading}>
          Refresh
        </TextControlButton>
      </div>
      <div className="max-h-72 overflow-auto pr-1">
        {loading ? (
          <div className="text-base-content/60">Loading</div>
        ) : hasChildren ? (
          children
        ) : (
          <div className="text-base-content/60">{empty}</div>
        )}
      </div>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="shrink-0 text-base-content/60">{label}</span>
      <span className="min-w-0 truncate text-base-content">{value}</span>
    </div>
  );
}

function ResultBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-1 border border-base-300 bg-base-200/60 p-2">
      <div className="font-medium text-base-content">{title}</div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-base-content/75">
        {body}
      </pre>
    </div>
  );
}

function SummaryList({
  title,
  items,
}: {
  title: string;
  items: Array<{ memory_id?: string; thread_id?: string; title: string; path: string }>;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1 border border-base-300 bg-base-200/60 p-2">
      <div className="font-medium text-base-content">{title}</div>
      {items.map((item) => (
        <div
          key={item.memory_id ?? item.thread_id ?? item.path}
          className="border-t border-base-300 py-1 first:border-t-0"
        >
          <div className="truncate text-base-content" title={item.title}>
            {item.title}
          </div>
          <div className="truncate text-base-content/60" title={item.path}>
            {item.path}
          </div>
        </div>
      ))}
    </div>
  );
}
