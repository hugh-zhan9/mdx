import type { LayoutDocument } from "./types";

export interface LayoutInvalidationEntry {
    blockId: string;
    pmFrom: number;
    pmTo: number;
}

export interface LayoutInvalidationMap {
    revision: number;
    blocks: LayoutInvalidationEntry[];
}

export function createLayoutInvalidationMap(
    document: LayoutDocument,
): LayoutInvalidationMap {
    return {
        revision: document.revision,
        blocks: document.blocks.map((block) => ({
            blockId: block.blockId,
            pmFrom: block.pmFrom,
            pmTo: block.pmTo,
        })),
    };
}
