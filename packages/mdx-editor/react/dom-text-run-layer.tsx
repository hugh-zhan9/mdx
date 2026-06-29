"use client";

import { useRef } from "react";
import type { ReactNode } from "react";
import type {
    LayoutLineSnapshot,
    LayoutTextRunPosition,
} from "./wasm-layout-bridge";

export interface DomTextRunInput {
    runId: string;
    sourceFrom: number;
    sourceTo: number;
    text: string;
}

export interface DomTextRunPointerInput {
    runId: string;
    sourceOffset: number;
}

export interface DomTextRunLayerProps {
    lines: LayoutLineSnapshot[];
    onInput: (input: DomTextRunInput) => void;
    onPointerDown: (input: DomTextRunPointerInput) => void;
}

export function DomTextRunLayer({
    lines,
    onInput,
    onPointerDown,
}: DomTextRunLayerProps) {
    const runElements = useRef(new Map<string, HTMLElement>());

    return (
        <div
            data-layout-dom-text-layer
            data-tex-dom-text-layer
            className="absolute inset-0"
        >
            {lines.flatMap((line) =>
                line.textRuns.map((run, index) => {
                    const runId = `${line.id}:${run.blockId}:${index}`;

                    return (
                        <span
                            key={runId}
                            data-layout-block-id={run.blockId}
                            data-layout-pm-from={run.pmFrom}
                            data-layout-pm-to={run.pmTo}
                            data-layout-run-id={runId}
                            contentEditable
                            ref={(element) => {
                                if (element) {
                                    runElements.current.set(runId, element);
                                } else {
                                    runElements.current.delete(runId);
                                }
                            }}
                            suppressContentEditableWarning
                            spellCheck={false}
                            onInput={(event) => {
                                onInput({
                                    runId,
                                    sourceFrom: run.pmFrom,
                                    sourceTo: run.pmTo,
                                    text: event.currentTarget.textContent ?? "",
                                });
                            }}
                            onPointerDown={(event) => {
                                event.preventDefault();
                                const sourceOffset = sourceOffsetFromPointer(
                                    event.nativeEvent,
                                    event.currentTarget,
                                    run.pmFrom,
                                    run.pmTo,
                                );
                                restoreCaret(runElements.current, {
                                    runId,
                                    pmPosition: sourceOffset,
                                });
                                window.requestAnimationFrame(() => {
                                    onPointerDown({
                                        runId,
                                        sourceOffset,
                                    });
                                });
                            }}
                            style={{
                                position: "absolute",
                                left: run.left,
                                top: line.y,
                                width: run.width,
                                height: run.height,
                                fontFamily: run.fontFamily,
                                fontSize: run.fontSize,
                                whiteSpace: "pre",
                                outline: "none",
                            }}
                        >
                            {renderRunText(run)}
                        </span>
                    );
                }),
            )}
        </div>
    );
}

function renderRunText(run: LayoutTextRunPosition) {
    const style = run.style ?? {};
    const link = typeof style.link === "string" ? style.link : "";
    let content: ReactNode = run.text;

    if (style.code) {
        content = <code data-mdx-node-type="inline_code">{content}</code>;
    }
    if (style.bold) {
        content = <strong>{content}</strong>;
    }
    if (style.italic) {
        content = <em>{content}</em>;
    }
    if (style.strike) {
        content = <s>{content}</s>;
    }
    if (style.underline) {
        content = <u>{content}</u>;
    }
    if (link.length > 0) {
        content = (
            <a data-mdx-node-type="link" href={link}>
                {content}
            </a>
        );
    }

    return content;
}

function restoreCaret(
    runElements: Map<string, HTMLElement>,
    caret: { runId: string; pmPosition: number },
) {
    const element = runElements.get(caret.runId);
    if (!element) {
        return false;
    }

    const sourceFrom = Number(element.dataset.layoutPmFrom ?? "0");
    const textNode = firstTextNode(element);
    const textLength = element.textContent?.length ?? 0;
    const offset = Math.max(
        0,
        Math.min(caret.pmPosition - sourceFrom, textLength),
    );
    const range = document.createRange();
    range.setStart(
        textNode ?? element,
        textNode ? offset : 0,
    );
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.focus();
    return true;
}

function firstTextNode(root: Node): Text | null {
    if (root.nodeType === Node.TEXT_NODE) {
        return root as Text;
    }

    for (const child of Array.from(root.childNodes)) {
        const found = firstTextNode(child);
        if (found) {
            return found;
        }
    }

    return null;
}

function sourceOffsetFromPointer(
    event: PointerEvent,
    target: HTMLElement,
    sourceFrom: number,
    sourceTo: number,
) {
    const documentWithCaret = document as Document & {
        caretPositionFromPoint?: (
            x: number,
            y: number,
        ) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const textLength = target.textContent?.length ?? 0;
    const clamp = (offset: number) =>
        sourceFrom + Math.max(0, Math.min(offset, textLength, sourceTo - sourceFrom));

    const caretPosition = documentWithCaret.caretPositionFromPoint?.(
        event.clientX,
        event.clientY,
    );
    if (caretPosition && target.contains(caretPosition.offsetNode)) {
        return clamp(caretPosition.offset);
    }

    const caretRange = documentWithCaret.caretRangeFromPoint?.(
        event.clientX,
        event.clientY,
    );
    if (caretRange && target.contains(caretRange.startContainer)) {
        return clamp(caretRange.startOffset);
    }

    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || textLength === 0) {
        return sourceFrom;
    }

    return clamp(Math.round(((event.clientX - rect.left) / rect.width) * textLength));
}
