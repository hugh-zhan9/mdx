// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRenderErrorBoundary } from "./app-shell";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

function ThrowRender(): never {
  throw new Error("render failed");
}
