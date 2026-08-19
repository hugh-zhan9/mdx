"use client";

import { RefreshCw } from "lucide-react";
import { type FormEvent, useCallback, useState } from "react";
import {
  Card,
  EmptyState,
  IconButton,
  PrimaryTextControlButton,
  StatList,
  TextArea,
  TextInput,
  TextControlButton,
} from "../../../common/components/ui-controls";
import type { LlmWikiWorkspaceHook } from "../hooks/use-llm-wiki-workspace";

interface LlmWikiPanelProps {
  llmWiki: LlmWikiWorkspaceHook;
  onConfigureLlm?: () => void;
}

const MAX_PROGRESS_MESSAGE_CHARS = 4000;
const MAX_PROGRESS_MESSAGE_LINES = 80;

function formatPanelProgressMessage(message: string) {
  const lines = message.split("\n");
  const lineLimited = lines.length > MAX_PROGRESS_MESSAGE_LINES;
  let preview = (lineLimited
    ? lines.slice(0, MAX_PROGRESS_MESSAGE_LINES)
    : lines
  ).join("\n");
  const charLimited = preview.length > MAX_PROGRESS_MESSAGE_CHARS;

  if (charLimited) {
    preview = preview.slice(0, MAX_PROGRESS_MESSAGE_CHARS).trimEnd();
  }

  if (!lineLimited && !charLimited) {
    return message;
  }

  return [
    preview,
    "",
    `... 已截断，完整进度共 ${lines.length} 行、${message.length} 个字符。`,
  ].join("\n");
}

/** What the two secondary actions do, in words that say what pressing them means. */
const SECONDARY_ACTION_TITLES: Record<string, string> = {
  lint: "检查 wiki 一致性",
  graph: "重建知识图谱页",
};

const SECONDARY_ACTION_HINTS: Record<string, string> = {
  lint: "扫描 wiki 与 raw，把断链、缺失和重复写进报告。文件多时要跑一会儿。",
  graph: "按当前 wiki 重新生成图谱 Markdown 页。",
};

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
    progress,
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

  const panelMessage = message ? formatPanelProgressMessage(message) : null;
  const actionsDisabled = !isReady || isLoading || isProcessing;
  const queryActionsDisabled =
    !isReady ||
    isLoading ||
    (isProcessing && activeOperation !== "ingest");
  const primaryActionLabel = activeOperationLabel ?? viewModel.primaryAction;
  const emptyStateActionLabel =
    viewModel.emptyState?.actionLabel === "初始化 LLM Wiki" &&
    activeOperation === "initialize"
      ? (activeOperationLabel ?? viewModel.emptyState.actionLabel)
      : viewModel.emptyState?.actionLabel;
  const askMode = viewModel.modes.find((mode) => mode.id === "ask");
  const digestMode = viewModel.modes.find((mode) => mode.id === "digest");
  // The sections are always shown, so what used to disable a tab now explains
  // itself in place.
  const askDisabledHint = askMode?.disabled ? "需要先配置 LLM" : null;
  const digestDisabledHint = digestMode?.disabled ? "需要先配置 LLM" : null;
  const showStatusProgress = Boolean(panelMessage);
  const queryDisabled =
    queryActionsDisabled ||
    status?.mode !== "llmWiki" ||
    isQuerying ||
    question.trim().length === 0;
  const digestDisabled =
    actionsDisabled ||
    status?.mode !== "llmWiki" ||
    digestTitle.trim().length === 0 ||
    digestPrompt.trim().length === 0;

  return (
    <section className="flex h-full min-h-0 flex-col bg-base-100">
      {/*
       * Mode switch and refresh on one row, with no title: the toolbar button
       * that opened this view already names it, and a heading directly under it
       * spent a row saying something already on screen.
       */}
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--mdx-separator)] px-4 py-2">
        <div className="min-w-0 truncate text-[13px] font-semibold text-base-content">
          {viewModel.title}
        </div>
        <IconButton
          label="刷新状态"
          icon={<RefreshCw className={isLoading ? "animate-spin" : undefined} />}
          onClick={() => void refresh()}
          disabled={isLoading || isProcessing}
        />
      </div>

      {/*
       * Held to a readable measure rather than run to the window edge. These are
       * forms and their results, not a dashboard: a question box stretched
       * across two thousand pixels is harder to read, not roomier.
       */}
      {/* The same column the memory view uses, for the same reason. */}
      <div
        data-mdx-page-column=""
        className="min-h-0 flex-1 overflow-auto px-4 py-3 text-xs"
      >
        <div className="mx-auto w-full max-w-3xl space-y-3">

        {progress ? (
          <Card className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="text-[13px] font-semibold text-base-content">
                正在处理 {progress.index}/{progress.total}
              </span>
              <span className="shrink-0 text-[11px] text-base-content/50">
                已等待 {progress.elapsedSeconds} 秒
              </span>
            </div>
            <div
              className="min-w-0 truncate text-xs text-base-content/70"
              title={progress.file}
            >
              {progress.file}
            </div>
            <StatList
              items={[
                { label: "已完成", value: progress.completed },
                { label: "已失败", value: progress.failed },
              ]}
            />
          </Card>
        ) : null}

        {activeOperation ? (
          <div className="flex min-w-0 items-center gap-2 rounded-[var(--mdx-control-radius)] bg-[var(--mdx-card-bg)] p-2">
            <div className="min-w-0 flex-1 truncate text-base-content/75">
              {activeStageLabel ?? activeOperationLabel ?? "处理中"}
            </div>
            <button
              type="button"
              className="h-7 shrink-0 rounded-[var(--mdx-control-radius)] border border-[var(--mdx-field-border)] px-2.5 text-xs text-base-content/75 outline-none transition-colors hover:bg-base-content/6 hover:text-base-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:text-base-content/35"
              disabled={!activeOperationId}
              onClick={() => void cancelActiveOperation()}
            >
              取消
            </button>
          </div>
        ) : null}

        <section className="space-y-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-base-content">
                {viewModel.title}
              </div>
              {/* One row: six counts stacked into six lines said nothing more
                  than six counts on one line, and pushed everything below the
                  fold. */}
              <StatList className="mt-1.5" items={viewModel.statusStats} />
            </div>

            {panelMessage ? (
              <pre
                data-testid="llm-wiki-progress"
                className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[var(--mdx-control-radius)] bg-[var(--mdx-card-bg)] p-2 font-[inherit] text-xs leading-relaxed text-base-content/75"
              >
                {panelMessage}
              </pre>
            ) : null}

            {viewModel.emptyState ? (
              <Card className="py-3">
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
              </Card>
            ) : (
              <div className="flex justify-end">
                <PrimaryTextControlButton
                  disabled={actionsDisabled}
                  onClick={handlePrimaryAction}
                >
                  {primaryActionLabel}
                </PrimaryTextControlButton>
              </div>
            )}

            {/*
             * Named for what they do, with what they do underneath. They were two
             * words — 检查, 图谱 — in a bare two-column grid, which read as labels
             * rather than controls and said nothing about what pressing them meant.
             */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {viewModel.secondaryActions.map((action) => (
                <div
                  key={action.id}
                  className="flex min-w-0 items-center justify-between gap-2 rounded-[var(--mdx-control-radius)] bg-[var(--mdx-card-bg)] px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs text-base-content/80">
                      {SECONDARY_ACTION_TITLES[action.id]}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-base-content/50">
                      {SECONDARY_ACTION_HINTS[action.id]}
                    </div>
                  </div>
                  <TextControlButton
                    className="shrink-0"
                    disabled={actionsDisabled || action.disabled}
                    onClick={() =>
                      action.id === "lint" ? void lint() : void graph()
                    }
                  >
                    {activeOperation === action.id
                      ? (activeOperationLabel ?? "进行中")
                      : action.label}
                  </TextControlButton>
                </div>
              ))}
            </div>

            {viewModel.failed.length > 0 ? (
              <div className="space-y-2 rounded-[var(--mdx-control-radius)] bg-[var(--mdx-card-bg)] p-2">
                <div className="text-xs font-semibold text-base-content/75">
                  失败明细
                </div>
                <div
                  data-testid="llm-wiki-failed-details"
                  className="max-h-48 space-y-2 overflow-auto break-words pr-1"
                >
                  {viewModel.failed.map((failure) => (
                    <div
                      key={failure.path}
                      className="min-w-0 border-t border-[var(--mdx-separator)] pt-2 first:border-t-0 first:pt-0"
                      title={`${failure.path}\n${failure.reason}`}
                    >
                      <div className="break-all text-xs font-medium text-base-content/80">
                        {failure.path}
                      </div>
                      <div className="mt-1 break-words text-xs leading-relaxed text-base-content/65">
                        {failure.reason}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
        </section>

        <section className="space-y-2 border-t border-[var(--mdx-separator)] pt-3">
          <SectionHeading
            title="提问"
            hint={askDisabledHint}
            onConfigure={handleConfigure}
          />
          <form className="space-y-2" onSubmit={handleQuerySubmit}>
            {/* No field label: the section is called 提问, the box says what to
                type in it, and a third word between them was what closed the gap
                to the heading. */}
            <label className="block text-xs text-base-content/70">
              <TextArea
                className="min-h-24 text-xs leading-relaxed"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={
                  queryActionsDisabled || status?.mode !== "llmWiki"
                }
                placeholder="询问当前 Wiki"
                rows={4}
              />
            </label>
            <div className="flex justify-end">
              <PrimaryTextControlButton type="submit" disabled={queryDisabled}>
                {isQuerying ? "正在查询" : "查询 Wiki"}
              </PrimaryTextControlButton>
            </div>
          </form>

          {queryAnswer ? (
            <Card className="space-y-2">
              <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-base-content/80">
                {queryAnswer.answer}
              </div>
              {queryAnswer.references.length > 0 ? (
                <div className="space-y-1 border-t border-[var(--mdx-separator)] pt-2 text-base-content/70">
                  {queryAnswer.references.map((reference) => (
                    <div
                      key={reference.path}
                      className="min-w-0"
                      title={`${reference.title}\n${reference.path}`}
                    >
                      <div className="truncate text-xs text-base-content/80">
                        {reference.title}
                      </div>
                      <div className="truncate text-[11px] text-base-content/55">
                        {reference.path}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {queryAnswer.insufficientContext ? (
                <div className="text-[11px] text-warning">
                  当前 Wiki 内容不足以完整回答该问题。
                </div>
              ) : null}
            </Card>
          ) : null}
        </section>

        <section className="space-y-2 border-t border-[var(--mdx-separator)] pt-3">
          <SectionHeading
            title="生成综述"
            hint={digestDisabledHint}
            onConfigure={handleConfigure}
          />
          <form className="space-y-2" onSubmit={handleDigestSubmit}>
            <label className="block space-y-1.5 text-xs text-base-content/70">
              <span>文件名</span>
              <TextInput
                className="text-xs"
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
              <TextArea
                className="min-h-20 text-xs leading-relaxed"
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
            <div className="flex justify-end">
              <PrimaryTextControlButton type="submit" disabled={digestDisabled}>
                {activeOperation === "digest"
                  ? (activeOperationLabel ?? "正在生成")
                  : "生成综述"}
              </PrimaryTextControlButton>
            </div>
          </form>
        </section>

        {panelMessage && !showStatusProgress ? (
          <pre
            data-testid="llm-wiki-progress"
            className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[var(--mdx-control-radius)] bg-[var(--mdx-card-bg)] p-2 font-[inherit] text-xs leading-relaxed text-base-content/75"
          >
            {panelMessage}
          </pre>
        ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * A section title, plus why the section cannot be used yet.
 *
 * This is what a disabled tab could never say. The two LLM-backed sections need
 * a configured provider; before that they used to be tabs that simply refused to
 * open, leaving the user to guess. Now they are visible, inert, and explain
 * themselves.
 */
function SectionHeading({
  title,
  hint,
  onConfigure,
}: {
  title: string;
  hint: string | null;
  onConfigure: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="text-[13px] font-semibold text-base-content">{title}</div>
      {hint ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[11px] text-base-content/50">
            {hint}
          </span>
          <TextControlButton className="shrink-0" onClick={onConfigure}>
            配置 LLM
          </TextControlButton>
        </div>
      ) : null}
    </div>
  );
}
