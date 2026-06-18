// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlPreview } from "./html-preview";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.fn();
const createObjectURL = vi.fn(() => "blob:preview-html");
const revokeObjectURL = vi.fn();

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({ invoke }),
}));

describe("HtmlPreview", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    invoke.mockResolvedValue("<html><body><h1>Rendered</h1></body></html>");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("loads html through the preview text command and renders a locked-down iframe", async () => {
    await renderPreview("/tmp/ws/page.html");

    expect(invoke).toHaveBeenCalledWith("read_preview_text_file", {
      rootPath: "/tmp/ws",
      path: "/tmp/ws/page.html",
    });
    const iframe = host.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("");
    expect(iframe?.getAttribute("src")).toBe("blob:preview-html");
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text/html" }),
    );
  });

  it("shows an mhtml parse error with source fallback", async () => {
    invoke.mockResolvedValueOnce(
      "Content-Type: multipart/related; boundary=abc\n\n--abc--",
    );

    await renderPreview("/tmp/ws/archive.mhtml");

    expect(host.textContent).toContain("解析 MHTML 失败。");
    expect(host.textContent).toContain("显示源码");

    await act(async () => {
      getButton("显示源码").click();
      await flushPromises();
    });

    expect(host.querySelector("pre")?.textContent).toContain(
      "multipart/related",
    );
  });

  it("revokes the generated iframe URL on unmount", async () => {
    await renderPreview("/tmp/ws/page.html");

    await act(async () => {
      root.unmount();
    });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-html");
  });

  async function renderPreview(path: string) {
    await act(async () => {
      root.render(<HtmlPreview rootPath="/tmp/ws" path={path} />);
      await flushPromises();
    });
  }

  function getButton(label: string) {
    const button = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    if (!button) {
      throw new Error(`Expected button "${label}".`);
    }
    return button;
  }
});

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
