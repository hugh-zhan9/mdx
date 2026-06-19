"use client";

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
                <button type="button" onClick={onAddRow}>
                    Add row
                </button>
                <button type="button" onClick={onAddColumn}>
                    Add column
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
