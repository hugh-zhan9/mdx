// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftAutosave } from "./use-draft-autosave";
import * as draftClient from "../lib/draft-client";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/draft-client", () => ({
  draftSave: vi.fn(),
}));

type DraftAutosaveInput = Parameters<typeof useDraftAutosave>[0];
type DraftAutosaveHandle = ReturnType<typeof useDraftAutosave>;
type HarnessProps = DraftAutosaveInput & {
  captureHandle?: (handle: DraftAutosaveHandle) => void;
};

function Harness({ captureHandle, ...input }: HarnessProps) {
  const handle = useDraftAutosave(input);

  useEffect(() => {
    captureHandle?.(handle);
  }, [captureHandle, handle]);

  return null;
}

describe("useDraftAutosave", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let unmounted: boolean;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    unmounted = false;
    vi.mocked(draftClient.draftSave).mockResolvedValue({
      draftId: "draft-1",
      updatedAt: "2026-06-09T00:00:00.000Z",
    });
  });

  afterEach(() => {
    if (!unmounted) {
      act(() => {
        root.unmount();
      });
    }
    host.remove();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("debounces saves only when enabled, dirty, realPath, and markdown are present", async () => {
    vi.useFakeTimers();

    for (const invalidInput of [
      { enabled: false },
      { dirty: false },
      { realPath: null },
      { markdown: null },
    ] satisfies Array<Partial<DraftAutosaveInput>>) {
      vi.mocked(draftClient.draftSave).mockClear();

      await renderAutosave(root, invalidInput);
      await advanceTimers(100);

      expect(draftClient.draftSave).not.toHaveBeenCalled();
    }

    await renderAutosave(root, { markdown: "" });
    await advanceTimers(99);

    expect(draftClient.draftSave).not.toHaveBeenCalled();

    await advanceTimers(1);

    expect(draftClient.draftSave).toHaveBeenCalledTimes(1);
    expect(draftClient.draftSave).toHaveBeenCalledWith({
      realPath: "/tmp/note.md",
      displayPath: "note.md",
      markdown: "",
      baseFingerprint: "base-fingerprint",
      mode: "workspace",
    });
  });

  it("flush immediately saves the latest values", async () => {
    vi.useFakeTimers();
    let latestHandle: DraftAutosaveHandle | null = null;
    const captureHandle = (handle: DraftAutosaveHandle) => {
      latestHandle = handle;
    };

    await renderAutosave(root, { markdown: "old" }, captureHandle);
    await renderAutosave(
      root,
      {
        realPath: "/tmp/latest.md",
        displayPath: "latest.md",
        markdown: "latest",
        baseFingerprint: "latest-base",
        mode: "document",
      },
      captureHandle,
    );

    await act(async () => {
      await latestHandle?.flush();
    });
    await advanceTimers(100);

    expect(draftClient.draftSave).toHaveBeenCalledTimes(1);
    expect(draftClient.draftSave).toHaveBeenCalledWith({
      realPath: "/tmp/latest.md",
      displayPath: "latest.md",
      markdown: "latest",
      baseFingerprint: "latest-base",
      mode: "document",
    });
  });

  it("flush waits for in-flight saves and uses the call-time snapshot", async () => {
    vi.useFakeTimers();
    let latestHandle: DraftAutosaveHandle | null = null;
    let releaseFirstSave: () => void = () => {};
    const firstSave = new Promise<
      Awaited<ReturnType<typeof draftClient.draftSave>>
    >((resolve) => {
      releaseFirstSave = () =>
        resolve({
          draftId: "draft-1",
          updatedAt: "2026-06-09T00:00:00.000Z",
        });
    });
    vi.mocked(draftClient.draftSave)
      .mockReturnValueOnce(firstSave)
      .mockResolvedValue({
        draftId: "draft-2",
        updatedAt: "2026-06-09T00:00:01.000Z",
      });

    await renderAutosave(
      root,
      {
        realPath: "/tmp/old.md",
        displayPath: "old.md",
        markdown: "old",
      },
      (handle) => {
        latestHandle = handle;
      },
    );
    await advanceTimers(100);

    expect(draftClient.draftSave).toHaveBeenCalledTimes(1);

    let flushSettled = false;
    const flushPromise = latestHandle!.flush().then(() => {
      flushSettled = true;
    });

    await Promise.resolve();

    expect(flushSettled).toBe(false);

    await renderAutosave(
      root,
      {
        realPath: "/tmp/new.md",
        displayPath: "new.md",
        markdown: "new",
      },
      (handle) => {
        latestHandle = handle;
      },
    );

    releaseFirstSave();

    await act(async () => {
      await flushPromise;
    });

    expect(flushSettled).toBe(true);
    expect(draftClient.draftSave).toHaveBeenCalledTimes(2);
    expect(draftClient.draftSave).toHaveBeenNthCalledWith(2, {
      realPath: "/tmp/old.md",
      displayPath: "old.md",
      markdown: "old",
      baseFingerprint: "base-fingerprint",
      mode: "workspace",
    });
  });

  it("cancel prevents a pending save", async () => {
    vi.useFakeTimers();
    let latestHandle: DraftAutosaveHandle | null = null;

    await renderAutosave(root, {}, (handle) => {
      latestHandle = handle;
    });

    act(() => {
      latestHandle?.cancel();
    });
    await advanceTimers(100);

    expect(draftClient.draftSave).not.toHaveBeenCalled();
  });

  it("cleans up a pending save on unmount", async () => {
    vi.useFakeTimers();

    await renderAutosave(root);

    act(() => {
      root.unmount();
      unmounted = true;
    });
    await advanceTimers(100);

    expect(draftClient.draftSave).not.toHaveBeenCalled();
  });

  it("calls onError when the draft save rejects", async () => {
    vi.useFakeTimers();
    const error = new Error("save failed");
    const onError = vi.fn();
    vi.mocked(draftClient.draftSave).mockRejectedValueOnce(error);

    await renderAutosave(root, { onError });
    await advanceTimers(100);
    await act(async () => {});

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });
});

function defaultInput(): DraftAutosaveInput {
  return {
    enabled: true,
    realPath: "/tmp/note.md",
    displayPath: "note.md",
    markdown: "markdown",
    dirty: true,
    baseFingerprint: "base-fingerprint",
    mode: "workspace",
    delayMs: 100,
  };
}

async function renderAutosave(
  root: ReturnType<typeof createRoot>,
  overrides: Partial<DraftAutosaveInput> = {},
  captureHandle?: (handle: DraftAutosaveHandle) => void,
) {
  await act(async () => {
    root.render(
      createElement(Harness, {
        ...defaultInput(),
        ...overrides,
        captureHandle,
      }),
    );
  });
}

async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
