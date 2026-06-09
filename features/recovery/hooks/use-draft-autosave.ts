"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLatest } from "@/common/lib/use-latest";
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

export function useDraftAutosave(input: DraftAutosaveInput): DraftAutosaveHandle {
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

    const cancel = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const flush = useCallback(async () => {
        cancel();

        const latestInput = latestInputRef.current;
        if (!shouldSaveDraft(latestInput)) {
            return;
        }

        try {
            await draftSave({
                realPath: latestInput.realPath,
                displayPath: latestInput.displayPath,
                markdown: latestInput.markdown,
                baseFingerprint: latestInput.baseFingerprint,
                mode: latestInput.mode,
            });
        } catch (error) {
            latestInput.onError?.(error);
        }
    }, [cancel, latestInputRef]);

    useEffect(() => {
        cancel();

        if (!shouldSaveDraft(draftInput)) {
            return;
        }

        const delayMs = input.delayMs ?? DEFAULT_DRAFT_AUTOSAVE_DELAY_MS;
        timerRef.current = setTimeout(() => {
            void flush();
        }, delayMs);

        return cancel;
    }, [
        cancel,
        flush,
        input.delayMs,
        draftInput,
    ]);

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
        input.enabled &&
            input.dirty &&
            input.realPath &&
            input.markdown !== null,
    );
}

type LatestDraftAutosaveInput = Omit<
    DraftAutosaveInput,
    "displayPath" | "baseFingerprint" | "delayMs"
> & {
    displayPath: string | null;
    baseFingerprint: string | null;
};
