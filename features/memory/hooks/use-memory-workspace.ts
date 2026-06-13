"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  detectMemoryWorkspace,
  initializeMemoryWorkspace,
} from "../lib/memory-client";
import { formatMemoryError } from "../lib/memory-error";
import {
  buildMemoryPanelTabs,
  type MemoryPanelTab,
} from "../lib/memory-panel-state";
import type { MemoryMode, MemoryWorkspaceStatus } from "../lib/types";

export interface MemoryWorkspaceViewState {
  mode: MemoryMode;
  hasMemory: boolean;
  canInitialize: boolean;
  missingPaths: string[];
}

export interface MemoryWorkspaceHook {
  status: MemoryWorkspaceStatus | null;
  viewState: MemoryWorkspaceViewState | null;
  hasMemory: boolean;
  tabs: MemoryPanelTab[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  initialize: () => Promise<void>;
}

interface MemoryWorkspaceSnapshot {
  rootPath: string;
  status: MemoryWorkspaceStatus | null;
  loading: boolean;
  error: string | null;
}

export function useMemoryWorkspace(rootPath: string): MemoryWorkspaceHook {
  const activeRootPathRef = useRef(rootPath);
  const requestIdRef = useRef(0);
  const [snapshot, setSnapshot] = useState<MemoryWorkspaceSnapshot>(() =>
    createInitialSnapshot(rootPath),
  );
  const currentSnapshot =
    snapshot.rootPath === rootPath ? snapshot : createInitialSnapshot(rootPath);
  const viewState = useMemo(
    () => toMemoryWorkspaceViewState(currentSnapshot.status),
    [currentSnapshot.status],
  );
  const hasMemory = viewState?.hasMemory ?? false;
  const tabs = useMemo(
    () => buildMemoryPanelTabs({ hasMemory }),
    [hasMemory],
  );

  useEffect(() => {
    activeRootPathRef.current = rootPath;
  }, [rootPath]);

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!rootPath) {
      setSnapshot(createMissingRootSnapshot(rootPath));
      return;
    }

    setSnapshot((current) => ({
      rootPath,
      status: current.rootPath === rootPath ? current.status : null,
      loading: true,
      error: null,
    }));

    try {
      const status = await detectMemoryWorkspace(rootPath);
      if (
        activeRootPathRef.current !== rootPath ||
        requestIdRef.current !== requestId
      ) {
        return;
      }

      setSnapshot({
        rootPath,
        status,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (
        activeRootPathRef.current !== rootPath ||
        requestIdRef.current !== requestId
      ) {
        return;
      }

      setSnapshot((current) => ({
        rootPath,
        status: current.rootPath === rootPath ? current.status : null,
        loading: false,
        error: formatMemoryError(error),
      }));
    }
  }, [rootPath]);

  const initialize = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!rootPath) {
      setSnapshot(createMissingRootSnapshot(rootPath));
      return;
    }

    setSnapshot((current) => ({
      rootPath,
      status: current.rootPath === rootPath ? current.status : null,
      loading: true,
      error: null,
    }));

    try {
      const result = await initializeMemoryWorkspace(rootPath);
      if (
        activeRootPathRef.current !== rootPath ||
        requestIdRef.current !== requestId
      ) {
        return;
      }

      setSnapshot({
        rootPath,
        status: result.status,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (
        activeRootPathRef.current !== rootPath ||
        requestIdRef.current !== requestId
      ) {
        return;
      }

      setSnapshot((current) => ({
        rootPath,
        status: current.rootPath === rootPath ? current.status : null,
        loading: false,
        error: formatMemoryError(error),
      }));
    }
  }, [rootPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    status: currentSnapshot.status,
    viewState,
    hasMemory,
    tabs,
    loading: currentSnapshot.loading,
    error: currentSnapshot.error,
    refresh,
    initialize,
  };
}

function toMemoryWorkspaceViewState(
  status: MemoryWorkspaceStatus | null,
): MemoryWorkspaceViewState | null {
  if (!status) {
    return null;
  }

  return {
    mode: status.mode,
    hasMemory: status.has_memory,
    canInitialize: status.can_initialize,
    missingPaths: status.missing_paths,
  };
}

function createInitialSnapshot(rootPath: string): MemoryWorkspaceSnapshot {
  return rootPath
    ? {
        rootPath,
        status: null,
        loading: true,
        error: null,
      }
    : createMissingRootSnapshot(rootPath);
}

function createMissingRootSnapshot(rootPath: string): MemoryWorkspaceSnapshot {
  return {
    rootPath,
    status: null,
    loading: false,
    error: null,
  };
}
