"use client";

import { useEffect, useRef, useState } from "react";
import {
  detectLlmWikiWorkspace,
  getLlmWikiConfig,
  getLlmWikiLog,
  getLlmConfig,
  saveLlmConfig,
  updateLlmWikiConfig,
} from "@/features/llm-wiki/lib/llm-wiki-client";
import type { LlmWikiKnowledgeConfig } from "@/features/llm-wiki/lib/types";
import type { LlmProviderApiMode } from "@/features/llm-wiki/lib/types";
import { TextControlButton } from "../../../common/components/ui-controls";
import type { AppPreferences } from "../lib/types";
import {
  useThemePreference,
  type ThemePreference,
} from "../lib/theme-preference";

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
      <TextControlButton onClick={() => setOpen(true)}>
        设置
      </TextControlButton>
      {actualOpen ? (
        <SettingsDialog
          onClose={() => setOpen(false)}
          workspaceRoot={workspaceRoot ?? null}
          preferences={preferences ?? DEFAULT_APP_PREFERENCES}
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
  const { preference, setPreference } = useThemePreference();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("general");
  const sectionRefs = useRef<Record<SettingsSection, HTMLElement | null>>({
    general: null,
    llm: null,
  });
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [apiMode, setApiMode] = useState<LlmProviderApiMode>("chat");
  const [apiKey, setApiKey] = useState("");
  const [hasExistingApiKey, setHasExistingApiKey] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [excludeDirsText, setExcludeDirsText] = useState(
    preferences.fileTreeExcludeDirs.join("\n"),
  );
  const [llmWikiConfig, setLlmWikiConfig] =
    useState<LlmWikiKnowledgeConfig | null>(null);
  const [llmWikiLog, setLlmWikiLog] = useState("");
  const [loadingLlmWiki, setLoadingLlmWiki] = useState(false);

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
    setExcludeDirsText(preferences.fileTreeExcludeDirs.join("\n"));
  }, [preferences]);

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

      if (!stringListsEqual(nextExcludeDirs, preferences.fileTreeExcludeDirs)) {
        await onPreferencesChange?.({
          fileTreeExcludeDirs: nextExcludeDirs,
        });
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
  const selectSection = (section: SettingsSection) => {
    setActiveSection(section);
    sectionRefs.current[section]?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 py-14 backdrop-blur-sm"
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
        className="grid w-[min(92vw,880px)] min-w-[min(92vw,560px)] grid-cols-[clamp(112px,18vw,150px)_minmax(0,1fr)] overflow-hidden border border-base-300 bg-base-100 shadow-2xl"
      >
        <aside className="border-r border-base-300 bg-base-200 px-3 py-4">
          <h2 className="px-2 text-sm font-semibold">设置</h2>
          <div className="mt-4 space-y-1">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={[
                  "block w-full px-2 py-1.5 text-left text-xs",
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

        <div className="min-w-0">
          <header className="flex h-12 items-center justify-between border-b border-base-300 px-5">
            <div className="text-sm font-medium">设置</div>
            <div className="flex items-center gap-2">
              {message ? (
                <div className="max-w-64 truncate text-xs text-error">
                  {message}
                </div>
              ) : null}
              <button
                type="button"
                className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content"
                onClick={onClose}
              >
                关闭
              </button>
              <button
                type="button"
                className="h-8 bg-base-content px-3 text-xs text-base-100 disabled:bg-base-content/30"
                onClick={() => void saveSettings()}
                disabled={
                  loadingConfig ||
                  savingSettings ||
                  !baseUrl.trim() ||
                  !model.trim()
                }
              >
                {savingSettings ? "保存中" : "保存"}
              </button>
            </div>
          </header>

          <div className="max-h-[70vh] space-y-7 overflow-auto px-[clamp(16px,3vw,28px)] py-5">
            <section
              ref={(node) => {
                sectionRefs.current.general = node;
              }}
              className="scroll-mt-5 grid grid-cols-[clamp(64px,12vw,96px)_minmax(0,1fr)] gap-x-5 gap-y-2"
            >
              <h3 className="pt-2 text-xs font-medium text-base-content/70">
                外观
              </h3>
              <div className="grid grid-cols-3 gap-1 bg-base-200 p-1">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={[
                      "h-8 text-xs",
                      preference === option.value
                        ? "bg-base-100 text-base-content shadow-sm"
                        : "text-base-content/60 hover:text-base-content",
                    ].join(" ")}
                    onClick={() => setPreference(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-[clamp(64px,12vw,96px)_minmax(0,1fr)] gap-x-5 gap-y-2">
              <h3 className="pt-2 text-xs font-medium text-base-content/70">
                过滤项目
              </h3>
              <div className="space-y-2">
                <textarea
                  className="min-h-24 w-full resize-y border border-base-300 bg-base-100 px-2.5 py-2 text-sm text-base-content outline-none placeholder:text-base-content/65 focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                  value={excludeDirsText}
                  onChange={(event) => setExcludeDirsText(event.currentTarget.value)}
                  placeholder={"每行一个目录，例如：\nnode_modules\ndist\nraw/archive"}
                  disabled={savingSettings}
                />
              </div>
            </section>

            <section
              ref={(node) => {
                sectionRefs.current.llm = node;
              }}
              className="scroll-mt-5 grid grid-cols-[clamp(64px,12vw,96px)_minmax(0,1fr)] gap-x-5 gap-y-2"
            >
              <h3 className="pt-2 text-xs font-medium text-base-content/70">
                LLM API
              </h3>
              <div className="space-y-3">
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>Base URL</span>
                  <input
                    className="h-9 w-full border border-base-300 bg-base-100 px-2.5 text-sm text-base-content outline-none focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.currentTarget.value)}
                    disabled={loadingConfig || savingSettings}
                  />
                </label>
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>Model</span>
                  <input
                    className="h-9 w-full border border-base-300 bg-base-100 px-2.5 text-sm text-base-content outline-none focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                    value={model}
                    onChange={(event) => setModel(event.currentTarget.value)}
                    disabled={loadingConfig || savingSettings}
                  />
                </label>
                <div className="space-y-1.5 text-xs text-base-content/70">
                  <span>API 模式</span>
                  <div className="grid grid-cols-2 gap-1 bg-base-200 p-1">
                    {LLM_API_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={[
                          "h-8 text-xs",
                          apiMode === option.value
                            ? "bg-base-100 text-base-content shadow-sm"
                            : "text-base-content/60 hover:text-base-content",
                        ].join(" ")}
                        onClick={() => setApiMode(option.value)}
                        disabled={loadingConfig || savingSettings}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>API Key</span>
                  <input
                    className="h-9 w-full border border-base-300 bg-base-100 px-2.5 text-sm text-base-content outline-none placeholder:text-base-content/65 focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
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
                <div className="border-t border-base-300 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-base-content/70">
                      LLM Wiki 后台处理
                    </div>
                    <button
                      type="button"
                      className="h-8 bg-base-content px-3 text-xs text-base-100 disabled:bg-base-content/30"
                      onClick={() => void toggleLlmWiki()}
                      disabled={!workspaceRoot || !llmWikiConfig || loadingLlmWiki}
                    >
                      {llmWikiConfig?.paused ? "启用" : "暂停"}
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-xs text-base-content/70">日志</div>
                    <button
                      type="button"
                      className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content disabled:text-base-content/30"
                      onClick={() => void refreshLlmWikiLog()}
                      disabled={!workspaceRoot || loadingLlmWiki}
                    >
                      刷新
                    </button>
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border border-base-300 bg-base-200 p-2 font-sans text-xs leading-relaxed text-base-content/75">
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

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const LLM_API_MODE_OPTIONS: Array<{
  value: LlmProviderApiMode;
  label: string;
}> = [
  { value: "chat", label: "Chat" },
  { value: "responses", label: "Responses" },
];

const DEFAULT_APP_PREFERENCES: AppPreferences = {
  fileTreeExcludeDirs: [],
};

type SettingsSection = "general" | "llm";

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "general", label: "通用" },
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

function stringListsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item === right[index]);
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
