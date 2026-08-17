import { describe, expect, it } from "vitest";

import { exportPublishingPdf } from "./publishing-export";
import { publishingPayloadDigest } from "./publishing-layout";
import {
    buildPublishingPreview,
    publishingPreviewDigest,
} from "./publishing-preview";
import { capturePublishingSnapshot } from "./publishing-snapshot";
import type {
    PublishingLayoutPort,
    PublishingPageSetup,
    PublishingPdfPayload,
    PublishingPdfTransport,
} from "./types";

const MIXED_MARKDOWN = [
    "# Release notes",
    "",
    "See the [changelog](https://example.com/changelog) for **details**.",
    "",
    "![red pixel](./.assets/red.png)",
    "",
    "```ts",
    "const total = 1;",
    "```",
    "",
    "$$",
    "E = mc^2",
    "$$",
    "",
    "Inline math $a^2$ and inline `code`.",
    "",
    "- first",
    "- [x] done",
    "",
    "| head | other |",
    "| --- | --- |",
    "| cell | more |",
    "",
].join("\n");

const PAGE: PublishingPageSetup = {
    widthPt: 595,
    heightPt: 842,
    marginTopPt: 72,
    marginRightPt: 72,
    marginBottomPt: 72,
    marginLeftPt: 72,
    fontEmbedMode: "subset",
};

/**
 * A layout engine that answers with deliberately eye-catching geometry.
 *
 * Nothing it reports may appear in a content comparison, so the numbers here
 * are ones a digest could not hide: if a coordinate ever leaked into the
 * comparison, `999999` would show up in it.
 */
function geometryLayoutPort(): PublishingLayoutPort {
    return {
        async layout(request) {
            return {
                revision: request.revision,
                lines: request.blocks.map((block, index) => ({
                    id: `line-${index}`,
                    blockId: block.blockId,
                    y: 999999,
                    baseline: 999999,
                    height: 999999,
                    textRuns: block.inlines.map((run) => ({
                        blockId: block.blockId,
                        left: 999999,
                        baseline: 999999,
                        width: 999999,
                        height: 999999,
                        fontFamily: "Helvetica",
                        fontSize: 999999,
                        text: run.text,
                        link: run.link,
                    })),
                })),
                canvasDrawOps: [],
            };
        },
    };
}

function recordingTransport(): {
    transport: PublishingPdfTransport;
    payloads: PublishingPdfPayload[];
} {
    const payloads: PublishingPdfPayload[] = [];

    return {
        payloads,
        transport: {
            async export(payload) {
                payloads.push(payload);
                return { ok: true, pageCount: 2, warnings: [] };
            },
        },
    };
}

async function exportedPayload(markdown: string): Promise<PublishingPdfPayload> {
    const { transport, payloads } = recordingTransport();
    const outcome = await exportPublishingPdf({
        snapshot: capturePublishingSnapshot({
            documentId: "note.md",
            revision: 3,
            markdown,
        }),
        rootPath: "/workspace",
        outputPath: "/workspace/note.pdf",
        viewport: { width: 800, height: 600 },
        page: PAGE,
        layout: geometryLayoutPort(),
        transport,
        layoutTimeoutMs: 1000,
    });

    expect(outcome.ok).toBe(true);
    expect(payloads).toHaveLength(1);
    return payloads[0];
}

function previewDigestOf(markdown: string): string[] {
    const preview = buildPublishingPreview(
        capturePublishingSnapshot({
            documentId: "note.md",
            revision: 3,
            markdown,
        }),
    );

    if (!preview.ok) {
        throw new Error(`preview failed: ${preview.error.code}`);
    }

    return publishingPreviewDigest(preview.value);
}

describe("screen and PDF agree on content", () => {
    it("sends the exporter exactly the content the preview shows", async () => {
        const payload = await exportedPayload(MIXED_MARKDOWN);

        expect(publishingPayloadDigest(payload)).toEqual(
            previewDigestOf(MIXED_MARKDOWN),
        );
    });

    it("names content families rather than the geometry around them", async () => {
        const digest = publishingPayloadDigest(await exportedPayload(MIXED_MARKDOWN));

        expect(digest).toContain("heading:1");
        expect(digest).toContain("text=Release notes");
        expect(digest).toContain("link=https://example.com/changelog|changelog");
        expect(digest).toContain("image=./.assets/red.png|red pixel");
        expect(digest).toContain("code:ts=const total = 1;");
        expect(digest).toContain("math=E = mc^2");
        expect(digest).toContain("inline_math=a^2");
        expect(digest.join("\n")).not.toContain("999999");
    });

    it.each([
        ["a document that is only an image", "![alt](./a.png)\n"],
        ["a document that is only code", "```sh\nls -a\n```\n"],
        ["a document that is only math", "$$\n1 + 1\n$$\n"],
        ["an empty document", ""],
    ])("agrees on %s", async (_name, markdown) => {
        const payload = await exportedPayload(markdown);

        expect(publishingPayloadDigest(payload)).toEqual(previewDigestOf(markdown));
    });

    it("disagrees when the exporter is told a different link", async () => {
        const payload = await exportedPayload("[label](https://one.example)\n");

        expect(publishingPayloadDigest(payload)).not.toEqual(
            previewDigestOf("[label](https://two.example)\n"),
        );
    });
});
