"use client";

import { type FormEvent, useCallback, useState } from "react";
import {
  EmptyState,
  IconButton,
  PanelHeader,
  TextControlButton,
} from "../../../common/components/ui-controls";
import type { LlmWikiWorkspaceHook } from "../hooks/use-llm-wiki-workspace";
import type { LlmWikiPanelModeId } from "../lib/types";

interface LlmWikiPanelProps {
  llmWiki: LlmWikiWorkspaceHook;
  onConfigureLlm?: () => void;
}

export function LlmWikiPanel({ llmWiki, onConfigureLlm }: LlmWikiPanelProps) {
  const {
    status,
    viewModel,
    message,
    queryAnswer,
    isReady,
    isLoading,
    isQuerying,
    isProcessing,
    activeOperation,
    activeOperationId,
    activeOperationLabel,
    activeStageLabel,
    cancelActiveOperation,
    initialize,
    rescan,
    lint,
    graph,
    digest,
    query,
    refresh,
  } = llmWiki;
  const [activeMode, setActiveMode] =
    useState<LlmWikiPanelModeId>("status");
  const [question, setQuestion] = useState("");
  const [digestTitle, setDigestTitle] = useState("");
  const [digestPrompt, setDigestPrompt] = useState("");
  const handlePrimaryAction = useCallback(() => {
    if (viewModel.primaryAction === "配置 LLM") {
      onConfigureLlm?.();
      return;
    }

    if (status?.mode === "ordinary") {
      void initialize();
      return;
    }

    void rescan();
  }, [
    initialize,
    onConfigureLlm,
    rescan,
    status?.mode,
    viewModel.primaryAction,
  ]);

  const handleConfigure = useCallback(() => {
    onConfigureLlm?.();
  }, [onConfigureLlm]);

  const handleQuerySubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void query(question);
    },
    [query, question],
  );

  const handleDigestSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void digest(digestTitle, digestPrompt);
    },
    [digest, digestPrompt, digestTitle],
  );

  const panelMessage = message;
  const actionsDisabled = !isReady || isLoading || isProcessing;
  const primaryActionLabel = activeOperationLabel ?? viewModel.primaryAction;
  const emptyStateActionLabel =
    viewModel.emptyState?.actionLabel === "初始化 LLM Wiki" &&
    activeOperation === "initialize"
      ? (activeOperationLabel ?? viewModel.emptyState.actionLabel)
      : viewModel.emptyState?.actionLabel;
  const askMode = viewModel.modes.find((mode) => mode.id === "ask");
  const digestMode = viewModel.modes.find((mode) => mode.id === "digest");
  const effectiveMode =
    activeMode === "ask" && askMode?.disabled
      ? "status"
      : activeMode === "digest" && digestMode?.disabled
        ? "status"
        : activeMode;
  const queryDisabled =
    actionsDisabled ||
    status?.mode !== "llmWiki" ||
    isProcessing ||
    isQuerying ||
    question.trim().length === 0;
  const digestDisabled =
    actionsDisabled ||
    status?.mode !== "llmWiki" ||
    digestTitle.trim().length === 0 ||
    digestPrompt.trim().length === 0;

  return (
    <section className="min-h-0 border-t border-base-300 bg-base-100">
      <PanelHeader
        title="LLM Wiki"
        actions={
          <>
            <IconButton
              label="刷新状态"
              icon={isLoading ? "…" : "↻"}
              onClick={() => void refresh()}
              disabled={isLoading || isProcessing}
            />
          </>
        }
      />

      <div className="space-y-3 overflow-auto p-3 text-xs">
        <div className="grid grid-cols-3 gap-1 bg-base-200 p-1">
          {viewModel.modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={[
                "h-7 truncate px-2 text-xs outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-base-content/40",
                effectiveMode === mode.id
                  ? "bg-base-100 text-base-content shadow-sm"
                  : "text-base-content/70 hover:text-base-content",
              ].join(" ")}
              disabled={mode.disabled}
              onClick={() => setActiveMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {activeOperation ? (
          <div className="flex min-w-0 items-center gap-2 border border-base-300 bg-base-200/60 p-2">
            <div className="min-w-0 flex-1 truncate text-base-content/75">
              {activeStageLabel ?? activeOperationLabel ?? "处理中"}
            </div>
            <button
              type="button"
              className="h-7 shrink-0 border border-base-content/40 px-2 text-xs text-base-content outline-none transition-colors hover:border-base-content hover:bg-base-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:border-base-content/20 disabled:text-base-content/35"
              disabled={!activeOperationId}
              onClick={() => void cancelActiveOperation()}
            >
              取消
            </button>
          </div>
        ) : null}

        {effectiveMode === "status" ? (
          <div className="space-y-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-base-content">
                {viewModel.title}
              </div>
              <div className="mt-2 space-y-1 text-base-content/70">
                {viewModel.statusLines.map((line) => (
                  <div key={line} className="truncate" title={line}>
                    {line}
                  </div>
                ))}
              </div>
            </div>

            {viewModel.emptyState ? (
              <div className="border border-base-300 bg-base-200/60 py-3">
                <EmptyState
                  title={viewModel.emptyState.title}
                  description={viewModel.emptyState.description}
                  actionLabel={emptyStateActionLabel}
                  onAction={
                    viewModel.emptyState.actionLabel === "配置 LLM"
                      ? handleConfigure
                      : handlePrimaryAction
                  }
                  actionDisabled={actionsDisabled}
                />
              </div>
            ) : (
              <button
                type="button"
                className="h-8 w-full border border-base-content bg-base-content px-3 text-xs text-base-100 outline-none transition-colors hover:bg-base-content/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:border-base-content/30 disabled:bg-base-content/30"
                disabled={actionsDisabled}
                onClick={handlePrimaryAction}
              >
                {primaryActionLabel}
              </button>
            )}

            <div className="grid grid-cols-2 gap-2">
              {viewModel.secondaryActions.map((action) => (
                <TextControlButton
                  key={action.id}
                  disabled={actionsDisabled || action.disabled}
                  onClick={() =>
                    action.id === "lint" ? void lint() : void graph()
                  }
                >
                  {activeOperation === action.id
                    ? (activeOperationLabel ?? action.label)
                    : action.label}
                </TextControlButton>
              ))}
            </div>
          </div>
        ) : null}

        {effectiveMode === "ask" ? (
          <form className="space-y-2" onSubmit={handleQuerySubmit}>
            <label className="block space-y-1.5 text-xs text-base-content/70">
              <span>问题</span>
              <textarea
                className="textarea textarea-bordered min-h-24 w-full resize-y text-xs leading-relaxed placeholder:text-base-content/65 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={
                  actionsDisabled ||
                  status?.mode !== "llmWiki" ||
                  isProcessing
                }
                placeholder="询问当前 Wiki"
                rows={4}
              />
            </label>
            <button
              type="submit"
              className="h-8 w-full border border-base-content bg-base-content px-3 text-xs text-base-100 outline-none transition-colors hover:bg-base-content/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:border-base-content/30 disabled:bg-base-content/30"
              disabled={queryDisabled}
            >
              {isQuerying ? "正在查询" : "查询 Wiki"}
            </button>
          </form>
        ) : null}

        {effectiveMode === "digest" ? (
          <form className="space-y-2" onSubmit={handleDigestSubmit}>
            <label className="block space-y-1.5 text-xs text-base-content/70">
              <span>文件名</span>
              <input
                className="input input-bordered h-8 min-h-8 w-full text-xs placeholder:text-base-content/65 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                value={digestTitle}
                onChange={(event) => setDigestTitle(event.target.value)}
                disabled={
                  actionsDisabled ||
                  status?.mode !== "llmWiki" ||
                  isProcessing
                }
                placeholder="project-summary"
              />
            </label>
            <label className="block space-y-1.5 text-xs text-base-content/70">
              <span>主题</span>
              <textarea
                className="textarea textarea-bordered min-h-20 w-full resize-y text-xs leading-relaxed placeholder:text-base-content/65 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                value={digestPrompt}
                onChange={(event) => setDigestPrompt(event.target.value)}
                disabled={
                  actionsDisabled ||
                  status?.mode !== "llmWiki" ||
                  isProcessing
                }
                placeholder="生成综述的问题或主题"
                rows={3}
              />
            </label>
            <button
              type="submit"
              className="h-8 w-full border border-base-content bg-base-content px-3 text-xs text-base-100 outline-none transition-colors hover:bg-base-content/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:border-base-content/30 disabled:bg-base-content/30"
              disabled={digestDisabled}
            >
              {activeOperation === "digest"
                ? (activeOperationLabel ?? "正在生成")
                : "生成综述"}
            </button>
          </form>
        ) : null}

        {queryAnswer ? (
          <div className="space-y-2 rounded border border-base-300 p-2">
            <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-base-content/80">
              {queryAnswer.answer}
            </div>
            {queryAnswer.references.length > 0 ? (
              <div className="space-y-1 border-t border-base-300 pt-2 text-base-content/70">
                {queryAnswer.references.map((reference) => (
                  <div
                    key={reference.path}
                    className="min-w-0"
                    title={`${reference.title}\n${reference.path}`}
                  >
                    <div className="truncate font-medium text-base-content/70">
                      {reference.title || reference.path}
                    </div>
                    <div className="truncate">{reference.snippet}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {panelMessage ? (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap border border-base-300 bg-base-200 p-2 font-sans text-xs leading-relaxed text-base-content/75">
            {panelMessage}
          </pre>
        ) : null}
      </div>
    </section>
  );
}
