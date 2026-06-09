"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLatest } from "../../../common/lib/use-latest";
import { draftSave } from "../lib/draft-client";

interface DraftAutosaveInput {
  enabled: boolean;
  realPath: string | null;
  displayPath?: string | null;
  markdown: string | null;
  dirty: boolean;
  baseFingerprint?: string | null;
  mode: "workspace" | "document";
  delayMs?: number;
  onError?: (error: unknown) => void;
}

interface DraftAutosaveHandle {
  flush: () => Promise<void>;
  cancel: () => void;
}

const DEFAULT_DRAFT_AUTOSAVE_DELAY_MS = 1500;

export function useDraftAutosave(
  input: DraftAutosaveInput,
): DraftAutosaveHandle {
  const draftInput = useMemo(
    () => ({
      enabled: input.enabled,
      realPath: input.realPath,
      displayPath: input.displayPath ?? null,
      markdown: input.markdown,
      dirty: input.dirty,
      baseFingerprint: input.baseFingerprint ?? null,
      mode: input.mode,
      onError: input.onError,
    }),
    [
      input.baseFingerprint,
      input.dirty,
      input.displayPath,
      input.enabled,
      input.markdown,
      input.mode,
      input.onError,
      input.realPath,
    ],
  );
  const latestInputRef = useLatest(draftInput);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const saveDraftInput = useCallback(
    async (inputToSave: LatestDraftAutosaveInput) => {
      if (!shouldSaveDraft(inputToSave)) {
        return;
      }

      const savePromise = draftSave({
        realPath: inputToSave.realPath,
        displayPath: inputToSave.displayPath,
        markdown: inputToSave.markdown,
        baseFingerprint: inputToSave.baseFingerprint,
        mode: inputToSave.mode,
      })
        .then(() => undefined)
        .catch((error) => {
          inputToSave.onError?.(error);
        });
      inFlightSaveRef.current = savePromise;

      try {
        await savePromise;
      } finally {
        if (inFlightSaveRef.current === savePromise) {
          inFlightSaveRef.current = null;
        }
      }
    },
    [],
  );

  const flush = useCallback(async () => {
    const inputToFlush = latestInputRef.current;
    cancel();

    const pendingSave = inFlightSaveRef.current;
    if (pendingSave) {
      await pendingSave;
    }

    await saveDraftInput(inputToFlush);
  }, [cancel, latestInputRef, saveDraftInput]);

  useEffect(() => {
    cancel();

    if (!shouldSaveDraft(draftInput)) {
      return;
    }

    const delayMs = input.delayMs ?? DEFAULT_DRAFT_AUTOSAVE_DELAY_MS;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, delayMs);

    return cancel;
  }, [cancel, flush, input.delayMs, draftInput]);

  return useMemo(
    () => ({
      flush,
      cancel,
    }),
    [cancel, flush],
  );
}

function shouldSaveDraft(
  input: LatestDraftAutosaveInput,
): input is LatestDraftAutosaveInput & { realPath: string; markdown: string } {
  return Boolean(
    input.enabled && input.dirty && input.realPath && input.markdown !== null,
  );
}

type LatestDraftAutosaveInput = Omit<
  DraftAutosaveInput,
  "displayPath" | "baseFingerprint" | "delayMs"
> & {
  displayPath: string | null;
  baseFingerprint: string | null;
};
