import { describe, expect, it } from "vitest";
import {
    buildMemoryGraph,
    motionFrame,
    placeGraph,
    type PlacedNode,
} from "./memory-graph";
import type { StoredItem } from "./types";

function material(id: string, text: string): StoredItem {
    return {
        drawerId: id,
        kind: "material",
        room: "notes",
        sourceFile: `notes/${id}.md`,
        addedAt: "1786968000",
        importance: 1,
        statement: null,
        status: null,
        excerpt: text,
        supportingRefs: [],
        verificationRefs: [],
        counterexampleRefs: [],
    };
}

function placedNode(id: string, x: number, y: number, z = 0): PlacedNode {
    return {
        id,
        kind: "material",
        label: id,
        status: null,
        degree: 0,
        x,
        y,
        z,
    };
}

function conclusion(overrides: Partial<StoredItem> = {}): StoredItem {
    return {
        drawerId: "kn_1",
        kind: "conclusion",
        room: "review",
        sourceFile: null,
        addedAt: "1786969000",
        importance: 2,
        statement: "锁只覆盖入队临界区",
        status: "promoted",
        excerpt: "三条决策共同确立了这条边界。",
        supportingRefs: ["ev_1", "ev_2"],
        verificationRefs: ["cf_1"],
        counterexampleRefs: [],
        ...overrides,
    };
}

/**
 * The graph is grown from conclusions outwards, because a citation is the only
 * relation the library holds. These pin that: nothing is invented for an id the
 * page does not have, and the same data always lands in the same place.
 */
describe("the memory relation graph", () => {
    it("draws a conclusion with the documents it stands on", () => {
        // A citation lands on whatever stands in for the chunk: at the default grain
        // that is the document, which is what makes "these files support this" the
        // first thing the picture says.
        const graph = buildMemoryGraph(
            [material("ev_1", "决策 A"), material("ev_2", "决策 B")],
            [conclusion()],
        );

        expect(graph.nodes.map((node) => node.kind).sort()).toEqual([
            "conclusion",
            "document",
            "document",
            "verification",
        ]);
        expect(graph.edges).toEqual([
            { from: "kn_1", to: "doc:notes/ev_1.md", kind: "supports" },
            { from: "kn_1", to: "doc:notes/ev_2.md", kind: "supports" },
            { from: "kn_1", to: "cf_1", kind: "verifies" },
        ]);
        expect(graph.missing).toBe(0);
    });

    it("draws one line when two chunks of one file support a conclusion", () => {
        // Otherwise a twelve-chunk document supporting one conclusion draws twelve
        // identical lines to the same dot.
        const graph = buildMemoryGraph(
            [
                { ...material("ev_1", "第一段"), sourceFile: "notes/one.md" },
                { ...material("ev_2", "第二段"), sourceFile: "notes/one.md" },
            ],
            [conclusion({ supportingRefs: ["ev_1", "ev_2"], verificationRefs: [] })],
        );

        expect(
            graph.edges.filter((edge) => edge.kind === "supports"),
        ).toEqual([
            { from: "kn_1", to: "doc:notes/one.md", kind: "supports" },
        ]);
    });

    it("counts cited material it cannot see rather than inventing a node", () => {
        // The panel holds a window over the library, and a node labelled from
        // nothing would be a picture of something that is not there.
        const graph = buildMemoryGraph([material("ev_1", "决策 A")], [conclusion()]);

        expect(graph.missing).toBe(1);
        expect(graph.nodes.some((node) => node.id === "ev_2")).toBe(false);
    });

    it("marks a counterexample as its own kind of edge", () => {
        const graph = buildMemoryGraph(
            [material("ev_1", "决策 A"), material("cx_1", "反例")],
            [conclusion({ supportingRefs: ["ev_1"], counterexampleRefs: ["cx_1"] })],
        );

        expect(
            graph.edges.find((edge) => edge.to === "doc:notes/cx_1.md")?.kind,
        ).toBe("contradicts");
    });

    it("stands a document in for the chunks it produced", () => {
        // The default grain: a project's material is mostly chunks of a few files,
        // and a dot each turned the picture into a thousand identical points. One
        // dot per document, sized by how much it holds, is the level a person can
        // read — chunks are one click away.
        const chunks = [
            { ...material("ev_1", "第一段"), sourceFile: "notes/one.md" },
            { ...material("ev_2", "第二段"), sourceFile: "notes/one.md" },
            { ...material("ev_3", "别处"), sourceFile: "notes/two.md" },
        ];

        const graph = buildMemoryGraph(chunks, []);

        expect(graph.nodes.map((node) => node.kind)).toEqual([
            "document",
            "document",
        ]);
        expect(
            graph.nodes.find((node) => node.label === "one.md")?.weight,
        ).toBe(2);
        // Nothing to join: the document node already says these belong together.
        expect(graph.edges).toEqual([]);
    });

    it("opens one document into its chunks when asked", () => {
        const chunks = [
            { ...material("ev_1", "第一段"), sourceFile: "notes/one.md" },
            { ...material("ev_2", "第二段"), sourceFile: "notes/one.md" },
            { ...material("ev_3", "别处"), sourceFile: "notes/two.md" },
        ];

        const graph = buildMemoryGraph(chunks, [], {
            expanded: new Set(["notes/one.md"]),
        });

        expect(graph.nodes.filter((node) => node.kind === "material")).toHaveLength(
            2,
        );
        // The document stays, holding what it opened into.
        expect(
            graph.edges.filter((edge) => edge.kind === "holds"),
        ).toHaveLength(2);
        // And the other file is still one dot.
        expect(
            graph.nodes.filter((node) => node.kind === "document"),
        ).toHaveLength(2);
    });

    it("draws material even when nothing has been concluded from it", () => {
        // Material is the dimension: a piece of it is a node whether or not anyone
        // has drawn a conclusion from it. Nodes used to appear only when cited,
        // which drew the conclusions' citations and called that the library.
        const graph = buildMemoryGraph(
            [material("ev_1", "决策 A"), material("ev_2", "决策 B")],
            [],
        );

        expect(graph.nodes.map((node) => node.id).sort()).toEqual([
            "doc:notes/ev_1.md",
            "doc:notes/ev_2.md",
        ]);
        // Different files, so nothing yet says these two belong together.
        expect(graph.edges).toEqual([]);
    });

    it("says which chunks an opened document holds, and nothing more", () => {
        // The chunks of one file used to be chained to each other as well. With a
        // document node above them that is the same statement twice: a hundred
        // chunks drew a hundred spokes plus ninety-nine chain links, in one disc.
        const chunks = [
            { ...material("ev_1", "第一段"), sourceFile: "notes/one.md" },
            { ...material("ev_2", "第二段"), sourceFile: "notes/one.md" },
            { ...material("ev_3", "第三段"), sourceFile: "notes/one.md" },
            { ...material("ev_4", "别处"), sourceFile: "notes/two.md" },
        ];

        const graph = buildMemoryGraph(chunks, [], {
            expanded: new Set(["notes/one.md"]),
        });

        expect(graph.edges).toEqual([
            { from: "doc:notes/one.md", to: "ev_1", kind: "holds" },
            { from: "doc:notes/one.md", to: "ev_2", kind: "holds" },
            { from: "doc:notes/one.md", to: "ev_3", kind: "holds" },
        ]);
    });

    it("keeps what a search called close apart from what a person asserted", () => {
        // Solid lines are assertions someone made; this one is the machine's
        // opinion, and the graph has to be able to say which is which.
        const graph = buildMemoryGraph(
            [
                { ...material("ev_1", "A"), sourceFile: "a.md" },
                { ...material("ev_2", "B"), sourceFile: "b.md" },
            ],
            [],
            { similar: { ev_1: ["ev_2", "ev_missing"] }, expanded: new Set(["a.md", "b.md"]) },
        );

        expect(graph.edges.filter((edge) => edge.kind === "similar")).toEqual([
            { from: "ev_1", to: "ev_2", kind: "similar" },
        ]);
    });

    it("keeps a single-chunk document when it is opened", () => {
        // Dropping the document node for a one-chunk source made the clicked
        // dot vanish and reappear labelled with its chunk's text — the source
        // and the material swapping identities mid-click.
        const graph = buildMemoryGraph(
            [{ ...material("ev_1", "唯一一段"), sourceFile: "notes/solo.md" }],
            [],
            { expanded: new Set(["notes/solo.md"]) },
        );

        expect(graph.nodes.map((node) => node.kind).sort()).toEqual([
            "document",
            "material",
        ]);
        expect(graph.edges).toEqual([
            { from: "doc:notes/solo.md", to: "ev_1", kind: "holds" },
        ]);
    });

    it("moves a node from where it was drawn to where it now belongs", () => {
        // A layout change is the same map moving, not a new map: mid-motion the
        // node is partway along the straight line between the two arrangements.
        const target: PlacedNode[] = [placedNode("ev_1", 100, 200)];
        const previous = new Map([["ev_1", { x: 0, y: 0, z: 0 }]]);

        const midway = motionFrame(previous, target, new Map(), 0.5);

        expect(midway).toEqual([placedNode("ev_1", 50, 100)]);
        expect(motionFrame(previous, target, new Map(), 0)[0]).toMatchObject({
            x: 0,
            y: 0,
        });
        expect(motionFrame(previous, target, new Map(), 1)[0]).toMatchObject({
            x: 100,
            y: 200,
        });
    });

    it("blooms an entering chunk out of its document", () => {
        // A chunk that was not drawn last frame enters from where its document
        // stood, so expanding is seen as the document opening rather than as
        // dots popping in at their destinations.
        const target: PlacedNode[] = [placedNode("ev_1", 300, 300)];
        const previous = new Map([["doc:notes/one.md", { x: 40, y: 60, z: 0 }]]);
        const anchors = new Map([["ev_1", "doc:notes/one.md"]]);

        expect(motionFrame(previous, target, anchors, 0)[0]).toMatchObject({
            x: 40,
            y: 60,
        });
    });

    it("stands a node with no history where it belongs", () => {
        // Nothing to come from: the first picture is drawn in place.
        const target: PlacedNode[] = [placedNode("kn_1", 70, 80)];

        expect(motionFrame(new Map(), target, new Map(), 0)[0]).toMatchObject({
            x: 70,
            y: 80,
        });
    });

    it("places the same library in the same places twice", () => {
        // A physics simulation would land this somewhere different on every open,
        // which makes a map nobody can learn.
        const graph = buildMemoryGraph(
            [material("ev_1", "决策 A"), material("ev_2", "决策 B")],
            [conclusion()],
        );

        const first = placeGraph(graph);
        const second = placeGraph(graph);

        expect(first).toEqual(second);
        // Every node the graph holds got a place on the unit sphere.
        expect(first).toHaveLength(graph.nodes.length);
        for (const node of first) {
            expect(Math.hypot(node.x, node.y, node.z)).toBeCloseTo(1, 5);
        }
    });

    it("opens a document in place: its dot and every other cluster stay put", () => {
        // The old disc moved an opened document to the middle and pushed the
        // rest outward — the clicked dot was the one dot that flew away. A
        // cluster's place is keyed by its source and ordered by its chunk
        // count, and opening changes neither.
        const chunks = [
            { ...material("ev_1", "第一段"), sourceFile: "notes/one.md" },
            { ...material("ev_2", "第二段"), sourceFile: "notes/one.md" },
            { ...material("ev_3", "别处"), sourceFile: "notes/two.md" },
        ];
        const before = placeGraph(buildMemoryGraph(chunks, []));
        const after = placeGraph(
            buildMemoryGraph(chunks, [], { expanded: new Set(["notes/one.md"]) }),
        );
        const at = (nodes: PlacedNode[], id: string) => {
            const node = nodes.find((candidate) => candidate.id === id);

            if (!node) throw new Error(`Expected ${id} to be placed.`);

            return node;
        };

        for (const id of ["doc:notes/one.md", "doc:notes/two.md"]) {
            expect(at(after, id)).toMatchObject({
                x: at(before, id).x,
                y: at(before, id).y,
                z: at(before, id).z,
            });
        }
    });

    it("seats a conclusion beside its evidence, not in a privileged centre", () => {
        // It used to be pulled 35% towards the canvas centre, which stacked
        // every well-cited conclusion in the middle of the picture.
        const graph = buildMemoryGraph(
            [material("ev_1", "决策 A")],
            [
                conclusion({
                    supportingRefs: ["ev_1"],
                    verificationRefs: [],
                    counterexampleRefs: [],
                }),
            ],
        );
        const nodes = placeGraph(graph);
        const doc = nodes.find((node) => node.id === "doc:notes/ev_1.md")!;
        const seat = nodes.find((node) => node.id === "kn_1")!;
        const gap = Math.acos(
            Math.min(1, doc.x * seat.x + doc.y * seat.y + doc.z * seat.z),
        );

        // A step aside — off the document's dot, but nowhere near across the ball.
        expect(gap).toBeGreaterThan(0.02);
        expect(gap).toBeLessThan(0.3);
    });

    it("spreads uncited conclusions out instead of stacking them", () => {
        // Conclusions whose citations are outside the loaded window all sat on
        // one privileged centre point, on top of each other.
        const graph = buildMemoryGraph(
            [],
            [
                conclusion({ drawerId: "kn_1", verificationRefs: [] }),
                conclusion({ drawerId: "kn_2", verificationRefs: [] }),
            ],
        );
        const [first, second] = placeGraph(graph);
        const apart = Math.hypot(
            first.x - second.x,
            first.y - second.y,
            first.z - second.z,
        );

        expect(apart).toBeGreaterThan(0.5);
    });
});
