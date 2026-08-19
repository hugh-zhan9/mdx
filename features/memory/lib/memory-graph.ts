import type { StoredItem } from "./types";

/**
 * The relation graph's data, built from what the library actually holds.
 *
 * Today that is one kind of edge: a conclusion cites the material it stands on,
 * and the record written when it was adopted. Entity extraction — the thing that
 * turns a note collection into the dense webs these views are famous for — is a
 * separate pass nobody has run here, and drawing every stored item without it
 * produces a thousand dots and no lines.
 *
 * So the graph is grown from the conclusions outwards rather than from the whole
 * library inwards. Material appears because something cites it; a conclusion
 * appears because it exists. That keeps the picture honest: every line on screen
 * is a claim someone made about which evidence supports what.
 */

export type GraphNodeKind =
    | "conclusion"
    | "material"
    | "verification"
    /** A source document, standing for the chunks it produced. */
    | "document";

export interface GraphNode {
    id: string;
    kind: GraphNodeKind;
    label: string;
    /** Documents: how many chunks it stands for. One for everything else. */
    weight?: number;
    /** Conclusion status, for the colour that says whether an agent sees it. */
    status: string | null;
    /** How many edges touch it, which decides how large it is drawn. */
    degree: number;
}

export type GraphEdgeKind =
    | "supports"
    /** A document holds the chunk that was cited. */
    | "holds"
    | "verifies"
    | "contradicts"
    /** Answered by a search rather than by a person. Drawn dashed. */
    | "similar";

export interface GraphEdge {
    from: string;
    to: string;
    kind: GraphEdgeKind;
}

export interface MemoryGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
    /** Material the conclusions cite but the loaded page does not contain. */
    missing: number;
}

/** A document's node id, kept distinct from any drawer id. */
export function documentId(sourceFile: string): string {
    return `doc:${sourceFile}`;
}

/** The source file a document node stands for, or null for any other node. */
export function documentSource(nodeId: string): string | null {
    return nodeId.startsWith("doc:") ? nodeId.slice(4) : null;
}

/**
 * The source path a document node is named by: its last segment.
 *
 * Shortened in the middle rather than at the end, because the end is the part that
 * tells two files apart — a project holds `03_ric_change_task_output.json` and
 * `03_ric_change_task_output.md`, and cut at the tail they are the same label.
 */
function documentLabel(sourceFile: string): string {
    const last = sourceFile.split("/").pop() ?? sourceFile;

    if (last.length <= 26) return last;

    return `${last.slice(0, 14)}…${last.slice(-10)}`;
}

/** One line of label: enough to recognise an entry, never the whole text. */
function label(item: StoredItem): string {
    const text = (item.statement ?? item.excerpt).replace(/\s+/g, " ").trim();

    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/**
 * The graph for the material and conclusions that are loaded.
 *
 * A cited id that is not in `material` is counted rather than invented: the page
 * holds a window over the library, and a node with a made-up label would be worse
 * than a number saying how much is out of view.
 */
/** What the picture is made of at the level being looked at. */
export interface GraphOptions {
    /** Material ids a search called neighbours, keyed by the id searched from. */
    similar?: Record<string, string[]>;
    /**
     * Source files whose chunks are drawn individually.
     *
     * Everything else is one dot per document. A project's material is mostly
     * chunks of a few documents — fourteen dots for one file — and drawing them all
     * puts a thousand identical points on screen to say "there are some files".
     * Expanding is how you get to a chunk, and it is one click on its document.
     */
    expanded?: Set<string>;
}

export function buildMemoryGraph(
    material: StoredItem[],
    conclusions: StoredItem[],
    options: GraphOptions = {},
): MemoryGraph {
    const similar = options.similar ?? {};
    const expanded = options.expanded ?? new Set<string>();
    /** Which node stands for a piece of material: itself, or its document. */
    const standIn = new Map<string, string>();
    const byId = new Map(material.map((item) => [item.drawerId, item]));
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    let missing = 0;

    const add = (id: string, node: () => GraphNode) => {
        const existing = nodes.get(id);

        if (existing) {
            existing.degree += 1;
            return;
        }

        nodes.set(id, node());
    };

    // Material is the dimension, at the grain being looked at: a document stands for
    // its chunks until someone expands it. Drawing every chunk by default made a
    // picture of a thousand identical dots, most of them fragments of the same few
    // files, which is why the graph could not be read at all.
    const documents = new Map<string, StoredItem[]>();
    for (const item of material) {
        const source = item.sourceFile ?? "";

        if (source.length === 0 || expanded.has(source)) {
            standIn.set(item.drawerId, item.drawerId);
            add(item.drawerId, () => ({
                id: item.drawerId,
                kind: "material",
                label: label(item),
                status: null,
                degree: 0,
            }));
            continue;
        }

        const group = documents.get(source) ?? [];
        group.push(item);
        documents.set(source, group);
        standIn.set(item.drawerId, documentId(source));
    }

    for (const [source, chunks] of documents) {
        add(documentId(source), () => ({
            id: documentId(source),
            kind: "document",
            label: documentLabel(source),
            status: null,
            degree: 0,
            weight: chunks.length,
        }));
    }

    // A document that is expanded still says which chunks belong to it.
    for (const source of expanded) {
        const chunks = material.filter((item) => item.sourceFile === source);

        if (chunks.length < 2) continue;

        add(documentId(source), () => ({
            id: documentId(source),
            kind: "document",
            label: documentLabel(source),
            status: null,
            degree: 0,
            weight: chunks.length,
        }));

        for (const chunk of chunks) {
            edges.push({
                from: documentId(source),
                to: chunk.drawerId,
                kind: "holds",
            });
            nodes.get(documentId(source))!.degree += 1;
            nodes.get(chunk.drawerId)!.degree += 1;
        }
    }

    // What a search called close, when someone asked for it. Kept apart from the
    // rest: this is the machine's opinion, and the picture says so.
    for (const [from, neighbours] of Object.entries(similar)) {
        if (!nodes.has(from)) continue;
        for (const to of neighbours) {
            if (to === from || !nodes.has(to)) continue;
            edges.push({ from, to, kind: "similar" });
            nodes.get(from)!.degree += 1;
            nodes.get(to)!.degree += 1;
        }
    }

    for (const conclusion of conclusions) {
        add(conclusion.drawerId, () => ({
            id: conclusion.drawerId,
            kind: "conclusion",
            label: label(conclusion),
            status: conclusion.status,
            degree: 0,
        }));

        const cited: Array<[string[], GraphEdgeKind, GraphNodeKind]> = [
            [conclusion.supportingRefs, "supports", "material"],
            [conclusion.verificationRefs, "verifies", "verification"],
            [conclusion.counterexampleRefs, "contradicts", "material"],
        ];

        for (const [refs, edgeKind, nodeKind] of cited) {
            for (const ref of refs) {
                const item = byId.get(ref);

                if (!item && edgeKind !== "verifies") {
                    // Cited, but outside the loaded window.
                    missing += 1;
                    continue;
                }

                // At the document grain a citation lands on the document, which is
                // what makes "these three files support this conclusion" the shape
                // you see first.
                const target = standIn.get(ref) ?? ref;

                add(target, () => ({
                    id: target,
                    kind: nodeKind,
                    label: item ? label(item) : "采纳记录",
                    status: null,
                    degree: 0,
                }));
                nodes.get(conclusion.drawerId)!.degree += 1;
                nodes.get(target)!.degree += 1;

                if (
                    edges.some(
                        (edge) =>
                            edge.from === conclusion.drawerId &&
                            edge.to === target &&
                            edge.kind === edgeKind,
                    )
                ) {
                    // Two chunks of one document support it: one line, not two.
                    continue;
                }

                edges.push({
                    from: conclusion.drawerId,
                    to: target,
                    kind: edgeKind,
                });
            }
        }
    }

    return { nodes: [...nodes.values()], edges, missing };
}

export interface PlacedNode extends GraphNode {
    x: number;
    y: number;
}

/**
 * Where each node sits, worked out without a physics loop.
 *
 * A force simulation would land the same library somewhere different on every
 * open, and a map that moves is a map nobody learns. So the arrangement is
 * derived, in three steps, from what the data already groups by:
 *
 * material is placed in clusters, one per source document, because chunks of one
 * file belong together and that is the grouping the reader already has in mind;
 * clusters are spread around the canvas in a stable order — by size, then by name
 * — so adding an entry grows a cluster instead of reshuffling the picture; and a
 * conclusion sits at the centre of gravity of the material it cites, pulled a
 * little towards the middle, which is what makes "several pieces, one conclusion"
 * visible as a shape rather than as a colour.
 */
export function placeGraph(
    graph: MemoryGraph,
    width: number,
    height: number,
): PlacedNode[] {
    const centreX = width / 2;
    const centreY = height / 2;
    const placed = new Map<string, PlacedNode>();
    const material = graph.nodes.filter((node) => node.kind !== "conclusion");
    const conclusions = graph.nodes.filter((node) => node.kind === "conclusion");

    // One cluster per document, in a stable order so the map does not reshuffle: an
    // opened document sits with the chunks it opened into rather than across the
    // canvas from them.
    const sameSource = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
        if (edge.kind !== "holds") continue;
        const group =
            sameSource.get(edge.from) ?? sameSource.get(edge.to) ?? new Set();
        group.add(edge.from);
        group.add(edge.to);
        sameSource.set(edge.from, group);
        sameSource.set(edge.to, group);
    }
    const clusters: string[][] = [];
    const claimed = new Set<string>();
    for (const node of material) {
        if (claimed.has(node.id)) continue;
        const group = sameSource.get(node.id);
        const members = group ? [...group] : [node.id];
        members.forEach((id) => claimed.add(id));
        clusters.push(members.sort());
    }
    // By how much each cluster holds, largest first, so the map has a gradient a
    // reader can use: the documents this project is mostly made of sit in the middle,
    // and the one-chunk notes ring the edge. Sorted alphabetically, size was noise.
    const byNode = new Map(graph.nodes.map((node) => [node.id, node]));
    const bulk = (members: string[]) =>
        members.reduce(
            (sum, id) => sum + (byNode.get(id)?.weight ?? 1),
            0,
        );
    clusters.sort(
        (left, right) =>
            bulk(right) - bulk(left) || left[0].localeCompare(right[0]),
    );

    // A disc rather than a ring, at both levels. On a ring the picture reads as a
    // clock face with an empty middle — and at the document grain, where nearly
    // every cluster is a single dot, that is all a ring can ever produce. The golden
    // angle is what fills a disc evenly without a simulation: same input, same
    // picture, every time.
    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
    // Reach is elliptical, one radius per axis: a single radius drew a circle in
    // the middle of a wide panel and left the sides empty, which looks like the
    // canvas is smaller than it is.
    const reachX = Math.max(60, width / 2 - 40);
    const reachY = Math.max(60, height / 2 - 40);
    const reach = Math.min(reachX, reachY);
    // Room enough for an opened document: a hundred chunks in a 70px disc is a
    // hairball, and looking at one closely is the reason to open it.
    const spanOf = (members: string[]) =>
        Math.min(120, 10 + Math.sqrt(members.length) * 14);

    const spread = (members: string[], cx: number, cy: number) => {
        const radius = spanOf(members);

        members.forEach((id, position) => {
            const node = material.find((candidate) => candidate.id === id);

            if (!node) return;

            const step = Math.sqrt((position + 0.5) / members.length);
            const memberAngle = position * GOLDEN_ANGLE;

            placed.set(id, {
                ...node,
                x: clamp(cx + Math.cos(memberAngle) * radius * step, 12, width - 12),
                y: clamp(cy + Math.sin(memberAngle) * radius * step, 12, height - 12),
            });
        });
    };

    // What is opened owns the middle, and everything still aggregated is pushed
    // outside it. Placed on the one disc together, an opened document's hundred
    // chunks landed on top of the other documents' dots, and the picture read as one
    // smear where it should read as "this file, against the rest".
    const opened = clusters.filter((members) => members.length > 1);
    const shut = clusters.filter((members) => members.length === 1);
    const keepOut = opened.reduce(
        (widest, members) => Math.max(widest, spanOf(members)),
        0,
    );
    const openedRing = opened.length > 1 ? keepOut * 1.15 : 0;

    opened.forEach((members, index) => {
        const angle = index * GOLDEN_ANGLE;

        spread(
            members,
            centreX + Math.cos(angle) * openedRing,
            centreY + Math.sin(angle) * openedRing,
        );
    });

    const floor = Math.min(0.8, (openedRing + keepOut + 18) / reach);
    shut.forEach((members, index) => {
        const away =
            floor + (1 - floor) * Math.sqrt((index + 0.5) / shut.length);
        const angle = index * GOLDEN_ANGLE;

        spread(
            members,
            centreX + Math.cos(angle) * reachX * away,
            centreY + Math.sin(angle) * reachY * away,
        );
    });

    // A conclusion sits where its evidence is, pulled towards the middle so it
    // reads as standing over the material rather than as one more dot in it.
    for (const conclusion of conclusions) {
        const cited = graph.edges
            .filter((edge) => edge.from === conclusion.id)
            .map((edge) => placed.get(edge.to))
            .filter((node): node is PlacedNode => node !== undefined);

        if (cited.length === 0) {
            placed.set(conclusion.id, {
                ...conclusion,
                x: centreX,
                y: centreY,
            });
            continue;
        }

        const x = cited.reduce((sum, node) => sum + node.x, 0) / cited.length;
        const y = cited.reduce((sum, node) => sum + node.y, 0) / cited.length;

        placed.set(conclusion.id, {
            ...conclusion,
            x: clamp(x + (centreX - x) * 0.35, 20, width - 20),
            y: clamp(y + (centreY - y) * 0.35, 20, height - 20),
        });
    }

    // Anything cited but not in the material window — an adoption record, say.
    for (const node of graph.nodes) {
        if (placed.has(node.id)) continue;

        const anchor = graph.edges
            .filter((edge) => edge.to === node.id)
            .map((edge) => placed.get(edge.from))
            .find((candidate): candidate is PlacedNode => candidate !== undefined);

        placed.set(node.id, {
            ...node,
            x: clamp((anchor?.x ?? centreX) + 34, 12, width - 12),
            y: clamp((anchor?.y ?? centreY) - 34, 12, height - 12),
        });
    }

    return [...placed.values()];
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}
