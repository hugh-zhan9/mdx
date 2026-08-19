import { describe, expect, it } from "vitest";
import { buildMemoryGraph, placeGraph } from "./memory-graph";
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

        expect(graph.edges).toEqual([
            { from: "ev_1", to: "ev_2", kind: "similar" },
        ]);
    });

    it("places the same library in the same places twice", () => {
        // A physics simulation would land this somewhere different on every open,
        // which makes a map nobody can learn.
        const graph = buildMemoryGraph(
            [material("ev_1", "决策 A"), material("ev_2", "决策 B")],
            [conclusion()],
        );

        const first = placeGraph(graph, 900, 560);
        const second = placeGraph(graph, 900, 560);

        expect(first).toEqual(second);
        // Every node the graph holds got a place inside the canvas.
        expect(first).toHaveLength(graph.nodes.length);
        for (const node of first) {
            expect(node.x).toBeGreaterThanOrEqual(0);
            expect(node.x).toBeLessThanOrEqual(900);
            expect(node.y).toBeGreaterThanOrEqual(0);
            expect(node.y).toBeLessThanOrEqual(560);
        }
    });
});
