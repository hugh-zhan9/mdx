"use client";

import { Columns3, Rows3 } from "lucide-react";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { NodeViewProps } from "./node-views";

interface TableNodeViewProps extends NodeViewProps {
    contentRef?: (element: HTMLElement | null) => void;
    onAddColumn?: () => void;
    onAddRow?: () => void;
}

export function TableNodeView({
    contentRef,
    node,
    onAddColumn,
    onAddRow,
}: TableNodeViewProps) {
    const alignments = getAlignments(node);

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
