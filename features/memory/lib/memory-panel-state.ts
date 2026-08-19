export type MemoryPanelTabId = "workbench" | "graph" | "context" | "setup";

/**
 * How a tab's content is laid out.
 *
 * `page` scrolls; `viewport` is exactly the height of the panel and moves itself —
 * two columns that scroll separately, a canvas that pans. Declared with the tab
 * because it is a property of the view, and deciding it at the place that renders
 * the tabs is how it ended up decided twice: once in a component and once as a
 * blanket CSS rule that capped every tab's width.
 */
export type MemoryPanelTabShape = "page" | "viewport";

export interface MemoryPanelTab {
  id: MemoryPanelTabId;
  label: string;
  disabled: boolean;
  shape: MemoryPanelTabShape;
}

/**
 * The panel's tabs, grouped by how often a person touches them.
 *
 * The work is one place: material and the conclusions drawn from it, side by
 * side, because selecting material and watching a candidate appear is one motion
 * and it used to be two tabs. Next to it is the only screen that answers "did
 * that adoption actually reach an agent". Everything else — turning memory on,
 * the model, agent installs, backups, repairs, purges — is set up once or opened
 * when something is broken, so it shares one page rather than three tabs.
 *
 * The old six were grouped by the data model instead: overview, material,
 * conclusions, context, integrations, diagnostics. That is a map of the backend,
 * not of anything a user does.
 */
export function buildMemoryPanelTabs(status: {
  enabled: boolean;
}): MemoryPanelTab[] {
  return [
    {
      id: "workbench",
      label: "素材与结论",
      disabled: !status.enabled,
      shape: "viewport",
    },
    // A tab rather than a toggle inside the workbench: it was a segmented control
    // sitting directly under the tab bar and styled like it, so nobody could tell
    // which of the two switched pages — and the graph went unfound.
    { id: "graph", label: "关系图", disabled: !status.enabled, shape: "viewport" },
    {
      id: "context",
      label: "Agent 会读到什么",
      disabled: !status.enabled,
      shape: "page",
    },
    // Never disabled: it is where memory gets turned on in the first place, and
    // where a broken library is explained.
    { id: "setup", label: "设置与诊断", disabled: false, shape: "page" },
  ];
}
