import { describe, expect, it, vi } from "vitest";
import { tauriCore } from "@/common/lib/tauri";
import { detectMemoryWorkspace } from "./memory-client";

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: vi.fn(),
}));

describe("memory-client", () => {
  it("invokes memory workspace detection with rootPath", async () => {
    const invoke = vi.fn(async () => ({
      mode: "memory",
      hasMemory: true,
      canInitialize: false,
      missingPaths: [],
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    const result = await detectMemoryWorkspace("/tmp/ws");

    expect(result.hasMemory).toBe(true);
    expect(invoke).toHaveBeenCalledWith("memory_detect_workspace", {
      rootPath: "/tmp/ws",
    });
  });
});
