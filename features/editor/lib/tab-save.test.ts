import { describe, expect, it } from "vitest";
import { planFirstSave, resolveUntitledName } from "./tab-save";

describe("resolveUntitledName", () => {
    it("uses Untitled.md then Untitled1.md, Untitled2.md", () => {
        expect(resolveUntitledName([])).toBe("Untitled.md");
        expect(resolveUntitledName(["Untitled.md"])).toBe("Untitled1.md");
        expect(resolveUntitledName(["Untitled.md", "Untitled1.md"])).toBe(
            "Untitled2.md",
        );
    });
});

describe("requiresRenameOnFirstSave", () => {
    it("prompts for a formal file name before first write", () => {
        const result = planFirstSave({
            currentPath: "/tmp/ws/Untitled.md",
            requestedName: "Notes.md",
            existingNames: ["Untitled.md"],
            needsRenameOnFirstSave: true,
        });

        expect(result).toEqual({
            kind: "rename_then_save",
            newPath: "/tmp/ws/Notes.md",
        });
    });

    it("rejects keeping the temporary untitled name", () => {
        const result = planFirstSave({
            currentPath: "/tmp/ws/Untitled.md",
            requestedName: "Untitled.md",
            existingNames: ["Untitled.md"],
            needsRenameOnFirstSave: true,
        });

        expect(result).toEqual({
            kind: "invalid_name",
            reason: "请输入正式文件名。",
        });
    });
});
