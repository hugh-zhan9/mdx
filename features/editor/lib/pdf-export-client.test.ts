import { describe, expect, it, vi } from "vitest";
import { exportPdf } from "./pdf-export-client";

vi.mock("@/common/lib/tauri", () => ({
    tauriCore: async () => ({
        invoke: vi.fn(async () => ({ pageCount: 1, warnings: [], exportMs: 3 })),
    }),
}));

describe("exportPdf", () => {
    it("invokes the layout_export_pdf command", async () => {
        const result = await exportPdf("/tmp/ws", { documentId: "doc-1" } as never);
        expect(result.pageCount).toBe(1);
    });
});
