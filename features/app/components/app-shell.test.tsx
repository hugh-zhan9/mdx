// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRenderErrorBoundary, AppShell } from "./app-shell";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.fn();

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({
    invoke,
  }),
}));

vi.mock("@/features/document/components/document-app", () => ({
  DocumentApp: () => <main data-testid="document-app">文档</main>,
}));

vi.mock("@/features/document/components/document-error", () => ({
  DocumentError: () => <main data-testid="document-error">文档错误</main>,
}));

vi.mock("@/features/workspace/components/workspace-app", () => ({
  WorkspaceApp: () => <main data-testid="workspace-app">工作区</main>,
}));

describe("AppRenderErrorBoundary", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    consoleError.mockRestore();
  });

  it("renders a visible fallback instead of leaving the app blank", async () => {
    await act(async () => {
      root.render(
        <AppRenderErrorBoundary resetKey="workspace">
          <ThrowRender />
        </AppRenderErrorBoundary>,
      );
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "MDX 渲染失败",
    );
  });

  it("resets after the window session changes", async () => {
    await act(async () => {
      root.render(
        <AppRenderErrorBoundary resetKey="workspace">
          <ThrowRender />
        </AppRenderErrorBoundary>,
      );
    });
    await act(async () => {
      root.render(
        <AppRenderErrorBoundary resetKey="document:/tmp/a.md">
          <main>文档已打开</main>
        </AppRenderErrorBoundary>,
      );
    });

    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("文档已打开");
  });
});

describe("AppShell chrome root", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("adds workspace shell markers for the default browser session", async () => {
    await act(async () => {
      root.render(<AppShell />);
      await flushPromises();
    });

    const shell = host.querySelector("[data-mdx-shell]");
    expect(shell).not.toBeNull();
    expect(shell?.getAttribute("data-mdx-window-kind")).toBe("workspace");
    expect(shell?.getAttribute("data-mdx-platform")).toMatch(/^(macos|other)$/);
    expect(host.querySelector("[data-testid='workspace-app']")).not.toBeNull();
  });

  it("adds document shell markers for a Tauri document session", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockResolvedValueOnce({
      kind: "document",
      fileName: "note.md",
      displayPath: "/tmp/note.md",
      realPath: "/tmp/note.md",
    });

    await act(async () => {
      root.render(<AppShell />);
      await flushPromises();
    });

    const shell = host.querySelector("[data-mdx-shell]");
    expect(invoke).toHaveBeenCalledWith("get_window_session");
    expect(shell).not.toBeNull();
    expect(shell?.getAttribute("data-mdx-window-kind")).toBe("document");
    expect(host.querySelector("[data-testid='document-app']")).not.toBeNull();
  });
});

function ThrowRender(): never {
  throw new Error("render failed");
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
