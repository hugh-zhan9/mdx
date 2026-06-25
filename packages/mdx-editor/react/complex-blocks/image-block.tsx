import type { ComplexBlockOp } from "./index";

export function ImageBlock({ op }: { op: ComplexBlockOp }) {
    const src = typeof op.data?.src === "string" ? op.data.src : "";
    const alt = typeof op.data?.alt === "string" ? op.data.alt : "";

    return (
        <figure
            data-complex-block-id={op.blockId}
            data-complex-block-kind="image"
        >
            {src.length > 0 ? <img src={src} alt={alt} /> : <span>{alt}</span>}
        </figure>
    );
}
