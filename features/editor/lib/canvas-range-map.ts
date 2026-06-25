export interface CanvasMirrorBlock {
    blockId: string;
    pmFrom: number;
    pmTo: number;
    semanticText: string;
    ariaLabel: string;
}

export function buildCanvasRangeMap(blocks: CanvasMirrorBlock[]) {
    return new Map(blocks.map((block) => [block.blockId, block]));
}
