// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildCliFrontendHeartbeatPayload } from "./cli-sync";
import type { WorkspaceState } from "./types";

describe("buildCliFrontendHeartbeatPayload", () => {
  it("reports whether the workspace root is mounted", () => {
    const workspace = createWorkspaceState("/tmp/wiki");

    expect(buildCliFrontendHeartbeatPayload(workspace)).toMatchObject({
      root_path: "/tmp/wiki",
      has_workspace: true,
      root_present: false,
    });

    const root = document.createElement("main");
    root.setAttribute("data-mdx-root", "");
    document.body.append(root);

    expect(buildCliFrontendHeartbeatPayload(workspace)).toMatchObject({
      root_path: "/tmp/wiki",
      has_workspace: true,
      root_present: true,
    });

    root.remove();
  });

  it("keeps an empty workspace heartbeat distinct from a dead root", () => {
    const root = document.createElement("main");
    root.setAttribute("data-mdx-root", "");
    document.body.append(root);

    expect(buildCliFrontendHeartbeatPayload(null)).toMatchObject({
      root_path: null,
      has_workspace: false,
      root_present: true,
    });

    root.remove();
  });
});

function createWorkspaceState(rootPath: string): WorkspaceState {
  return {
    rootPath,
    fileTree: [],
    tabs: {},
    tabOrder: [],
    activeTabId: null,
    panel: {
      leftCollapsed: false,
      leftWidth: 280,
      rightCollapsed: false,
      rightWidth: 320,
    },
    search: {
      query: "",
    },
  };
}
