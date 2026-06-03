import { describe, expect, it } from "vitest";
import {
    createAutoProcessingTracker,
    shouldStartAutoProcessing,
} from "./auto-processing";

describe("shouldStartAutoProcessing", () => {
    it("starts only for ready configured LLM Wiki workspaces", () => {
        expect(
            shouldStartAutoProcessing({
                isReady: true,
                mode: "llmWiki",
                hasApiKey: true,
                activeOperation: null,
                canAutoProcess: true,
                rootPath: "/wiki",
            }),
        ).toBe(true);

        expect(
            shouldStartAutoProcessing({
                isReady: true,
                mode: "ordinary",
                hasApiKey: true,
                activeOperation: null,
                canAutoProcess: true,
                rootPath: "/wiki",
            }),
        ).toBe(false);
        expect(
            shouldStartAutoProcessing({
                isReady: true,
                mode: "llmWiki",
                hasApiKey: false,
                activeOperation: null,
                canAutoProcess: true,
                rootPath: "/wiki",
            }),
        ).toBe(false);
        expect(
            shouldStartAutoProcessing({
                isReady: false,
                mode: "llmWiki",
                hasApiKey: true,
                activeOperation: null,
                canAutoProcess: true,
                rootPath: "/wiki",
            }),
        ).toBe(false);
    });

    it("does not start while another long-running operation is active", () => {
        expect(
            shouldStartAutoProcessing({
                isReady: true,
                mode: "llmWiki",
                hasApiKey: true,
                activeOperation: "rescan",
                canAutoProcess: true,
                rootPath: "/wiki",
            }),
        ).toBe(false);
    });

    it("waits until startup file loading has settled", () => {
        expect(
            shouldStartAutoProcessing({
                isReady: true,
                mode: "llmWiki",
                hasApiKey: true,
                activeOperation: null,
                canAutoProcess: false,
                rootPath: "/wiki",
            }),
        ).toBe(false);
    });
});

describe("createAutoProcessingTracker", () => {
    it("allows one automatic processing run per root path", () => {
        const tracker = createAutoProcessingTracker();

        expect(tracker.claim("/wiki-a")).toBe(true);
        expect(tracker.claim("/wiki-a")).toBe(false);
        expect(tracker.claim("/wiki-b")).toBe(true);
    });

    it("ignores missing root paths", () => {
        const tracker = createAutoProcessingTracker();

        expect(tracker.claim("")).toBe(false);
    });
});
