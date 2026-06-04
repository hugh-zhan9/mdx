import { describe, expect, it } from "vitest";

import { shouldOpenFileTreeContextMenuFromClick } from "./file-tree-node";

describe("shouldOpenFileTreeContextMenuFromClick", () => {
    it("treats a Control primary click as a context menu request", () => {
        expect(
            shouldOpenFileTreeContextMenuFromClick({
                button: 0,
                ctrlKey: true,
            }),
        ).toBe(true);
    });

    it("keeps ordinary primary clicks on the normal select path", () => {
        expect(
            shouldOpenFileTreeContextMenuFromClick({
                button: 0,
                ctrlKey: false,
            }),
        ).toBe(false);
    });
});
