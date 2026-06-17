// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsButton } from "./settings-button";
import type { AppPreferences } from "../lib/types";
import {
  dryRunMemoryStorageMigration,
  runMemoryStorageMigration,
  updateMemoryConfig,
} from "@/features/memory/lib/memory-client";

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

vi.mock("@/features/memory/lib/memory-client", () => ({
  dryRunMemoryStorageMigration: vi.fn(async () => ({
    migration_id: "migration:1:postgresql",
    from: "sqlite",
    to: "postgresql",
    dry_run: true,
    records_seen: { memories: 2, threads: 1 },
    records_copied: {},
    records_skipped: {},
    validation_errors: [],
    backup_path: null,
    config_switched: false,
  })),
  runMemoryStorageMigration: vi.fn(async () => ({
    migration_id: "migration:1:postgresql",
    from: "sqlite",
    to: "postgresql",
    dry_run: false,
    records_seen: { memories: 2, threads: 1 },
    records_copied: { memories: 2, threads: 1 },
    records_skipped: {},
    validation_errors: [],
    backup_path: null,
    config_switched: true,
  })),
  setMemoryConfig: vi.fn(async () => defaultMemoryConfig),
  updateMemoryConfig: vi.fn(async (_rootPath: string, request: unknown) => ({
    ...defaultMemoryConfig,
    provider:
      typeof request === "object" &&
      request &&
      "provider" in request &&
      request.provider
        ? {
            ...defaultMemoryConfig.provider,
            ...(request.provider as object),
          }
        : defaultMemoryConfig.provider,
    storage:
      typeof request === "object" &&
      request &&
      "storage" in request &&
      request.storage
        ? {
            ...defaultMemoryConfig.storage,
            ...(request.storage as object),
          }
        : defaultMemoryConfig.storage,
  })),
}));

vi.mock("../lib/theme-preference", () => ({
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

  it("renders memory feature hard shutdown controls", async () => {
    await renderSettings(root);

    expect(host.textContent).toContain("Memory");
    expect(host.textContent).toContain("总开关");
    expect(host.textContent).toContain("自动捕获");
    expect(host.textContent).toContain("Recall 注入");
    expect(host.textContent).toContain("自动提取");
    expect(host.textContent).toContain("Markdown 投影");
    expect(host.textContent).toContain("SQLite");
    expect(host.textContent).toContain("PostgreSQL");
  });

  it("saves memory provider changes", async () => {
    await renderSettings(root, { workspaceRoot: "/tmp/ws" });

    await act(async () => {
      getButton("OpenAI").click();
      await flushPromises();
    });

    expect(updateMemoryConfig).toHaveBeenCalledWith("/tmp/ws", {
      scope: "workspace",
      provider: { mode: "provider", provider: "openai" },
    });
  });

  it("runs memory postgres migration dry-run with the configured target", async () => {
    await renderSettings(root, { workspaceRoot: "/tmp/ws" });

    await act(async () => {
      getButton("PostgreSQL").click();
      await flushPromises();
    });

    const input = host.querySelector<HTMLInputElement>(
      'input[placeholder="postgresql://user:password@localhost:5432/mdx"]',
    );
    if (!input) {
      throw new Error("Expected PostgreSQL URL input.");
    }

    await act(async () => {
      setInputValue(input, "postgresql://localhost/mdx");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flushPromises();
    });

    await act(async () => {
      getButton("迁移预检").click();
      await flushPromises();
    });

    expect(dryRunMemoryStorageMigration).toHaveBeenCalledWith("/tmp/ws", {
      from: "sqlite",
      to: "postgresql",
      target: "postgresql://localhost/mdx",
      dry_run: true,
      resume: false,
    });
    expect(host.textContent).toContain("预检：通过");
  });

  it("runs memory postgres migration after a successful dry-run", async () => {
    await renderSettings(root, { workspaceRoot: "/tmp/ws" });

    await act(async () => {
      getButton("PostgreSQL").click();
      await flushPromises();
    });

    const input = host.querySelector<HTMLInputElement>(
      'input[placeholder="postgresql://user:password@localhost:5432/mdx"]',
    );
    if (!input) {
      throw new Error("Expected PostgreSQL URL input.");
    }

    await act(async () => {
      setInputValue(input, "postgresql://localhost/mdx");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flushPromises();
    });

    await act(async () => {
      getButton("迁移预检").click();
      await flushPromises();
    });

    await act(async () => {
      getButton("开始迁移").click();
      await flushPromises();
    });

    expect(runMemoryStorageMigration).toHaveBeenCalledWith("/tmp/ws", {
      from: "sqlite",
      to: "postgresql",
      target: "postgresql://localhost/mdx",
      dry_run: false,
      resume: false,
    });
    expect(host.textContent).toContain("Memory 迁移已完成。");
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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
}

const preferences: AppPreferences = {
  fileTreeExcludeDirs: [],
  fileWatchEnabled: true,
  searchMaxFileBytes: 1048576,
  searchMaxResults: 100,
  searchMaxMatchesPerFile: 20,
};

const defaultMemoryConfig = {
  version: 2,
  memory: { enabled: true },
  agent_backend: {
    enabled: true,
    capture_enabled: false,
    recall_injection_enabled: true,
    distill_enabled: true,
    auto_accept: false,
    context_byte_budget: 4096,
  },
  projection: { enabled: true },
  agents: {
    codex: { enabled: false, paused: false },
    claude: { enabled: false, paused: false },
    cursor: { enabled: false, paused: false },
  },
  storage: {
    backend: "sqlite",
    sqlite_path: null,
    postgres_url_ref: null,
  },
  provider: {
    mode: "reuse_llm",
    provider: null,
    model: null,
  },
};
