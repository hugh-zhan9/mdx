import { afterEach, describe, expect, it, vi } from "vitest";

import { exportPublishingPdf } from "./publishing-export";
import { capturePublishingSnapshot } from "./publishing-snapshot";
import type {
    PublishingError,
    PublishingLayoutDocument,
    PublishingLayoutPort,
    PublishingLayoutSnapshot,
    PublishingPageSetup,
    PublishingPdfPayload,
    PublishingPdfTransport,
} from "./types";

const PAGE: PublishingPageSetup = {
    widthPt: 595,
    heightPt: 842,
    marginTopPt: 72,
    marginRightPt: 72,
    marginBottomPt: 72,
    marginLeftPt: 72,
    fontEmbedMode: "subset",
};

const MARKDOWN = "# Title\n\nBody with [a link](https://example.com).\n";

interface Harness {
    layoutCalls: PublishingLayoutDocument[];
    payloads: PublishingPdfPayload[];
    printCalls: number;
}

function emptySnapshot(revision: number): PublishingLayoutSnapshot {
    return { revision, lines: [], canvasDrawOps: [] };
}

function run(options: {
    markdown?: string;
    revision?: number;
    outputPath?: string;
    layoutTimeoutMs?: number;
    layout: (
        document: PublishingLayoutDocument,
    ) => Promise<PublishingLayoutSnapshot>;
    transport: PublishingPdfTransport["export"];
    harness: Harness;
}) {
    const layout: PublishingLayoutPort = {
        async layout(document) {
            options.harness.layoutCalls.push(document);
            return options.layout(document);
        },
    };
    const transport: PublishingPdfTransport = {
        async export(payload) {
            options.harness.payloads.push(payload);
            return options.transport(payload);
        },
    };

    return exportPublishingPdf({
        snapshot: capturePublishingSnapshot({
            documentId: "note.md",
            revision: options.revision ?? 3,
            markdown: options.markdown ?? MARKDOWN,
        }),
        rootPath: "/workspace",
        outputPath: options.outputPath ?? "/workspace/note.pdf",
        viewport: { width: 800, height: 600 },
        page: PAGE,
        layout,
        transport,
        layoutTimeoutMs: options.layoutTimeoutMs ?? 1000,
    });
}

function newHarness(): Harness {
    const harness: Harness = { layoutCalls: [], payloads: [], printCalls: 0 };
    const print = () => {
        harness.printCalls += 1;
    };

    // Both spellings a disguised print fallback could reach for.
    vi.stubGlobal("print", print);
    vi.stubGlobal("window", { print });
    return harness;
}

function succeeds(): PublishingPdfTransport["export"] {
    return async () => ({ ok: true, pageCount: 2, warnings: ["missing glyph"] });
}

function rejectsWith(error: PublishingError): PublishingPdfTransport["export"] {
    return async () => ({ ok: false, error });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("a successful export", () => {
    it("reports the pages, the warnings and the revision it was captured for", async () => {
        const harness = newHarness();

        const outcome = await run({
            harness,
            layout: async (document) => emptySnapshot(document.revision),
            transport: succeeds(),
        });

        expect(outcome.ok).toBe(true);
        expect(outcome.revision).toBe(3);
        expect(outcome.documentId).toBe("note.md");

        if (!outcome.ok) {
            throw new Error("expected a successful export");
        }

        expect(outcome.value.pageCount).toBe(2);
        expect(outcome.warnings).toEqual(["missing glyph"]);
        expect(outcome.value.requestKey).toContain("note.md");
        expect(outcome.value.requestKey).toContain("3");
    });

    it("keys the request by both the document and the revision", async () => {
        const harness = newHarness();

        await run({
            harness,
            revision: 3,
            layout: async (document) => emptySnapshot(document.revision),
            transport: succeeds(),
        });
        await run({
            harness,
            revision: 4,
            layout: async (document) => emptySnapshot(document.revision),
            transport: succeeds(),
        });

        const [first, second] = harness.payloads;
        expect(first.requestKey).not.toBe(second.requestKey);
        expect(first.documentId).toBe("note.md");
        expect(first.revision).toBe(3);
        expect(second.revision).toBe(4);
    });

    it("sends the exporter no way to address a caret, a selection or a hit test", async () => {
        const harness = newHarness();

        await run({
            harness,
            layout: async (document) => ({
                revision: document.revision,
                lines: [
                    {
                        id: "line-0",
                        blockId: "heading-0",
                        y: 0,
                        baseline: 12,
                        height: 16,
                        textRuns: [
                            {
                                blockId: "heading-0",
                                left: 0,
                                baseline: 12,
                                width: 40,
                                height: 16,
                                fontFamily: "Helvetica",
                                fontSize: 14,
                                text: "Title",
                            },
                        ],
                    },
                ],
                canvasDrawOps: [],
            }),
            transport: succeeds(),
        });

        const wire = JSON.parse(harness.payloads[0].layoutSnapshotJson) as Record<
            string,
            unknown
        >;

        expect(wire.hitTestEntries).toEqual([]);
        expect(wire.caretAnchors).toEqual([]);
        expect(wire.selectionGeometries).toEqual([]);
        expect(wire.mirrorBlocks).toEqual([]);
        expect(harness.payloads[0].layoutSnapshotJson).not.toContain("pmFrom");
        expect(harness.payloads[0].layoutDocumentJson).not.toContain("pmFrom");
    });
});

describe("a publishing failure is reported and nothing else happens", () => {
    it("reports a layout that never finishes as a timeout and exports nothing", async () => {
        const harness = newHarness();

        const outcome = await run({
            harness,
            layoutTimeoutMs: 10,
            layout: () => new Promise<PublishingLayoutSnapshot>(() => {}),
            transport: succeeds(),
        });

        expect(outcome.ok).toBe(false);
        if (outcome.ok) {
            throw new Error("expected the layout timeout to surface");
        }

        expect(outcome.error.code).toBe("layout_timeout");
        expect(outcome.revision).toBe(3);
        expect(harness.payloads).toEqual([]);
        expect(harness.printCalls).toBe(0);
    });

    it("reports a layout crash and exports nothing", async () => {
        const harness = newHarness();

        const outcome = await run({
            harness,
            layout: async () => {
                throw new Error("layout worker died");
            },
            transport: succeeds(),
        });

        expect(outcome.ok).toBe(false);
        if (outcome.ok) {
            throw new Error("expected the layout crash to surface");
        }

        expect(outcome.error.code).toBe("layout_failed");
        expect(outcome.error.message).toContain("layout worker died");
        expect(harness.payloads).toEqual([]);
        expect(harness.printCalls).toBe(0);
    });

    it("refuses a layout computed for a different revision", async () => {
        const harness = newHarness();

        const outcome = await run({
            harness,
            revision: 3,
            layout: async () => emptySnapshot(9),
            transport: succeeds(),
        });

        expect(outcome.ok).toBe(false);
        if (outcome.ok) {
            throw new Error("expected the revision mismatch to surface");
        }

        expect(outcome.error.code).toBe("revision_mismatch");
        expect(harness.payloads).toEqual([]);
    });

    it.each([
        ["an image the exporter could not read", "image_read_failed"],
        ["a font the exporter could not use", "font_failed"],
        ["an output path the exporter may not write", "output_path_denied"],
    ] as const)("reports %s", async (_name, code) => {
        const harness = newHarness();

        const outcome = await run({
            harness,
            layout: async (document) => emptySnapshot(document.revision),
            transport: rejectsWith({ code, message: "native said no" }),
        });

        expect(outcome.ok).toBe(false);
        if (outcome.ok) {
            throw new Error(`expected ${code} to surface`);
        }

        expect(outcome.error.code).toBe(code);
        expect(outcome.error.message).toBe("native said no");
        expect(outcome.documentId).toBe("note.md");
        expect(outcome.revision).toBe(3);
    });

    it("reports a transport that threw rather than answered", async () => {
        const harness = newHarness();

        const outcome = await run({
            harness,
            layout: async (document) => emptySnapshot(document.revision),
            transport: async () => {
                throw new Error("the command channel is gone");
            },
        });

        expect(outcome.ok).toBe(false);
        if (outcome.ok) {
            throw new Error("expected the transport failure to surface");
        }

        expect(outcome.error.code).toBe("export_failed");
        expect(outcome.error.message).toContain("the command channel is gone");
    });

    it("refuses an output path that is not a PDF before laying anything out", async () => {
        const harness = newHarness();

        const outcome = await run({
            harness,
            outputPath: "/workspace/note.txt",
            layout: async (document) => emptySnapshot(document.revision),
            transport: succeeds(),
        });

        expect(outcome.ok).toBe(false);
        if (outcome.ok) {
            throw new Error("expected the output path to be refused");
        }

        expect(outcome.error.code).toBe("invalid_output_path");
        expect(harness.layoutCalls).toEqual([]);
        expect(harness.payloads).toEqual([]);
    });

    it("never turns a failed native export into a browser print", async () => {
        const harness = newHarness();

        const outcome = await run({
            harness,
            layout: async (document) => emptySnapshot(document.revision),
            transport: rejectsWith({
                code: "export_failed",
                message: "lopdf could not save",
            }),
        });

        expect(outcome.ok).toBe(false);
        expect(harness.printCalls).toBe(0);
    });
});

describe("an export is bound to the revision it captured", () => {
    it("ignores edits made while the layout is still running", async () => {
        const harness = newHarness();
        // The live session object, handed to the export exactly as a session
        // would hand it: if the export held this object instead of a copy of
        // it, the edit below would reach the payload.
        const session = {
            documentId: "note.md",
            revision: 3,
            markdown: "# Captured\n",
        };
        let enteredLayout: () => void = () => {};
        const entered = new Promise<void>((resolve) => {
            enteredLayout = resolve;
        });
        let releaseLayout: (snapshot: PublishingLayoutSnapshot) => void = () => {};
        const held = new Promise<PublishingLayoutSnapshot>((resolve) => {
            releaseLayout = resolve;
        });

        const inFlight = exportPublishingPdf({
            snapshot: session,
            rootPath: "/workspace",
            outputPath: "/workspace/note.pdf",
            viewport: { width: 800, height: 600 },
            page: PAGE,
            layout: {
                async layout(document) {
                    harness.layoutCalls.push(document);
                    enteredLayout();
                    return held;
                },
            },
            transport: {
                async export(payload) {
                    harness.payloads.push(payload);
                    return { ok: true, pageCount: 2, warnings: [] };
                },
            },
            layoutTimeoutMs: 1000,
        });

        // The edit provably lands while the export is inside the layout stage.
        await entered;
        session.markdown = "# Edited while exporting\n";
        session.revision = 4;
        releaseLayout(emptySnapshot(3));

        const outcome = await inFlight;

        expect(outcome.ok).toBe(true);
        expect(outcome.revision).toBe(3);
        expect(harness.layoutCalls[0].revision).toBe(3);
        expect(harness.layoutCalls[0].blocks[0].inlines[0].text).toBe("Captured");
        expect(harness.payloads[0].revision).toBe(3);
        expect(harness.payloads[0].layoutDocumentJson).toContain("Captured");
        expect(harness.payloads[0].layoutDocumentJson).not.toContain(
            "Edited while exporting",
        );
        expect(session.revision).toBe(4);
        expect(session.markdown).toBe("# Edited while exporting\n");
    });
});
