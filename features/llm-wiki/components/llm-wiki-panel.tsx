"use client";

import { useCallback, useState } from "react";
import { useLlmWikiWorkspace } from "../hooks/use-llm-wiki-workspace";

interface LlmWikiPanelProps {
    rootPath: string;
}

export function LlmWikiPanel({ rootPath }: LlmWikiPanelProps) {
    const { status, viewModel, message, initialize, rescan, lint, graph, refresh } =
        useLlmWikiWorkspace(rootPath);
    const [localMessage, setLocalMessage] = useState<string | null>(null);

    const handlePrimaryAction = useCallback(() => {
        if (viewModel.primaryAction === "配置 LLM") {
            setLocalMessage("LLM 配置入口待接入。");
            return;
        }

        if (status?.mode === "ordinary") {
            void initialize();
            return;
        }

        void rescan();
    }, [initialize, rescan, status?.mode, viewModel.primaryAction]);

    const handleConfigure = useCallback(() => {
        setLocalMessage("LLM 配置入口待接入。");
    }, []);

    const panelMessage = message ?? localMessage;

    return (
        <section className="min-h-0 border-t border-base-300 bg-base-100">
            <div className="flex h-10 min-w-0 items-center justify-between border-b border-base-300 px-3">
                <div className="min-w-0 truncate text-xs font-semibold uppercase text-base-content/60">
                    LLM Wiki
                </div>
                <button
                    type="button"
                    className="h-7 px-2 text-xs text-base-content/65 hover:bg-base-200"
                    onClick={() => void refresh()}
                    title="刷新状态"
                >
                    刷新
                </button>
            </div>

            <div className="space-y-3 overflow-auto p-3 text-xs">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-base-content">
                        {viewModel.title}
                    </div>
                    <div className="mt-2 space-y-1 text-base-content/65">
                        {viewModel.statusLines.map((line) => (
                            <div key={line} className="truncate" title={line}>
                                {line}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-2">
                    <button
                        type="button"
                        className="btn btn-primary btn-sm min-h-8 h-8 text-xs"
                        onClick={
                            viewModel.primaryAction === "配置 LLM"
                                ? handleConfigure
                                : handlePrimaryAction
                        }
                    >
                        <span className="truncate">{viewModel.primaryAction}</span>
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            className="btn btn-sm min-h-8 h-8 text-xs"
                            onClick={() => void lint()}
                        >
                            Lint
                        </button>
                        <button
                            type="button"
                            className="btn btn-sm min-h-8 h-8 text-xs"
                            onClick={() => void graph()}
                        >
                            图谱
                        </button>
                    </div>
                </div>

                {viewModel.primaryAction === "配置 LLM" ? (
                    <div className="rounded border border-base-300 p-2 text-base-content/65">
                        LLM 配置入口待接入。
                    </div>
                ) : null}

                {panelMessage ? (
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-base-300 bg-base-200 p-2 font-sans text-xs leading-relaxed text-base-content/75">
                        {panelMessage}
                    </pre>
                ) : null}
            </div>
        </section>
    );
}
