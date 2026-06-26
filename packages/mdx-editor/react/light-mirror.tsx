export interface LightMirrorBlock {
    blockId: string;
    pmFrom: number;
    pmTo: number;
    semanticText: string;
    ariaLabel: string;
}

export function LightMirror({ blocks }: { blocks: LightMirrorBlock[] }) {
    return (
        <div
            data-layout-light-mirror
            className="sr-only"
            aria-hidden="false"
        >
            {blocks.map((block) => (
                <div
                    key={block.blockId}
                    data-mirror-block-id={block.blockId}
                    data-mirror-pm-from={block.pmFrom}
                    data-mirror-pm-to={block.pmTo}
                    aria-label={block.ariaLabel}
                >
                    {block.semanticText}
                </div>
            ))}
        </div>
    );
}
