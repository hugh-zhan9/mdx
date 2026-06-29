"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconButton,
  PanelHeader,
  TextControlButton,
} from "../../../common/components/ui-controls";
import { useMemoryWorkspace } from "../hooks/use-memory-workspace";
import {
  acceptMemoryInbox,
  addMemory,
  appendWorkingMemory,
  archiveMemory,
  getMemoryBackendStatus,
  getMemoryIntegrationStatus,
  getMemory,
  getMemoryThread,
  getWorkingMemory,
  listMemories,
  listMemoryInbox,
  listMemoryThreads,
  promoteMemory,
  rebuildMemoryIndex,
  rejectMemoryInbox,
  repairMemoryIntegration,
  repairMemoryWorkspace,
  setWorkingMemory,
  setupMemoryAgents,
} from "../lib/memory-client";
import { formatMemoryError } from "../lib/memory-error";
import type { MemoryPanelTabId } from "../lib/memory-panel-state";
import type {
  InboxRecord,
  MemoryBackendStatus,
  MemoryDoctorReport,
  MemoryIndexStatus,
  MemoryIntegrationStatus,
  MemoryRepairResult,
  MemoryRecord,
  MemorySummary,
  MemoryThreadRecord,
  ThreadListItem,
} from "../lib/types";
import { MemoryDiagnosticsTab } from "./memory-diagnostics-tab";
import { MemoryIntegrationsTab } from "./memory-integrations-tab";
import { MemoryLongTermTab } from "./memory-long-term-tab";
import { MemoryOverviewTab } from "./memory-overview-tab";
import { MemoryPendingTab } from "./memory-pending-tab";
import { MemorySessionsTab } from "./memory-sessions-tab";
import {
  buildWorkingMemoryTitle,
  MemoryWorkingContextTab,
  type WorkingQuickSection,
} from "./memory-working-context-tab";

interface MemoryPanelProps {
  rootPath: string;
}

type GetMemoryThreadFn = (
  rootPath: string,
  target: string,
) => Promise<MemoryThreadRecord>;

type GetMemoryFn = (rootPath: string, target: string) => Promise<MemoryRecord>;

export function MemoryPanel({ rootPath }: MemoryPanelProps) {
  const memory = useMemoryWorkspace(rootPath);
  const activeRootPathRef = useRef(rootPath);
  activeRootPathRef.current = rootPath;
  const mountedRef = useRef(false);
  const backendRequestIdRef = useRef(0);
  const integrationsRequestIdRef = useRef(0);
  const workingRequestIdRef = useRef(0);
  const workingSaveRequestIdRef = useRef(0);
  const memoriesRequestIdRef = useRef(0);
  const inboxRequestIdRef = useRef(0);
  const threadsRequestIdRef = useRef(0);
  const [activeTab, setActiveTab] = useState<MemoryPanelTabId>("overview");
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingActionsRef = useRef<Map<string, symbol>>(new Map());
  const [pendingActions, setPendingActions] = useState<Set<string>>(
    () => new Set(),
  );
  const effectiveTab =
    memory.tabs.find((tab) => tab.id === activeTab)?.disabled === true
      ? "overview"
      : activeTab;

  const [backendStatus, setBackendStatus] =
    useState<MemoryBackendStatus | null>(null);
  const [backendLoaded, setBackendLoaded] = useState(false);
  const [backendLoading, setBackendLoading] = useState(false);

  const [integrations, setIntegrations] = useState<MemoryIntegrationStatus[]>(
    [],
  );
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [diagnosticsReport, setDiagnosticsReport] =
    useState<MemoryDoctorReport | null>(null);

  const [workingText, setWorkingText] = useState("");
  const [workingLoaded, setWorkingLoaded] = useState(false);
  const [workingLoading, setWorkingLoading] = useState(false);
  const [workingSaving, setWorkingSaving] = useState(false);
  const [workingQuickNote, setWorkingQuickNote] = useState("");
  const [workingQuickSection, setWorkingQuickSection] =
    useState<WorkingQuickSection>("Updated");

  const [memories, setMemories] = useState<MemorySummary[]>([]);
  const [memoriesLoaded, setMemoriesLoaded] = useState(false);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<MemoryRecord | null>(
    null,
  );
  const [memoryLoading, setMemoryLoading] = useState(false);
  const memoryRequestIdRef = useRef(0);

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
  const [actionLoading, setActionLoading] = useState(false);
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
    backendRequestIdRef.current += 1;
    integrationsRequestIdRef.current += 1;
    workingRequestIdRef.current += 1;
    workingSaveRequestIdRef.current += 1;
    memoriesRequestIdRef.current += 1;
    memoryRequestIdRef.current += 1;
    inboxRequestIdRef.current += 1;
    threadsRequestIdRef.current += 1;
    setActiveTab("overview");
    setActionError(null);
    setStatusMessage(null);
    setBackendStatus(null);
    setBackendLoaded(false);
    setBackendLoading(false);
    setIntegrations([]);
    setIntegrationsLoaded(false);
    setIntegrationsLoading(false);
    setDiagnosticsReport(null);
    setWorkingText("");
    setWorkingLoaded(false);
    setWorkingLoading(false);
    setWorkingSaving(false);
    setWorkingQuickNote("");
    setWorkingQuickSection("Updated");
    setMemories([]);
    setMemoriesLoaded(false);
    setMemoriesLoading(false);
    setSelectedMemoryId(null);
    setSelectedMemory(null);
    setMemoryLoading(false);
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
    setActionLoading(false);
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

  const refreshBackend = useCallback(async () => {
    if (!rootPath) {
      return;
    }

    const requestRootPath = rootPath;
    const requestId = backendRequestIdRef.current + 1;
    backendRequestIdRef.current = requestId;
    setBackendLoading(true);
    setActionError(null);
    try {
      const status = await getMemoryBackendStatus(requestRootPath);
      if (
        !isCurrentRoot(requestRootPath) ||
        backendRequestIdRef.current !== requestId
      ) {
        return;
      }
      setBackendStatus(status);
      setBackendLoaded(true);
    } catch (error) {
      if (
        isCurrentRoot(requestRootPath) &&
        backendRequestIdRef.current === requestId
      ) {
        setError(error);
      }
    } finally {
      if (
        isCurrentRoot(requestRootPath) &&
        backendRequestIdRef.current === requestId
      ) {
        setBackendLoading(false);
      }
    }
  }, [isCurrentRoot, rootPath, setError]);

  const refreshIntegrations = useCallback(async () => {
    if (!rootPath) {
      return;
    }

    const requestRootPath = rootPath;
    const requestId = integrationsRequestIdRef.current + 1;
    integrationsRequestIdRef.current = requestId;
    setIntegrationsLoading(true);
    setActionError(null);
    try {
      const statuses = await getMemoryIntegrationStatus(requestRootPath);
      if (
        !isCurrentRoot(requestRootPath) ||
        integrationsRequestIdRef.current !== requestId
      ) {
        return;
      }
      setIntegrations(statuses);
      setDiagnosticsReport(reportFromIntegrationStatuses(statuses));
      setIntegrationsLoaded(true);
    } catch (error) {
      if (
        isCurrentRoot(requestRootPath) &&
        integrationsRequestIdRef.current === requestId
      ) {
        setError(error);
      }
    } finally {
      if (
        isCurrentRoot(requestRootPath) &&
        integrationsRequestIdRef.current === requestId
      ) {
        setIntegrationsLoading(false);
      }
    }
  }, [isCurrentRoot, rootPath, setError]);

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
      setSelectedMemoryId((current) =>
        current &&
        nextMemories.some((memoryItem) => memoryItem.memory_id === current)
          ? current
          : null,
      );
      setSelectedMemory((current) =>
        current &&
        nextMemories.some(
          (memoryItem) =>
            memoryItem.memory_id === current.frontmatter.memory_id,
        )
          ? current
          : null,
      );
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
          : null,
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

  const refreshDiagnostics = useCallback(async () => {
    await Promise.all([refreshBackend(), refreshIntegrations()]);
  }, [refreshBackend, refreshIntegrations]);

  useEffect(() => {
    if (effectiveTab === "overview" && !backendLoaded) {
      void refreshBackend();
    }
  }, [backendLoaded, effectiveTab, refreshBackend]);

  useEffect(() => {
    if (effectiveTab === "integrations" && !integrationsLoaded) {
      void refreshIntegrations();
    }
  }, [effectiveTab, integrationsLoaded, refreshIntegrations]);

  useEffect(() => {
    if (effectiveTab === "diagnostics") {
      if (!backendLoaded) {
        void refreshBackend();
      }
      if (!integrationsLoaded) {
        void refreshIntegrations();
      }
    }
  }, [
    backendLoaded,
    effectiveTab,
    integrationsLoaded,
    refreshBackend,
    refreshIntegrations,
  ]);

  useEffect(() => {
    if (effectiveTab === "working" && !workingLoaded) {
      void refreshWorking();
    }
  }, [effectiveTab, refreshWorking, workingLoaded]);

  useEffect(() => {
    if (effectiveTab === "longTerm" && !memoriesLoaded) {
      void refreshMemories();
    }
  }, [effectiveTab, memoriesLoaded, refreshMemories]);

  useEffect(() => {
    if (effectiveTab === "pending" && !inboxLoaded) {
      void refreshInbox();
    }
  }, [effectiveTab, inboxLoaded, refreshInbox]);

  useEffect(() => {
    if (effectiveTab === "sessions" && !threadsLoaded) {
      void refreshThreads();
    }
  }, [effectiveTab, refreshThreads, threadsLoaded]);

  useEffect(() => {
    if (effectiveTab !== "sessions" || !selectedThreadId || !rootPath) {
      return;
    }

    const loadMemoryThread = getMemoryThread as unknown as GetMemoryThreadFn;

    let cancelled = false;
    setThreadLoading(true);
    setActionError(null);
    void (async () => {
      try {
        const thread = await loadMemoryThread(rootPath, selectedThreadId);
        if (!cancelled) {
          setSelectedThread(thread);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setError(error);
        }
      } finally {
        if (!cancelled) {
          setThreadLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveTab, rootPath, selectedThreadId, setError]);

  useEffect(() => {
    if (effectiveTab !== "longTerm" || !selectedMemoryId || !rootPath) {
      return;
    }

    const loadMemory = getMemory as unknown as GetMemoryFn;

    const requestRootPath = rootPath;
    const requestId = memoryRequestIdRef.current + 1;
    memoryRequestIdRef.current = requestId;
    setMemoryLoading(true);
    setActionError(null);
    void (async () => {
      try {
        const memoryRecord = await loadMemory(requestRootPath, selectedMemoryId);
        if (
          isCurrentRoot(requestRootPath) &&
          memoryRequestIdRef.current === requestId
        ) {
          setSelectedMemory(memoryRecord);
        }
      } catch (error: unknown) {
        if (
          isCurrentRoot(requestRootPath) &&
          memoryRequestIdRef.current === requestId
        ) {
          setError(error);
        }
      } finally {
        if (
          isCurrentRoot(requestRootPath) &&
          memoryRequestIdRef.current === requestId
        ) {
          setMemoryLoading(false);
        }
      }
    })();
  }, [effectiveTab, isCurrentRoot, rootPath, selectedMemoryId, setError]);

  const resetLoadedData = useCallback(() => {
    setBackendLoaded(false);
    setIntegrationsLoaded(false);
    setWorkingLoaded(false);
    setMemoriesLoaded(false);
    setInboxLoaded(false);
    setThreadsLoaded(false);
  }, []);

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
      setStatusMessage("工作记忆已保存");
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

  const handleAppendWorking = useCallback(async () => {
    const text = workingQuickNote.trim();
    if (!text) {
      return;
    }

    const requestRootPath = rootPath;
    setWorkingSaving(true);
    setActionError(null);
    try {
      const savedText = await appendWorkingMemory(
        requestRootPath,
        workingQuickSection,
        text,
      );
      if (!isCurrentRoot(requestRootPath)) {
        return;
      }
      setWorkingText(savedText);
      setWorkingLoaded(true);
      setWorkingQuickNote("");
      setStatusMessage("已记到工作记忆");
    } catch (error) {
      if (isCurrentRoot(requestRootPath)) {
        setError(error);
      }
    } finally {
      if (isCurrentRoot(requestRootPath)) {
        setWorkingSaving(false);
      }
    }
  }, [
    isCurrentRoot,
    rootPath,
    setError,
    workingQuickNote,
    workingQuickSection,
  ]);

  const handlePromoteWorkingNote = useCallback(async () => {
    const text = workingQuickNote.trim();
    if (!text) {
      return;
    }

    const requestRootPath = rootPath;
    setWorkingSaving(true);
    setActionError(null);
    try {
      await addMemory(requestRootPath, {
        title: buildWorkingMemoryTitle(workingQuickSection, text),
        body: text,
        tags: ["working-memory"],
      });
      if (!isCurrentRoot(requestRootPath)) {
        return;
      }
      setWorkingQuickNote("");
      setMemoriesLoaded(false);
      void refreshBackend();
      setStatusMessage("已记到长期记忆");
    } catch (error) {
      if (isCurrentRoot(requestRootPath)) {
        setError(error);
      }
    } finally {
      if (isCurrentRoot(requestRootPath)) {
        setWorkingSaving(false);
      }
    }
  }, [
    isCurrentRoot,
    refreshBackend,
    rootPath,
    setError,
    workingQuickNote,
    workingQuickSection,
  ]);

  const handleArchiveMemory = useCallback(
    async (target: string) => {
      await runExclusiveAction(`archive:${target}`, async () => {
        setActionError(null);
        try {
          await archiveMemory(rootPath, target);
          await refreshMemories();
          void refreshBackend();
        } catch (error) {
          setError(error);
        }
      });
    },
    [refreshBackend, refreshMemories, rootPath, runExclusiveAction, setError],
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
          void refreshBackend();
        } catch (error) {
          setError(error);
        }
      });
    },
    [refreshBackend, refreshInbox, rootPath, runExclusiveAction, setError],
  );

  const handleRejectInbox = useCallback(
    async (inboxId: string) => {
      await runExclusiveAction(`inbox:${inboxId}`, async () => {
        setActionError(null);
        try {
          await rejectMemoryInbox(rootPath, inboxId);
          await refreshInbox();
          void refreshBackend();
        } catch (error) {
          setError(error);
        }
      });
    },
    [refreshBackend, refreshInbox, rootPath, runExclusiveAction, setError],
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
        setStatusMessage(`已提升到 ${result.promoted_path}`);
        await refreshThreads();
        setMemoriesLoaded(false);
      } catch (error) {
        setError(error);
      }
    });
  }, [refreshThreads, rootPath, runExclusiveAction, selectedThreadId, setError]);

  const handleInitialize = useCallback(async () => {
    await memory.initialize();
    resetLoadedData();
    void refreshBackend();
  }, [memory, refreshBackend, resetLoadedData]);

  const handleRepairWorkspace = useCallback(async () => {
    setActionLoading(true);
    setActionError(null);
    setRepairResult(null);
    try {
      const result = await repairMemoryWorkspace(rootPath, {
        rebuild_index: false,
      });
      setRepairResult(result);
      await memory.refresh();
      resetLoadedData();
      void refreshBackend();
    } catch (error) {
      setError(error);
    } finally {
      setActionLoading(false);
    }
  }, [memory, refreshBackend, resetLoadedData, rootPath, setError]);

  const handleRebuildIndex = useCallback(async () => {
    setActionLoading(true);
    setActionError(null);
    setIndexStatus(null);
    try {
      setIndexStatus(await rebuildMemoryIndex(rootPath));
      await memory.refresh();
      setBackendLoaded(false);
      void refreshBackend();
    } catch (error) {
      setError(error);
    } finally {
      setActionLoading(false);
    }
  }, [memory, refreshBackend, rootPath, setError]);

  const handleSetupAgents = useCallback(async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await setupMemoryAgents(rootPath, {
        ...agentSetupOptions,
        dry_run: false,
      });
      setStatusMessage(
        `智能体集成已配置（${result.changed_paths.length} 个文件）`,
      );
      await refreshIntegrations();
      void refreshBackend();
    } catch (error) {
      setError(error);
    } finally {
      setActionLoading(false);
    }
  }, [agentSetupOptions, refreshBackend, refreshIntegrations, rootPath, setError]);

  const handleRepairIntegration = useCallback(
    async (agent: string) => {
      setActionLoading(true);
      setActionError(null);
      try {
        const report = await repairMemoryIntegration(rootPath, agent);
        setDiagnosticsReport(report);
        setStatusMessage(`${formatAgentName(agent)} 集成已修复`);
        await refreshIntegrations();
        void refreshBackend();
      } catch (error) {
        setError(error);
      } finally {
        setActionLoading(false);
      }
    },
    [refreshBackend, refreshIntegrations, rootPath, setError],
  );

  return (
    <section className="flex h-full min-h-0 flex-col border-t border-base-300 bg-base-100">
      <PanelHeader
        title="记忆"
        actions={
          <IconButton
            label="刷新记忆状态"
            icon={
              <RefreshCw
                className={
                  memory.loading || backendLoading ? "animate-spin" : undefined
                }
              />
            }
            onClick={() => {
              void memory.refresh();
              void refreshBackend();
            }}
            disabled={memory.loading || backendLoading}
          />
        }
      />

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-xs">
        <div className="grid grid-cols-2 gap-1 bg-base-200 p-1 sm:grid-cols-4">
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
            actionLabel="重试"
            onAction={memory.refresh}
          />
        ) : null}
        {actionError ? (
          <ErrorBlock
            message={actionError}
            actionLabel="关闭"
            onAction={() => setActionError(null)}
          />
        ) : null}
        {statusMessage ? (
          <div className="border border-base-300 bg-base-200/60 p-2 text-base-content/70">
            {statusMessage}
          </div>
        ) : null}

        {effectiveTab === "overview" ? (
          <MemoryOverviewTab
            status={backendStatus}
            loading={backendLoading}
            hasMemory={memory.hasMemory}
            canInitialize={memory.viewState?.canInitialize ?? false}
            initializing={memory.loading}
            onInitialize={handleInitialize}
            onRefresh={refreshBackend}
          />
        ) : effectiveTab === "integrations" ? (
          <MemoryIntegrationsTab
            statuses={integrations}
            loading={integrationsLoading}
            actionLoading={actionLoading}
            agentSetupOptions={agentSetupOptions}
            onAgentSetupOptionsChange={setAgentSetupOptions}
            onRefresh={refreshIntegrations}
            onSetupAgents={handleSetupAgents}
            onRepair={handleRepairIntegration}
          />
        ) : effectiveTab === "sessions" ? (
          <MemorySessionsTab
            sessions={threads}
            selectedThread={selectedThread}
            selectedThreadId={selectedThreadId}
            loading={threadsLoading}
            threadLoading={threadLoading}
            onRefresh={refreshThreads}
            onSelect={setSelectedThreadId}
            onPromote={handlePromoteThread}
            isActionPending={isActionPending}
          />
        ) : effectiveTab === "longTerm" ? (
          <MemoryLongTermTab
            memories={memories}
            selectedMemory={selectedMemory}
            selectedMemoryId={selectedMemoryId}
            loading={memoriesLoading}
            memoryLoading={memoryLoading}
            onRefresh={refreshMemories}
            onSelect={(memoryId) => {
              setSelectedMemoryId(memoryId);
              setSelectedMemory(null);
            }}
            onArchive={handleArchiveMemory}
            isActionPending={isActionPending}
          />
        ) : effectiveTab === "pending" ? (
          <MemoryPendingTab
            inbox={inbox}
            loading={inboxLoading}
            onRefresh={refreshInbox}
            onAccept={handleAcceptInbox}
            onReject={handleRejectInbox}
            isActionPending={isActionPending}
          />
        ) : effectiveTab === "working" ? (
          <MemoryWorkingContextTab
            text={workingText}
            loading={workingLoading}
            saving={workingSaving}
            quickNote={workingQuickNote}
            quickSection={workingQuickSection}
            onTextChange={setWorkingText}
            onQuickNoteChange={setWorkingQuickNote}
            onQuickSectionChange={setWorkingQuickSection}
            onRefresh={refreshWorking}
            onSave={handleSaveWorking}
            onAppend={handleAppendWorking}
            onPromote={handlePromoteWorkingNote}
          />
        ) : (
          <MemoryDiagnosticsTab
            backendStatus={backendStatus}
            diagnostics={diagnosticsReport}
            indexStatus={indexStatus}
            repairResult={repairResult}
            loading={backendLoading || integrationsLoading}
            actionLoading={actionLoading}
            onRefresh={refreshDiagnostics}
            onRepairWorkspace={handleRepairWorkspace}
            onRebuildIndex={handleRebuildIndex}
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

function reportFromIntegrationStatuses(
  statuses: MemoryIntegrationStatus[],
): MemoryDoctorReport {
  const errors = statuses
    .map((status) => status.last_error)
    .filter((error): error is string => Boolean(error));
  return {
    ok:
      errors.length === 0 &&
      statuses.every((status) => status.doctor_status === "ok"),
    statuses,
    errors,
    warnings: [],
  };
}

function formatAgentName(agent: string) {
  if (agent === "codex") {
    return "Codex";
  }
  if (agent === "claude") {
    return "Claude";
  }
  if (agent === "cursor") {
    return "Cursor";
  }
  return agent;
}
