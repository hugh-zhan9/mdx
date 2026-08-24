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
    /**
     * Which cluster the node is drawn in: its source file, or its own id when
     * it stands alone. The layout keys a cluster's place on this, so a document
     * and its chunks share one place whatever grain they are drawn at.
     */
    cluster?: string;
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
                cluster: source.length === 0 ? item.drawerId : source,
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
            cluster: source,
            status: null,
            degree: 0,
            weight: chunks.length,
        }));
    }

    // A document that is expanded still says which chunks belong to it. Even a
    // single-chunk source keeps its document node: dropping it made the clicked
    // dot vanish and reappear labelled with its chunk's text — the source and
    // the material swapping identities mid-click.
    for (const source of expanded) {
        const chunks = material.filter((item) => item.sourceFile === source);

        if (chunks.length === 0) continue;

        add(documentId(source), () => ({
            id: documentId(source),
            kind: "document",
            label: documentLabel(source),
            cluster: source,
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
    /** A point on the unit sphere. The view spins the sphere and projects it. */
    x: number;
    y: number;
    z: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** A direction on the unit sphere. */
export interface Point {
    x: number;
    y: number;
    z: number;
}

/**
 * The i-th of n directions on a Fibonacci sphere: evenly spread, no simulation,
 * same input same globe.
 */
function fibonacciPoint(index: number, total: number): Point {
    const y = 1 - (2 * (index + 0.5)) / Math.max(total, 1);
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * GOLDEN_ANGLE;

    return { x: ring * Math.cos(angle), y, z: ring * Math.sin(angle) };
}

/** Two directions at right angles to a point: the plane its cap spreads in. */
function tangentBasis(point: Point): [Point, Point] {
    // Any helper not parallel to the point will do; near the poles use east.
    const helper: Point =
        Math.abs(point.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const u = normalize(cross(helper, point));

    return [u, cross(point, u)];
}

/** A point `away` radians from `centre`, in the tangent direction `angle`. */
function capPoint(
    centre: Point,
    basis: [Point, Point],
    angle: number,
    away: number,
): Point {
    const [u, v] = basis;
    const sin = Math.sin(away);

    return {
        x: centre.x * Math.cos(away) + (u.x * Math.cos(angle) + v.x * Math.sin(angle)) * sin,
        y: centre.y * Math.cos(away) + (u.y * Math.cos(angle) + v.y * Math.sin(angle)) * sin,
        z: centre.z * Math.cos(away) + (u.z * Math.cos(angle) + v.z * Math.sin(angle)) * sin,
    };
}

function cross(a: Point, b: Point): Point {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function normalize(point: Point): Point {
    const length = Math.hypot(point.x, point.y, point.z) || 1;

    return { x: point.x / length, y: point.y / length, z: point.z / length };
}

/**
 * Where each node sits on the globe, worked out without a physics loop.
 *
 * Deterministic — the same library lands in the same places on every open — and
 * stable under interaction, which the flat disc was not: it moved an opened
 * document to the middle and pushed everyone else outward, so the dot that was
 * just clicked was the one dot that flew away. Here a cluster's place is keyed
 * by its source file and ordered by its chunk count, neither of which changes
 * when the document is opened: the clicked dot stays exactly where it is and
 * its chunks come out in a cap around it.
 *
 * Clusters — one per source document — take Fibonacci-sphere directions,
 * largest first. A conclusion sits beside the centroid of the evidence it
 * cites, stepped a little aside so it never covers a lone cited document; it is
 * not pulled anywhere central, because stacking the well-cited conclusions in
 * the middle of the picture was the old layout's way of saying nothing. A
 * conclusion with no visible citations takes a Fibonacci direction of its own
 * rather than a privileged spot.
 */
export function placeGraph(graph: MemoryGraph): PlacedNode[] {
    const placed = new Map<string, PlacedNode>();
    const satellites = graph.nodes.filter((node) => node.kind !== "conclusion");
    const conclusions = graph.nodes.filter((node) => node.kind === "conclusion");

    // One cluster per source, keyed by the source itself: the key is the same
    // whether the document is drawn as one dot or as a dot with chunks around it.
    const groups = new Map<string, GraphNode[]>();
    for (const node of satellites) {
        const key = node.cluster ?? node.id;
        const members = groups.get(key) ?? [];
        members.push(node);
        groups.set(key, members);
    }

    // Ordered by how much the cluster stands for — its document's chunk count,
    // which opening the document does not change — so expansion cannot reshuffle
    // the ordering either.
    const bulk = (members: GraphNode[]) =>
        members.find((member) => member.kind === "document")?.weight ??
        members.length;
    const clusters = [...groups.entries()].sort(
        (left, right) =>
            bulk(right[1]) - bulk(left[1]) || left[0].localeCompare(right[0]),
    );

    clusters.forEach(([, members], index) => {
        const centre = fibonacciPoint(index, clusters.length);
        // The document is its cluster's fixed point: clicked open, it stays put
        // and the chunks come out around it.
        const doc = members.find((member) => member.kind === "document");

        if (doc) placed.set(doc.id, { ...doc, ...centre });

        const rest = members
            .filter((member) => member !== doc)
            .sort((leftNode, rightNode) => leftNode.id.localeCompare(rightNode.id));
        // Room enough for an opened document, in radians of cap: wide enough to
        // read, never so wide it wraps the globe.
        const cap = Math.min(0.55, 0.1 + Math.sqrt(rest.length) * 0.06);
        const basis = tangentBasis(centre);

        rest.forEach((node, position) => {
            const step = Math.sqrt((position + 0.5) / rest.length);
            // Never closer than the document's own dot, or the first chunks of a
            // large file are drawn underneath it.
            const away = Math.max(0.055, cap * step);

            placed.set(node.id, {
                ...node,
                ...capPoint(centre, basis, position * GOLDEN_ANGLE, away),
            });
        });
    });

    // Ordered by id so each conclusion steps to the same side on every open.
    const ordered = [...conclusions].sort((left, right) =>
        left.id.localeCompare(right.id),
    );
    ordered.forEach((conclusion, index) => {
        const cited = graph.edges
            .filter((edge) => edge.from === conclusion.id)
            .map((edge) => placed.get(edge.to))
            .filter((node): node is PlacedNode => node !== undefined);

        if (cited.length === 0) {
            // Nothing to sit beside: a direction of its own, phase-shifted off
            // the clusters' sequence so two uncited conclusions never stack.
            placed.set(conclusion.id, {
                ...conclusion,
                ...fibonacciPoint(index + 0.5, ordered.length + 1),
            });
            return;
        }

        const centroid = normalize({
            x: cited.reduce((sum, node) => sum + node.x, 0),
            y: cited.reduce((sum, node) => sum + node.y, 0),
            z: cited.reduce((sum, node) => sum + node.z, 0),
        });

        placed.set(conclusion.id, {
            ...conclusion,
            ...capPoint(
                centroid,
                tangentBasis(centroid),
                index * GOLDEN_ANGLE,
                0.09,
            ),
        });
    });

    // Anything the loops above do not know — nothing today, kept as the net.
    let leftover = 0;
    for (const node of graph.nodes) {
        if (placed.has(node.id)) continue;

        placed.set(node.id, {
            ...node,
            ...fibonacciPoint(leftover++ + 0.25, graph.nodes.length),
        });
    }

    return [...placed.values()];
}

/**
 * The picture partway between two arrangements.
 *
 * A click that expands a document or reflows the layout used to teleport every
 * dot, which reads as the map being reshuffled rather than the same map moving.
 * Motion is the statement that these are the same nodes: each one travels from
 * where it was drawn last frame to where the layout now puts it.
 *
 * A node with no previous position enters from its anchor — a chunk from the
 * document it came out of — so an expansion blooms outward from the dot that was
 * clicked instead of popping in at its destination. A node with neither history
 * nor anchor has nowhere to come from and simply stands where it belongs.
 */
export function motionFrame(
    previous: ReadonlyMap<string, Point>,
    target: PlacedNode[],
    anchors: ReadonlyMap<string, string>,
    progress: number,
): PlacedNode[] {
    return target.map((node) => {
        const from =
            previous.get(node.id) ??
            previous.get(anchors.get(node.id) ?? "") ??
            node;

        return {
            ...node,
            x: from.x + (node.x - from.x) * progress,
            y: from.y + (node.y - from.y) * progress,
            z: from.z + (node.z - from.z) * progress,
        };
    });
}
