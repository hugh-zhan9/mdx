import { describe, expect, it } from "vitest";
import type { PersistedAppState, PersistedWorkspaceState } from "./types";
import { findPersistedWorkspaceForRoot } from "./persisted-workspace";

describe("findPersistedWorkspaceForRoot", () => {
    it("prefers the canonical root returned by workspace scanning", () => {
        const canonicalWorkspace = createPersistedWorkspace("/real/ws", 360);
        const requestedWorkspace = createPersistedWorkspace("/link/ws", 280);
        const appState = createPersistedAppState([
            requestedWorkspace,
            canonicalWorkspace,
        ]);

        expect(
            findPersistedWorkspaceForRoot(appState, "/link/ws", "/real/ws"),
        ).toBe(canonicalWorkspace);
    });

    it("falls back to the requested root when the canonical root is unknown", () => {
        const requestedWorkspace = createPersistedWorkspace("/link/ws", 320);
        const appState = createPersistedAppState([requestedWorkspace]);

        expect(
            findPersistedWorkspaceForRoot(appState, "/link/ws", "/real/ws"),
        ).toBe(requestedWorkspace);
    });
});

function createPersistedAppState(
    workspaces: PersistedWorkspaceState[],
): PersistedAppState {
    return {
        stateVersion: 1,
        recentWorkspaceRoot: null,
        workspaces,
        windowSize: {
            width: 900,
            height: 700,
        },
    };
}

function createPersistedWorkspace(
    rootPath: string,
    leftWidth: number,
): PersistedWorkspaceState {
    return {
        rootPath,
        tabs: [],
        activeTabId: null,
        panels: {
            leftCollapsed: false,
            leftWidth,
            rightCollapsed: false,
            rightWidth: 240,
        },
    };
}
