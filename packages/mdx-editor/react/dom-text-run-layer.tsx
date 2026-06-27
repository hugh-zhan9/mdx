"use client";

import { useLayoutEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { LayoutLineSnapshot } from "./wasm-layout-bridge";

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
    const pendingCaret = useRef<{ runId: string; pmPosition: number } | null>(null);

    useLayoutEffect(() => {
        const caret = pendingCaret.current;
        if (!caret) {
            return;
        }

        restoreCaret(runElements.current, caret);
        const frame = requestAnimationFrame(() => {
            if (pendingCaret.current === caret) {
                restoreCaret(runElements.current, caret);
                pendingCaret.current = null;
            }
        });

        return () => cancelAnimationFrame(frame);
    });

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
                            onKeyDown={(event) => {
                                if (
                                    !event.metaKey &&
                                    !event.ctrlKey &&
                                    !event.altKey &&
                                    event.key.length === 1
                                ) {
                                    event.preventDefault();
                                    insertTextAtDomSelection(
                                        event.currentTarget,
                                        runId,
                                        run.pmFrom,
                                        run.pmTo,
                                        event.key,
                                        pendingCaret,
                                        onInput,
                                    );
                                    return;
                                }

                                if (event.key === "Backspace") {
                                    event.preventDefault();
                                    deleteBackwardAtDomSelection(
                                        event.currentTarget,
                                        runId,
                                        run.pmFrom,
                                        run.pmTo,
                                        pendingCaret,
                                        onInput,
                                    );
                                }
                            }}
                            onBeforeInput={(event) => {
                                const inputEvent =
                                    event.nativeEvent as InputEvent;
                                const range = sourceRangeFromDomSelection(
                                    event.currentTarget,
                                    run.pmFrom,
                                    run.pmTo,
                                );

                                if (
                                    inputEvent.inputType === "insertText" &&
                                    inputEvent.data
                                ) {
                                    event.preventDefault();
                                    insertTextAtRange(
                                        range,
                                        runId,
                                        inputEvent.data,
                                        pendingCaret,
                                        onInput,
                                    );
                                    return;
                                }

                                if (inputEvent.inputType === "deleteContentBackward") {
                                    event.preventDefault();
                                    deleteBackwardAtRange(
                                        range,
                                        runId,
                                        run.pmFrom,
                                        pendingCaret,
                                        onInput,
                                    );
                                }
                            }}
                            onInput={(event) => {
                                onInput({
                                    runId,
                                    sourceFrom: run.pmFrom,
                                    sourceTo: run.pmTo,
                                    text: event.currentTarget.textContent ?? "",
                                });
                            }}
                            onPointerDown={(event) => {
                                onPointerDown({
                                    runId,
                                    sourceOffset: sourceOffsetFromPointer(
                                        event.nativeEvent,
                                        event.currentTarget,
                                        run.pmFrom,
                                        run.pmTo,
                                    ),
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
                            {run.text}
                        </span>
                    );
                }),
            )}
        </div>
    );
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
    const textNode = element.firstChild;
    const textLength = element.textContent?.length ?? 0;
    const offset = Math.max(
        0,
        Math.min(caret.pmPosition - sourceFrom, textLength),
    );
    const range = document.createRange();
    range.setStart(
        textNode && textNode.nodeType === Node.TEXT_NODE ? textNode : element,
        textNode && textNode.nodeType === Node.TEXT_NODE ? offset : 0,
    );
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.focus();
    return true;
}

function insertTextAtDomSelection(
    target: HTMLElement,
    runId: string,
    sourceFrom: number,
    sourceTo: number,
    text: string,
    pendingCaret: MutableRefObject<{ runId: string; pmPosition: number } | null>,
    onInput: (input: DomTextRunInput) => void,
) {
    insertTextAtRange(
        sourceRangeFromDomSelection(target, sourceFrom, sourceTo),
        runId,
        text,
        pendingCaret,
        onInput,
    );
}

function insertTextAtRange(
    range: { from: number; to: number },
    runId: string,
    text: string,
    pendingCaret: MutableRefObject<{ runId: string; pmPosition: number } | null>,
    onInput: (input: DomTextRunInput) => void,
) {
    pendingCaret.current = {
        runId,
        pmPosition: range.from + text.length,
    };
    onInput({
        runId,
        sourceFrom: range.from,
        sourceTo: range.to,
        text,
    });
}

function deleteBackwardAtDomSelection(
    target: HTMLElement,
    runId: string,
    sourceFrom: number,
    sourceTo: number,
    pendingCaret: MutableRefObject<{ runId: string; pmPosition: number } | null>,
    onInput: (input: DomTextRunInput) => void,
) {
    deleteBackwardAtRange(
        sourceRangeFromDomSelection(target, sourceFrom, sourceTo),
        runId,
        sourceFrom,
        pendingCaret,
        onInput,
    );
}

function deleteBackwardAtRange(
    range: { from: number; to: number },
    runId: string,
    sourceFrom: number,
    pendingCaret: MutableRefObject<{ runId: string; pmPosition: number } | null>,
    onInput: (input: DomTextRunInput) => void,
) {
    const from =
        range.from === range.to ? Math.max(sourceFrom, range.from - 1) : range.from;
    pendingCaret.current = {
        runId,
        pmPosition: from,
    };
    onInput({
        runId,
        sourceFrom: from,
        sourceTo: range.to,
        text: "",
    });
}

function sourceRangeFromDomSelection(
    target: HTMLElement,
    sourceFrom: number,
    sourceTo: number,
) {
    const selection = window.getSelection();
    const textLength = target.textContent?.length ?? 0;
    const clampOffset = (offset: number) =>
        sourceFrom + Math.max(0, Math.min(offset, textLength, sourceTo - sourceFrom));

    if (!selection || selection.rangeCount === 0) {
        return { from: sourceTo, to: sourceTo };
    }

    const range = selection.getRangeAt(0);
    if (!target.contains(range.startContainer) || !target.contains(range.endContainer)) {
        return { from: sourceTo, to: sourceTo };
    }

    const from = clampOffset(range.startOffset);
    const to = clampOffset(range.endOffset);
    return from <= to ? { from, to } : { from: to, to: from };
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
