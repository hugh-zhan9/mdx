"use client";

import { RefreshCw, Save, Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  detectLlmWikiWorkspace,
  getLlmWikiConfig,
  getLlmWikiLog,
  getLlmConfig,
  saveLlmConfig,
  updateLlmWikiConfig,
} from "@/features/llm-wiki/lib/llm-wiki-client";
import { MemorySettingsSection } from "@/features/memory/components/memory-settings-section";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "@/features/memory/lib/memory-client";
import type { WorkspaceMemoryConfig } from "@/features/memory/lib/types";
import type { LlmWikiKnowledgeConfig } from "@/features/llm-wiki/lib/types";
import type { LlmProviderApiMode } from "@/features/llm-wiki/lib/types";
import {
  IconButton,
  PrimaryTextControlButton,
  SegmentedControl,
  TextControlButton,
} from "../../../common/components/ui-controls";
import type { AppPreferences } from "../lib/types";
import {
  appPreferencesEqual,
  createDefaultAppPreferences,
  parsePositiveIntegerSetting,
} from "../lib/preferences";

interface SettingsButtonProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  workspaceRoot?: string | null;
  preferences?: AppPreferences;
  onPreferencesChange?: (preferences: AppPreferences) => Promise<void>;
  onLlmConfigSaved?: () => Promise<void> | void;
}

export function SettingsButton({
  open,
  onOpenChange,
  workspaceRoot,
  preferences,
  onPreferencesChange,
  onLlmConfigSaved,
}: SettingsButtonProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const actualOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <>
      <IconButton
        onClick={() => setOpen(true)}
        label="设置"
        icon={<Settings />}
      />
      {actualOpen ? (
        <SettingsDialog
          onClose={() => setOpen(false)}
          workspaceRoot={workspaceRoot ?? null}
          preferences={preferences ?? createDefaultAppPreferences()}
          onPreferencesChange={onPreferencesChange}
          onLlmConfigSaved={onLlmConfigSaved}
        />
      ) : null}
    </>
  );
}

function SettingsDialog({
  onClose,
  workspaceRoot,
  preferences,
  onPreferencesChange,
  onLlmConfigSaved,
}: {
  onClose: () => void;
  workspaceRoot: string | null;
  preferences: AppPreferences;
  onPreferencesChange?: (preferences: AppPreferences) => Promise<void>;
  onLlmConfigSaved?: () => Promise<void> | void;
}) {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("search");
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<SettingsSection, HTMLElement | null>>({
    search: null,
    files: null,
    memory: null,
    llm: null,
  });
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [apiMode, setApiMode] = useState<LlmProviderApiMode>("chat");
  const [apiKey, setApiKey] = useState("");
  const [hasExistingApiKey, setHasExistingApiKey] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingMemorySettings, setSavingMemorySettings] = useState(false);
  const [memoryConfig, setMemoryConfigState] = useState<WorkspaceMemoryConfig | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [fileWatchEnabled, setFileWatchEnabled] = useState(
    preferences.fileWatchEnabled,
  );
  const [searchMaxFileBytesText, setSearchMaxFileBytesText] = useState(
    String(preferences.searchMaxFileBytes),
  );
  const [searchMaxResultsText, setSearchMaxResultsText] = useState(
    String(preferences.searchMaxResults),
  );
  const [searchMaxMatchesPerFileText, setSearchMaxMatchesPerFileText] =
    useState(String(preferences.searchMaxMatchesPerFile));
  const [excludeDirsText, setExcludeDirsText] = useState(
    preferences.fileTreeExcludeDirs.join("\n"),
  );
  const [llmWikiConfig, setLlmWikiConfig] =
    useState<LlmWikiKnowledgeConfig | null>(null);
  const [llmWikiLog, setLlmWikiLog] = useState("");
  const [loadingLlmWiki, setLoadingLlmWiki] = useState(false);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timer = window.setTimeout(() => {
      setMessage(null);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingConfig(true);
      setMessage(null);

      try {
        const config = await getLlmConfig();

        if (cancelled) {
          return;
        }

        if (config) {
          setBaseUrl(config.baseUrl);
          setModel(config.model);
          setApiMode(config.apiMode);
          setHasExistingApiKey(config.hasApiKey);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(formatError(error, "加载 LLM 配置失败。"));
        }
      } finally {
        if (!cancelled) {
          setLoadingConfig(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setFileWatchEnabled(preferences.fileWatchEnabled);
    setSearchMaxFileBytesText(String(preferences.searchMaxFileBytes));
    setSearchMaxResultsText(String(preferences.searchMaxResults));
    setSearchMaxMatchesPerFileText(
      String(preferences.searchMaxMatchesPerFile),
    );
    setExcludeDirsText(preferences.fileTreeExcludeDirs.join("\n"));
  }, [preferences]);

  // The memory section only needs this workspace's capture settings; the
  // library itself is global and has its own panel.
  useEffect(() => {
    if (!workspaceRoot) {
      setMemoryConfigState(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const config = await getWorkspaceConfig(workspaceRoot);
        if (!cancelled) {
          setMemoryConfigState(config);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(formatError(error, "加载记忆设置失败。"));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) {
      setLlmWikiConfig(null);
      setLlmWikiLog("");
      return;
    }

    let cancelled = false;

    async function loadLlmWikiSettings() {
      setLoadingLlmWiki(true);

      try {
        const status = await detectLlmWikiWorkspace(workspaceRoot as string);

        if (!status.hasLlmWiki) {
          if (!cancelled) {
            setLlmWikiConfig(null);
            setLlmWikiLog("");
          }
          return;
        }

        const [config, log] = await Promise.all([
          getLlmWikiConfig(workspaceRoot as string),
          getLlmWikiLog(workspaceRoot as string),
        ]);

        if (!cancelled) {
          setLlmWikiConfig(config);
          setLlmWikiLog(log);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(formatError(error, "加载 LLM Wiki 设置失败。"));
        }
      } finally {
        if (!cancelled) {
          setLoadingLlmWiki(false);
        }
      }
    }

    void loadLlmWikiSettings();

    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  const saveSettings = async () => {
    setSavingSettings(true);
    setMessage(null);

    try {
      const nextExcludeDirs = parseExcludeDirs(excludeDirsText);
      const nextPreferences = {
        fileTreeExcludeDirs: nextExcludeDirs,
        fileWatchEnabled,
        searchMaxFileBytes: parsePositiveIntegerSetting(
          searchMaxFileBytesText,
          1_024,
          50 * 1_024 * 1_024,
          preferences.searchMaxFileBytes,
        ),
        searchMaxResults: parsePositiveIntegerSetting(
          searchMaxResultsText,
          1,
          5_000,
          preferences.searchMaxResults,
        ),
        searchMaxMatchesPerFile: parsePositiveIntegerSetting(
          searchMaxMatchesPerFileText,
          1,
          500,
          preferences.searchMaxMatchesPerFile,
        ),
      };

      if (!appPreferencesEqual(nextPreferences, preferences)) {
        await onPreferencesChange?.(nextPreferences);
      }

      const saved = await saveLlmConfig({
        baseUrl,
        model,
        apiMode,
        apiKey,
        preserveApiKey: hasExistingApiKey && apiKey.trim() === "",
      });
      setHasExistingApiKey(saved.hasApiKey);
      setApiKey("");
      setBaseUrl(saved.baseUrl);
      setModel(saved.model);
      setApiMode(saved.apiMode);
      await onLlmConfigSaved?.();
      onClose();
    } catch (error) {
      setMessage(formatError(error, "保存设置失败。"));
    } finally {
      setSavingSettings(false);
    }
  };
  const toggleLlmWiki = async () => {
    if (!workspaceRoot || !llmWikiConfig) {
      return;
    }

    setLoadingLlmWiki(true);
    setMessage(null);

    try {
      const nextConfig = await updateLlmWikiConfig(workspaceRoot, {
        paused: !llmWikiConfig.paused,
        skipPaths: llmWikiConfig.skipPaths,
      });
      setLlmWikiConfig(nextConfig);
      await onLlmConfigSaved?.();
    } catch (error) {
      setMessage(formatError(error, "保存 LLM Wiki 开关失败。"));
    } finally {
      setLoadingLlmWiki(false);
    }
  };
  const refreshLlmWikiLog = async () => {
    if (!workspaceRoot) {
      return;
    }

    setLoadingLlmWiki(true);
    setMessage(null);

    try {
      setLlmWikiLog(await getLlmWikiLog(workspaceRoot));
    } catch (error) {
      setMessage(formatError(error, "刷新 LLM Wiki 日志失败。"));
    } finally {
      setLoadingLlmWiki(false);
    }
  };
  /// Applies one change to this workspace's capture settings.
  ///
  /// Read, change, write: the configuration is small and the panel is the only
  /// writer, so a merge that could lose a concurrent edit is not worth building.
  const updateMemoryCapture = async (
    change: (capture: { enabled: boolean; sources: string[] }) => {
      enabled: boolean;
      sources: string[];
    },
  ) => {
    if (!workspaceRoot) {
      setMessage("打开工作区后可以修改记忆设置。");
      return;
    }

    setSavingMemorySettings(true);
    setMessage(null);

    try {
      const current = await getWorkspaceConfig(workspaceRoot);
      const next = await setWorkspaceConfig(workspaceRoot, {
        ...current,
        capture: change(current.capture),
      });
      setMemoryConfigState(next);
    } catch (error) {
      setMessage(formatError(error, "保存记忆设置失败。"));
    } finally {
      setSavingMemorySettings(false);
    }
  };


  const selectSection = (section: SettingsSection) => {
    setActiveSection(section);
    const container = contentScrollRef.current;
    const target = sectionRefs.current[section];

    if (!container || !target) {
      return;
    }

    container.scrollTo({
      top: target.offsetTop - container.offsetTop,
      behavior: "smooth",
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 py-14 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        // Rounded and softly shadowed, the way macOS draws a panel. A square
        // sheet with a hard border and a heavy drop shadow reads as a web modal
        // dropped on top of the app; the hairline is inside the shadow rather
        // than a border of its own, so the corner stays clean.
        className="grid h-[min(680px,78dvh,calc(100dvh-2rem))] min-h-0 w-[min(90vw,840px)] min-w-0 grid-cols-[minmax(104px,152px)_minmax(0,1fr)] overflow-hidden rounded-xl bg-base-100 shadow-[var(--mdx-panel-shadow)]"
      >
        <aside className="min-h-0 min-w-0 overflow-auto border-r border-[var(--mdx-separator)] bg-base-200 px-3 py-4">
          <h2 className="px-2 text-sm font-semibold">设置</h2>
          <div className="mt-4 space-y-1">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={[
                  "block w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  activeSection === section.id
                    ? "bg-base-100 font-medium text-base-content"
                    : "text-base-content/70 hover:bg-base-100/70 hover:text-base-content",
                ].join(" ")}
                onClick={() => selectSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 min-h-0 flex-col">
          <header className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--mdx-separator)] px-5 py-3">
            <div className="min-w-0 text-sm font-medium">设置</div>
            <div className="flex min-w-0 shrink-0 items-center gap-2">
              {message ? (
                <div className="max-w-64 truncate text-xs text-error">
                  {message}
                </div>
              ) : null}
              <TextControlButton onClick={onClose}>
                <X aria-hidden="true" />
                关闭
              </TextControlButton>
              <PrimaryTextControlButton
                onClick={() => void saveSettings()}
                disabled={
                  loadingConfig ||
                  savingSettings ||
                  !baseUrl.trim() ||
                  !model.trim()
                }
              >
                <Save aria-hidden="true" />
                {savingSettings ? "保存中" : "保存"}
              </PrimaryTextControlButton>
            </div>
          </header>

          <div
            ref={contentScrollRef}
            data-settings-scroll-container
            className="min-h-0 flex-1 space-y-7 overflow-y-auto overflow-x-hidden px-[clamp(16px,3vw,28px)] py-5"
          >
            <section
              ref={(node) => {
                sectionRefs.current.search = node;
              }}
              data-settings-section="search"
              className="scroll-mt-5 grid grid-cols-[clamp(64px,12vw,96px)_minmax(0,1fr)] gap-x-5 gap-y-2"
            >
              <h3 className="pt-2 text-xs font-medium text-base-content/70">
                搜索限制
              </h3>
              <div className="space-y-3">
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>单文件最大搜索大小（字节）</span>
                  <input
                    className="h-9 w-full rounded-md border border-base-content/12 bg-base-100 px-2.5 text-sm text-base-content outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                    value={searchMaxFileBytesText}
                    inputMode="numeric"
                    onChange={(event) =>
                      setSearchMaxFileBytesText(event.currentTarget.value)
                    }
                    disabled={savingSettings}
                  />
                </label>
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>最大结果数</span>
                  <input
                    className="h-9 w-full rounded-md border border-base-content/12 bg-base-100 px-2.5 text-sm text-base-content outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                    value={searchMaxResultsText}
                    inputMode="numeric"
                    onChange={(event) =>
                      setSearchMaxResultsText(event.currentTarget.value)
                    }
                    disabled={savingSettings}
                  />
                </label>
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>每个文件最大匹配数</span>
                  <input
                    className="h-9 w-full rounded-md border border-base-content/12 bg-base-100 px-2.5 text-sm text-base-content outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                    value={searchMaxMatchesPerFileText}
                    inputMode="numeric"
                    onChange={(event) =>
                      setSearchMaxMatchesPerFileText(event.currentTarget.value)
                    }
                    disabled={savingSettings}
                  />
                </label>
              </div>
            </section>

            <section
              ref={(node) => {
                sectionRefs.current.files = node;
              }}
              data-settings-section="files"
              className="scroll-mt-5 grid grid-cols-[clamp(64px,12vw,96px)_minmax(0,1fr)] gap-x-5 gap-y-2"
            >
              <h3 className="pt-2 text-xs font-medium text-base-content/70">
                文件监听
              </h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3 text-sm text-base-content">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded-sm border border-base-content/20 bg-base-100"
                    checked={fileWatchEnabled}
                    onChange={(event) =>
                      setFileWatchEnabled(event.currentTarget.checked)
                    }
                    disabled={savingSettings}
                  />
                  <span>启用工作区文件监听</span>
                </label>
                <p className="text-xs leading-relaxed text-base-content/65">
                  未保存正文会以明文草稿保存在 ~/.loam/drafts/，保存或丢弃后会清理对应草稿。
                </p>
                <div className="border-t border-[var(--mdx-separator)] pt-3">
                  <div className="mb-2 text-xs text-base-content/70">
                    过滤项目
                  </div>
                  <textarea
                    className="min-h-24 w-full resize-y rounded-md border border-base-content/12 bg-base-100 px-2.5 py-2 text-sm text-base-content outline-none transition-colors placeholder:text-base-content/45 focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                    value={excludeDirsText}
                    onChange={(event) =>
                      setExcludeDirsText(event.currentTarget.value)
                    }
                    placeholder={"每行一个目录，例如：\nnode_modules\ndist\nraw/archive"}
                    disabled={savingSettings}
                  />
                </div>
              </div>
            </section>

            <MemorySettingsSection
              sectionRef={(node) => {
                sectionRefs.current.memory = node;
              }}
              disabled={!workspaceRoot || savingMemorySettings}
              config={memoryConfig}
              onToggleCapture={(enabled) => {
                void updateMemoryCapture((capture) => ({
                  ...capture,
                  enabled,
                }));
              }}
              onToggleSource={(source, enabled) => {
                void updateMemoryCapture((capture) => ({
                  ...capture,
                  sources: enabled
                    ? [...capture.sources, source]
                    : capture.sources.filter((current) => current !== source),
                }));
              }}
            />

            <section
              ref={(node) => {
                sectionRefs.current.llm = node;
              }}
              data-settings-section="llm"
              className="scroll-mt-5 grid grid-cols-[clamp(64px,12vw,96px)_minmax(0,1fr)] gap-x-5 gap-y-2"
            >
              <h3 className="pt-2 text-xs font-medium text-base-content/70">
                LLM API
              </h3>
              <div className="space-y-3">
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>Base URL</span>
                  <input
                    className="h-9 w-full rounded-md border border-base-content/12 bg-base-100 px-2.5 text-sm text-base-content outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.currentTarget.value)}
                    disabled={loadingConfig || savingSettings}
                  />
                </label>
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>Model</span>
                  <input
                    className="h-9 w-full rounded-md border border-base-content/12 bg-base-100 px-2.5 text-sm text-base-content outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                    value={model}
                    onChange={(event) => setModel(event.currentTarget.value)}
                    disabled={loadingConfig || savingSettings}
                  />
                </label>
                <div className="space-y-1.5 text-xs text-base-content/70">
                  <span>API 模式</span>
                  <SegmentedControl
                    label="API 模式"
                    fill
                    value={apiMode}
                    options={LLM_API_MODE_OPTIONS}
                    onChange={setApiMode}
                    disabled={loadingConfig || savingSettings}
                  />
                </div>
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>API Key</span>
                  <input
                    className="h-9 w-full rounded-md border border-base-content/12 bg-base-100 px-2.5 text-sm text-base-content outline-none transition-colors placeholder:text-base-content/45 focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                    value={apiKey}
                    type="password"
                    placeholder={
                      hasExistingApiKey
                        ? "已配置，留空则保留"
                        : "请输入 API Key"
                    }
                    onChange={(event) => setApiKey(event.currentTarget.value)}
                    disabled={loadingConfig || savingSettings}
                  />
                </label>
                <div className="border-t border-[var(--mdx-separator)] pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-base-content/70">
                      LLM Wiki 后台处理
                    </div>
                    <TextControlButton
                      className="h-8 px-3"
                      onClick={() => void toggleLlmWiki()}
                      disabled={!workspaceRoot || !llmWikiConfig || loadingLlmWiki}
                    >
                      {llmWikiConfig?.paused ? "启用" : "暂停"}
                    </TextControlButton>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-xs text-base-content/70">日志</div>
                    <TextControlButton
                      onClick={() => void refreshLlmWikiLog()}
                      disabled={!workspaceRoot || loadingLlmWiki}
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={loadingLlmWiki ? "animate-spin" : undefined}
                      />
                      刷新
                    </TextControlButton>
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-base-200 p-2.5 font-[inherit] text-xs leading-relaxed text-base-content/75">
                    {workspaceRoot
                      ? llmWikiLog || "暂无日志"
                      : "打开工作区后显示 LLM Wiki 日志"}
                  </pre>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

const LLM_API_MODE_OPTIONS: Array<{
  value: LlmProviderApiMode;
  label: string;
}> = [
  { value: "chat", label: "Chat" },
  { value: "responses", label: "Responses" },
];

/**
 * Appearance is not here: it lives on the title bar, where the window it changes
 * is in view. See `appearance-button.tsx`.
 */
type SettingsSection = "search" | "files" | "memory" | "llm";

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "search", label: "搜索" },
  { id: "files", label: "文件" },
  { id: "memory", label: "Memory" },
  { id: "llm", label: "LLM" },
];

function parseExcludeDirs(text: string) {
  return Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.replaceAll("\\", "/").trim())
        .map((line) => line.replace(/^\/+|\/+$/g, ""))
        .filter((line) => line.length > 0)
        .filter(
          (line) =>
            !line
              .split("/")
              .some((part) => part === "." || part === ".."),
        ),
    ),
  );
}

function formatError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return `${fallback} ${error.message}`;
  }

  if (typeof error === "string" && error.length > 0) {
    return `${fallback} ${error}`;
  }

  if (error && typeof error === "object") {
    if (
      "message" in error &&
      typeof error.message === "string" &&
      error.message.length > 0
    ) {
      return `${fallback} ${error.message}`;
    }

    if (
      "error" in error &&
      typeof error.error === "string" &&
      error.error.length > 0
    ) {
      return `${fallback} ${error.error}`;
    }

    try {
      return `${fallback} ${JSON.stringify(error)}`;
    } catch {
      return `${fallback} ${String(error)}`;
    }
  }

  return fallback;
}
