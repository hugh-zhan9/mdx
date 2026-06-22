"use client";

import { Columns3, Rows3, Trash2 } from "lucide-react";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { NodeViewProps } from "./node-views";

interface TableNodeViewProps extends NodeViewProps {
    contentRef?: (element: HTMLElement | null) => void;
    onAddColumn?: () => void;
    onAddRow?: () => void;
    onDeleteColumn?: () => void;
    onDeleteRow?: () => void;
}

export function TableNodeView({
    contentRef,
    node,
    onAddColumn,
    onAddRow,
    onDeleteColumn,
    onDeleteRow,
}: TableNodeViewProps) {
    const alignments = getAlignments(node);
    const rowCount = node.childCount;
    const columnCount = node.child(0)?.childCount ?? 0;

    return (
        <>
            <div className="mdx-table-controls" contentEditable={false}>
                <button
                    type="button"
                    aria-label="Add row"
                    className="mdx-table-control-button"
                    onClick={onAddRow}
                    title="Add row"
                >
                    <Rows3 aria-hidden="true" />
                </button>
                <button
                    type="button"
                    aria-label="Add column"
                    className="mdx-table-control-button"
                    onClick={onAddColumn}
                    title="Add column"
                >
                    <Columns3 aria-hidden="true" />
                </button>
                <button
                    type="button"
                    aria-label="Delete row"
                    className="mdx-table-control-button"
                    disabled={rowCount <= 1}
                    onClick={onDeleteRow}
                    title="Delete row"
                >
                    <Trash2 aria-hidden="true" />
                </button>
                <button
                    type="button"
                    aria-label="Delete column"
                    className="mdx-table-control-button"
                    disabled={columnCount <= 1}
                    onClick={onDeleteColumn}
                    title="Delete column"
                >
                    <Trash2 aria-hidden="true" />
                </button>
            </div>
            <table
                data-mdx-node-type="table"
                data-mdx-alignments={
                    alignments.length > 0 ? alignments.join(",") : undefined
                }
                className="mdx-table-node"
                ref={contentRef}
            />
        </>
    );
}

function getAlignments(node: ProseMirrorNode) {
    return Array.isArray(node.attrs.alignments)
        ? node.attrs.alignments.map(String)
        : [];
}
