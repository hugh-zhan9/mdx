import { normalizeWorkspacePath } from "../../workspace/lib/path";

export interface FirstSavePlanInput {
    currentPath: string;
    requestedName: string;
    existingNames: readonly string[];
    needsRenameOnFirstSave: boolean;
}

export type FirstSavePlan =
    | { kind: "save"; path: string }
    | { kind: "rename_then_save"; newPath: string }
    | { kind: "name_conflict"; name: string }
    | { kind: "invalid_name"; reason: string };

export function resolveUntitledName(existingNames: readonly string[]) {
    const taken = new Set(existingNames.map(normalizeNameForCompare));
    let index = 0;

    while (true) {
        const candidate = index === 0 ? "Untitled.md" : `Untitled${index}.md`;

        if (!taken.has(normalizeNameForCompare(candidate))) {
            return candidate;
        }

        index += 1;
    }
}

export function planFirstSave({
    currentPath,
    requestedName,
    existingNames,
    needsRenameOnFirstSave,
}: FirstSavePlanInput): FirstSavePlan {
    const normalizedCurrentPath = normalizeWorkspacePath(currentPath);

    if (!needsRenameOnFirstSave) {
        return {
            kind: "save",
            path: normalizedCurrentPath,
        };
    }

    const nextName = normalizeMarkdownName(requestedName);

    if (!nextName) {
        return {
            kind: "invalid_name",
            reason: "请输入文件名。",
        };
    }

    if (
        normalizeNameForCompare(nextName) ===
        normalizeNameForCompare(basename(normalizedCurrentPath))
    ) {
        return {
            kind: "invalid_name",
            reason: "请输入正式文件名。",
        };
    }

    if (
        existingNames
            .map(normalizeNameForCompare)
            .includes(normalizeNameForCompare(nextName)) &&
        normalizeNameForCompare(nextName) !==
            normalizeNameForCompare(basename(normalizedCurrentPath))
    ) {
        return {
            kind: "name_conflict",
            name: nextName,
        };
    }

    return {
        kind: "rename_then_save",
        newPath: joinPath(dirname(normalizedCurrentPath), nextName),
    };
}

function normalizeMarkdownName(name: string) {
    const trimmed = name.trim();

    if (!trimmed || /[\\/]/.test(trimmed)) {
        return "";
    }

    if (/\.(md|markdown)$/i.test(trimmed)) {
        return trimmed;
    }

    return `${trimmed}.md`;
}

function normalizeNameForCompare(name: string) {
    return normalizeWorkspacePath(name).toLowerCase();
}

function basename(path: string) {
    const normalized = normalizeWorkspacePath(path);
    return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}

function dirname(path: string) {
    const normalized = normalizeWorkspacePath(path);
    const parts = normalized.split("/").filter(Boolean);

    if (parts.length <= 1) {
        return normalized.startsWith("/") ? "/" : "";
    }

    const parent = parts.slice(0, -1).join("/");
    return normalized.startsWith("/") ? `/${parent}` : parent;
}

function joinPath(dir: string, name: string) {
    const normalizedDir = normalizeWorkspacePath(dir);
    const normalizedName = normalizeWorkspacePath(name);

    if (!normalizedDir) {
        return normalizedName;
    }

    if (normalizedDir.endsWith("/")) {
        return `${normalizedDir}${normalizedName}`;
    }

    return `${normalizedDir}/${normalizedName}`;
}
