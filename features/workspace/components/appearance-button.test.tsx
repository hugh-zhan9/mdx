// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppearanceButton } from "./appearance-button";
import { BUILT_IN_THEMES } from "../lib/themes";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Hoisted, because a `vi.mock` factory runs before this file's own initialisers:
 * a spy declared as a plain const is not there yet when the module under test
 * imports what it replaces.
 */
const spies = vi.hoisted(() => ({
  setPreference: vi.fn(),
  refresh: vi.fn(async () => {}),
  saveThemeDraft: vi.fn(async () => "/Users/x/.loam/themes/theme.css"),
  revealUserThemesDir: vi.fn(async () => "/Users/x/.loam/themes"),
}));

vi.mock("../lib/theme-preference", async (importOriginal) => ({
  // Only the hook is replaced. The rest is data and pure functions the list
  // reads, and stubbing those would be a second definition of what a preference
  // means.
  ...(await importOriginal<typeof import("../lib/theme-preference")>()),
  useThemePreference: () => ({
    preference: "paper",
    resolvedTheme: "paper",
    setPreference: spies.setPreference,
  }),
}));

vi.mock("../lib/use-user-themes", () => ({
  useUserThemes: () => ({
    entries: [],
    directoryError: null,
    loading: false,
    refresh: spies.refresh,
  }),
}));

vi.mock("../lib/theme-designer", async (importOriginal) => ({
  // The two that would reach the filesystem. Everything else — the field list,
  // the file name rule, the CSS writer — is the real thing, so this test fails
  // if the panel stops offering what a theme is made of.
  ...(await importOriginal<typeof import("../lib/theme-designer")>()),
  saveThemeDraft: spies.saveThemeDraft,
  revealUserThemesDir: spies.revealUserThemesDir,
}));

describe("AppearanceButton", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<AppearanceButton />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.documentElement.removeAttribute("data-mdx-appearance");
    vi.clearAllMocks();
  });

  /** Every button on the page, panel included: the panel is a portal-less overlay. */
  function buttons(): HTMLButtonElement[] {
    return Array.from(document.body.querySelectorAll("button"));
  }

  function press(label: string) {
    const button = buttons().find((candidate) =>
      (candidate.textContent ?? "").includes(label),
    );

    if (!button) {
      throw new Error(`no button says ${label}`);
    }

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  /**
   * Types into a controlled input.
   *
   * Through the prototype's own setter, because React remembers the last value
   * it wrote and treats a direct assignment as no change at all — the field
   * would keep its default and the test would pass on the wrong theme.
   */
  function typeInto(input: HTMLInputElement | null | undefined, value: string) {
    if (!input) {
      throw new Error("no input to type into");
    }

    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;

    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function panel(): HTMLElement | null {
    return document.body.querySelector('[role="dialog"][aria-label="外观"]');
  }

  function open() {
    const trigger = buttons().find(
      (candidate) => candidate.getAttribute("aria-label") === "外观",
    );

    if (!trigger) {
      throw new Error("no appearance button");
    }

    act(() => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("is a button on the title bar and nothing else until pressed", () => {
    expect(buttons()).toHaveLength(1);
    expect(panel()).toBeNull();

    open();

    expect(panel()).not.toBeNull();
  });

  it("offers every theme the product ships", () => {
    // The list is built from the registry, so a theme added there appears here
    // without this file being touched — and one that stops appearing fails here.
    open();

    const text = panel()?.textContent ?? "";

    for (const theme of BUILT_IN_THEMES) {
      expect(text).toContain(theme.name);
    }
    expect(text).toContain("跟随系统");
  });

  it("chooses the theme that was pressed", () => {
    open();

    press("曜石");

    expect(spies.setPreference).toHaveBeenCalledWith("obsidian");
  });

  it("starts a new theme from the one on screen", () => {
    // A blank canvas of ten colours is a worse offer than an edit of something
    // that already works.
    document.documentElement.dataset.mdxAppearance = "dark";
    open();

    press("新建");

    const inputs = Array.from(
      panel()?.querySelectorAll<HTMLInputElement>('input[type="color"]') ?? [],
    );
    expect(inputs).toHaveLength(10);
    expect(inputs.every((input) => /^#[0-9a-f]{6}$/.test(input.value))).toBe(
      true,
    );
    // The ground it starts on is the one the window is already standing on.
    expect(panel()?.textContent).toContain("保存为 ~/.loam/themes/我的主题.css");
  });

  it("saves a theme and then wears it", async () => {
    // Saving without selecting would leave the user unable to see what they made.
    open();
    press("新建");

    typeInto(
      panel()?.querySelector<HTMLInputElement>('input[type="text"]'),
      "暖沙",
    );
    press("保存并使用");
    await act(async () => {});

    expect(spies.saveThemeDraft).toHaveBeenCalledTimes(1);
    expect(spies.saveThemeDraft.mock.calls[0][0]).toMatchObject({ name: "暖沙" });
    // Reloaded before selecting, so the palette is on the page when the
    // preference names it.
    expect(spies.refresh).toHaveBeenCalled();
    expect(spies.setPreference).toHaveBeenCalledWith("user:暖沙");
  });

  it("says why a theme with no name was not saved", async () => {
    open();
    press("新建");

    typeInto(
      panel()?.querySelector<HTMLInputElement>('input[type="text"]'),
      "   ",
    );
    press("保存并使用");
    await act(async () => {});

    expect(spies.saveThemeDraft).not.toHaveBeenCalled();
    expect(panel()?.textContent).toContain("主题名称不能为空");
  });

  it("opens the directory the files live in", () => {
    // Which is the other half of supporting themes people write by hand: the
    // path is no use if it has to be retyped.
    open();

    press("文件夹");

    expect(spies.revealUserThemesDir).toHaveBeenCalledTimes(1);
  });
});
