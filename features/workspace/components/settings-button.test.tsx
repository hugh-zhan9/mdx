// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsButton } from "./settings-button";
import type { AppPreferences } from "../lib/types";

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
});

async function renderSettings(root: ReturnType<typeof createRoot>) {
  await act(async () => {
    root.render(
      <SettingsButton
        open={true}
        onOpenChange={vi.fn()}
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
