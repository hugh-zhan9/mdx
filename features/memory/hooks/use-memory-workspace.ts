"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getMemoryStatus } from "../lib/memory-client";
import { formatMemoryError } from "../lib/memory-error";
import {
  buildMemoryPanelTabs,
  type MemoryPanelTab,
} from "../lib/memory-panel-state";
import type { MemoryStatus } from "../lib/types";

export interface MemoryWorkspaceHook {
  status: MemoryStatus | null;
  tabs: MemoryPanelTab[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Whether memory is usable here, and what the panel may therefore show.
 *
 * One request answers all of it: whether this workspace turned memory on, which
 * project it is bound to, whether the library opens, and whether the model is
 * downloaded. A tab that needs any of that is disabled rather than left to fail
 * on its own.
 */
export function useMemoryWorkspace(rootPath: string): MemoryWorkspaceHook {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getMemoryStatus(rootPath));
      setError(null);
    } catch (statusError) {
      setStatus(null);
      setError(formatMemoryError(statusError));
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const next = await getMemoryStatus(rootPath);
        if (!cancelled) {
          setStatus(next);
          setError(null);
        }
      } catch (statusError) {
        if (!cancelled) {
          setStatus(null);
          setError(formatMemoryError(statusError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const tabs = useMemo(
    () => buildMemoryPanelTabs({ enabled: status?.enabled === true }),
    [status?.enabled],
  );

  return { status, tabs, loading, error, refresh };
}
