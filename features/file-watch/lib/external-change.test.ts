import { describe, expect, it } from "vitest";
import { createWorkspaceState, workspaceReducer } from "../../workspace/lib/workspace-reducer";
import { decideWorkspaceExternalChange } from "./external-change";
import type { FrontendFileWatchEvent, SelfWriteMarker } from "./types";

describe("decideWorkspaceExternalChange", () => {
    it("reloads a clean open markdown tab when it changes on disk", () => {
        const workspace = openMarkdownTab({
            dirty: false,
            path: "/tmp/ws/Drafts/Idea.md",
            tabId: "tab-1",
        });

        const decision = decideWorkspaceExternalChange({
            workspace,
            event: changed("/tmp/ws//Drafts/Idea.md"),
            selfWrite: null,
        });

        expect(decision).toEqual({
            kind: "reloadCleanTab",
            tabId: "tab-1",
            path: "/tmp/ws/Drafts/Idea.md",
        });
    });

    it("shows a conflict for a dirty open markdown tab when it changes on disk", () => {
        const workspace = openMarkdownTab({
            dirty: true,
            path: "/tmp/ws/Drafts/Idea.md",
            tabId: "tab-1",
        });

        const decision = decideWorkspaceExternalChange({
            workspace,
            event: changed("/tmp/ws//Drafts/Idea.md"),
            selfWrite: null,
        });

        expect(decision).toEqual({
            kind: "showConflict",
            tabId: "tab-1",
            path: "/tmp/ws/Drafts/Idea.md",
        });
    });

    it("reloads a clean open markdown tab when it is recreated on disk", () => {
        const workspace = openMarkdownTab({
            dirty: false,
            path: "/tmp/ws/Drafts/Idea.md",
            tabId: "tab-1",
        });

        const decision = decideWorkspaceExternalChange({
            workspace,
            event: created("/tmp/ws//Drafts/Idea.md"),
            selfWrite: null,
        });

        expect(decision).toEqual({
            kind: "reloadCleanTab",
            tabId: "tab-1",
            path: "/tmp/ws/Drafts/Idea.md",
        });
    });

    it("shows a conflict for a dirty open markdown tab when it is recreated on disk", () => {
        const workspace = openMarkdownTab({
            dirty: true,
            path: "/tmp/ws/Drafts/Idea.md",
            tabId: "tab-1",
        });

        const decision = decideWorkspaceExternalChange({
            workspace,
            event: created("/tmp/ws//Drafts/Idea.md"),
            selfWrite: null,
        });

        expect(decision).toEqual({
            kind: "showConflict",
            tabId: "tab-1",
            path: "/tmp/ws/Drafts/Idea.md",
        });
    });

    it("ignores a delayed self-write change for the same path and fingerprint", () => {
        const workspace = openMarkdownTab({
            dirty: false,
            path: "/tmp/ws/Drafts/Idea.md",
            tabId: "tab-1",
        });
        const selfWrite: SelfWriteMarker = {
            path: "/tmp/ws/Drafts/Idea.md",
            markdown: "saved markdown",
        };

        const decision = decideWorkspaceExternalChange({
            workspace,
            event: changed(
                "/tmp/ws//Drafts/Idea.md",
                "4c2b1e04ab104cebfb35412326e743633a14bf54708ed85d1e951ce7cb184d62",
            ),
            selfWrite,
        });

        expect(decision).toEqual({ kind: "ignore" });
    });

    it("does not ignore a delayed self-write path when the fingerprint differs", () => {
        const workspace = openMarkdownTab({
            dirty: false,
            path: "/tmp/ws/Drafts/Idea.md",
            tabId: "tab-1",
        });
        const selfWrite: SelfWriteMarker = {
            path: "/tmp/ws/Drafts/Idea.md",
            markdown: "saved markdown",
        };

        const decision = decideWorkspaceExternalChange({
            workspace,
            event: changed(
                "/tmp/ws//Drafts/Idea.md",
                "8410f403824a36c4650ccf1a3bb2e603b7e5879ad76a2059422b1405019a134c",
            ),
            selfWrite,
        });

        expect(decision).toEqual({
            kind: "reloadCleanTab",
            tabId: "tab-1",
            path: "/tmp/ws/Drafts/Idea.md",
        });
    });

    it("does not ignore a delayed self-write path when the event has no fingerprint", () => {
        const workspace = openMarkdownTab({
            dirty: false,
            path: "/tmp/ws/Drafts/Idea.md",
            tabId: "tab-1",
        });
        const selfWrite: SelfWriteMarker = {
            path: "/tmp/ws/Drafts/Idea.md",
            markdown: "saved markdown",
        };

        const decision = decideWorkspaceExternalChange({
            workspace,
            event: changed("/tmp/ws//Drafts/Idea.md"),
            selfWrite,
        });

        expect(decision).toEqual({
            kind: "reloadCleanTab",
            tabId: "tab-1",
            path: "/tmp/ws/Drafts/Idea.md",
        });
    });

    it("remaps every open tab under a renamed directory prefix", () => {
        const workspace = openMarkdownTab({
            dirty: false,
            path: "/tmp/ws/Drafts/Idea.md",
            tabId: "tab-1",
        });

        const decision = decideWorkspaceExternalChange({
            workspace,
            event: renamed("/tmp/ws/Drafts", "/tmp/ws/Archive/Drafts"),
            selfWrite: null,
        });

        expect(decision).toEqual({
            kind: "remapPathAndPrefix",
            fromPath: "/tmp/ws/Drafts",
            toPath: "/tmp/ws/Archive/Drafts",
            oldPrefix: "/tmp/ws/Drafts",
            newPrefix: "/tmp/ws/Archive/Drafts",
        });
    });

    it("shows a dirty deleted prompt when an open dirty file is deleted", () => {
        const workspace = openMarkdownTab({
            dirty: true,
            path: "/tmp/ws/Drafts/Idea.md",
            tabId: "tab-1",
        });

        const decision = decideWorkspaceExternalChange({
            workspace,
            event: deleted("/tmp/ws//Drafts/Idea.md"),
            selfWrite: null,
        });

        expect(decision).toEqual({
            kind: "showDeletedPrompt",
            tabId: "tab-1",
            path: "/tmp/ws/Drafts/Idea.md",
            dirty: true,
        });
    });
});

function openMarkdownTab({
    dirty,
    path,
    tabId,
}: {
    dirty: boolean;
    path: string;
    tabId: string;
}) {
    const opened = workspaceReducer(createWorkspaceState("/tmp/ws"), {
        type: "tab/opened",
        tab: {
            tabId,
            path,
            title: "Idea.md",
            dirty: false,
            needsRenameOnFirstSave: false,
            markdown: "saved markdown",
        },
    });

    if (!dirty) {
        return opened;
    }

    return workspaceReducer(opened, {
        type: "tab/contentChanged",
        tabId,
        markdown: "dirty markdown",
    });
}

function changed(path: string, fingerprint?: string): FrontendFileWatchEvent {
    return {
        kind: "changed",
        watchId: "watch-1",
        path,
        ...(fingerprint === undefined ? {} : { fingerprint }),
        eventTime: "2026-06-10T00:00:00.000Z",
    };
}

function deleted(path: string): FrontendFileWatchEvent {
    return {
        kind: "deleted",
        watchId: "watch-1",
        path,
        eventTime: "2026-06-10T00:00:00.000Z",
    };
}

function created(path: string): FrontendFileWatchEvent {
    return {
        kind: "created",
        watchId: "watch-1",
        path,
        eventTime: "2026-06-10T00:00:00.000Z",
    };
}

function renamed(path: string, newPath: string): FrontendFileWatchEvent {
    return {
        kind: "renamed",
        watchId: "watch-1",
        path,
        newPath,
        eventTime: "2026-06-10T00:00:00.000Z",
    };
}
