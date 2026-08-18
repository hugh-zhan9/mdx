// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsButton } from "./settings-button";
import type { AppPreferences } from "../lib/types";
import { setWorkspaceConfig } from "@/features/memory/lib/memory-client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/llm-wiki/lib/llm-wiki-client", () => ({
  detectLlmWikiWorkspace: vi.fn(async () => ({ hasLlmWiki: false })),
  getLlmWikiConfig: vi.fn(),
  getLlmWikiLog: vi.fn(),
  getLlmConfig: vi.fn(async () => null),
  saveLlmConfig: vi.fn(async () => ({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiMode: "chat",
    hasApiKey: false,
  })),
  updateLlmWikiConfig: vi.fn(),
}));

const defaultMemoryConfig = {
  version: 3,
  enabled: true,
  capture: { enabled: false, sources: [] as string[] },
  agents: {
    claude: { enabled: false },
    codex: { enabled: false },
    cursor: { enabled: false },
  },
};

vi.mock("@/features/memory/lib/memory-client", () => ({
  getWorkspaceConfig: vi.fn(async () => defaultMemoryConfig),
  setWorkspaceConfig: vi.fn(async (_rootPath: string, config: unknown) => config),
}));

vi.mock("../lib/theme-preference", async (importOriginal) => ({
  // Only the hook is replaced: the rest of the module is plain data and pure
  // functions the theme list reads, and a stub of those would be a second
  // definition of what a preference means.
  ...(await importOriginal<typeof import("../lib/theme-preference")>()),
  useThemePreference: () => ({
    preference: "system",
    resolvedTheme: "light",
    setPreference: vi.fn(),
  }),
}));

describe("SettingsButton", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("renders the save action with the primary button treatment", async () => {
    await renderSettings(root);

    const saveButton = getButton("保存");

    expect(saveButton.className).toContain("bg-primary");
    expect(saveButton.className).toContain("text-primary-content");
    expect(saveButton.className).not.toContain("bg-base-content");
  });

  it("scrolls the content pane instead of calling section scrollIntoView", async () => {
    await renderSettings(root);

    const scrollContainer = host.querySelector<HTMLElement>(
      "[data-settings-scroll-container]",
    );
    const llmSection = host.querySelector<HTMLElement>(
      '[data-settings-section="llm"]',
    );

    if (!scrollContainer || !llmSection) {
      throw new Error("Expected settings sections to be rendered.");
    }

    Object.defineProperty(scrollContainer, "offsetTop", {
      configurable: true,
      value: 40,
    });
    Object.defineProperty(llmSection, "offsetTop", {
      configurable: true,
      value: 420,
    });
    scrollContainer.scrollTo = vi.fn();
    llmSection.scrollIntoView = vi.fn();

    await act(async () => {
      getButton("LLM").click();
      await flushPromises();
    });

    expect(llmSection.scrollIntoView).not.toHaveBeenCalled();
    expect(scrollContainer.scrollTo).toHaveBeenCalledWith({
      top: 380,
      behavior: "smooth",
    });
  });

  it("lets the settings content pane own vertical scrolling", async () => {
    await renderSettings(root);

    const scrollContainer = host.querySelector<HTMLElement>(
      "[data-settings-scroll-container]",
    );

    expect(scrollContainer?.className).toContain("min-h-0");
    expect(scrollContainer?.className).toContain("flex-1");
    expect(scrollContainer?.className).toContain("overflow-y-auto");
  });

  it("constrains the settings dialog to the viewport so the content pane can scroll", async () => {
    await renderSettings(root);

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');

    expect(dialog?.className).toContain("min-h-0");
    expect(dialog?.className).toContain(
      "h-[min(680px,78dvh,calc(100dvh-2rem))]",
    );
    expect(dialog?.className).not.toContain("max-h-[calc(100vh-7rem)]");
  });

  it("offers capture as an opt-in with no source chosen", async () => {
    await renderSettings(root, { workspaceRoot: "/tmp/ws" });

    expect(host.textContent).toContain("自动捕获 agent 会话");
    // The warning is the point: capture cannot be undone after the fact.
    expect(host.textContent).toContain("不能撤回");
    const claude = Array.from(host.querySelectorAll("input[type='checkbox']"))
      .map((input) => input as HTMLInputElement)
      .find((input) => input.parentElement?.textContent?.includes("Claude Code"));
    expect(claude?.checked).toBe(false);
    expect(claude?.disabled).toBe(true);
  });

  it("writes the capture switch back to the workspace configuration", async () => {
    await renderSettings(root, { workspaceRoot: "/tmp/ws" });

    const toggle = Array.from(host.querySelectorAll("input[type='checkbox']"))
      .map((input) => input as HTMLInputElement)
      .find((input) =>
        input.parentElement?.textContent?.includes("自动捕获 agent 会话"),
      );

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(setWorkspaceConfig).toHaveBeenCalledWith(
      "/tmp/ws",
      expect.objectContaining({
        capture: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it("no longer offers a storage backend to migrate between", async () => {
    await renderSettings(root, { workspaceRoot: "/tmp/ws" });

    for (const gone of ["迁移预检", "开始迁移", "PostgreSQL"]) {
      expect(host.textContent).not.toContain(gone);
    }
  });
});

async function renderSettings(
  root: ReturnType<typeof createRoot>,
  options: { workspaceRoot?: string } = {},
) {
  await act(async () => {
    root.render(
      <SettingsButton
        open={true}
        onOpenChange={vi.fn()}
        workspaceRoot={options.workspaceRoot}
        preferences={preferences}
        onPreferencesChange={vi.fn()}
      />,
    );
    await flushPromises();
  });
}

function getButton(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );

  if (!button) {
    throw new Error(`Expected button "${label}"`);
  }

  return button as HTMLButtonElement;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const preferences: AppPreferences = {
  fileTreeExcludeDirs: [],
  fileWatchEnabled: true,
  searchMaxFileBytes: 1048576,
  searchMaxResults: 100,
  searchMaxMatchesPerFile: 20,
};

