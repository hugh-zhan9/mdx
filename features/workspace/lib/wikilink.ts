import {
    isMarkdownFilePath,
    isPathInsideRoot,
    normalizeWorkspacePath,
} from "./path";
import type { FileTreeNode } from "./types";

export interface ParsedWikilink {
    raw: string;
    path: string;
    heading: string | null;
    label: string | null;
}

interface MarkdownFileEntry {
    name: string;
    path: string;
}

export function parseWikilinkTarget(raw: string): ParsedWikilink | null {
    const value = raw.trim();

    if (!value) {
        return null;
    }

    const [targetPart, labelPart] = splitOnce(value, "|");
    const target = targetPart.trim();

    if (!target) {
        return null;
    }

    const [pathPart, headingPart] = splitOnce(target, "#");

    return {
        raw: target,
        path: pathPart.trim(),
        heading: headingPart?.trim() || null,
        label: labelPart?.trim() || null,
    };
}

export function resolveWikilinkFile(
    rootPath: string,
    sourcePath: string,
    fileTree: FileTreeNode[],
    rawTarget: string,
) {
    const parsed = parseWikilinkTarget(rawTarget);

    if (!parsed) {
        return null;
    }

    const root = normalizeWorkspacePath(rootPath);
    const source = normalizeWorkspacePath(sourcePath);
    const files = collectMarkdownFiles(fileTree);

    if (parsed.path.length === 0) {
        return isMarkdownFilePath(source) && isPathInsideRoot(root, source)
            ? source
            : null;
    }

    const targetPath = normalizeWorkspacePath(parsed.path);
    const exactCandidates = candidatePathsForTarget(root, source, targetPath);

    for (const candidate of exactCandidates) {
        const found = findExactMarkdownPath(files, root, candidate);

        if (found) {
            return found;
        }
    }

    return resolveBareWikilink(files, source, targetPath);
}

function candidatePathsForTarget(
    rootPath: string,
    sourcePath: string,
    targetPath: string,
) {
    const candidates: string[] = [];

    if (targetPath.startsWith("/")) {
        candidates.push(joinWorkspacePath(rootPath, targetPath.slice(1)));
    } else if (isAbsoluteWorkspacePath(targetPath)) {
        candidates.push(targetPath);
    } else if (isWikiRootQualifiedTarget(targetPath)) {
        candidates.push(joinWorkspacePath(rootPath, targetPath));
    } else if (targetPath.includes("/")) {
        candidates.push(joinWorkspacePath(dirname(sourcePath), targetPath));
        candidates.push(joinWorkspacePath(rootPath, targetPath));
    }

    return candidates.flatMap(withMarkdownExtensions);
}

function resolveBareWikilink(
    files: MarkdownFileEntry[],
    sourcePath: string,
    targetPath: string,
) {
    if (targetPath.includes("/")) {
        return null;
    }

    const targetKey = stripMarkdownExtension(targetPath).toLowerCase();
    const matches = files.filter((file) => {
        return stripMarkdownExtension(file.name).toLowerCase() === targetKey;
    });

    if (matches.length === 0) {
        return resolveBareWikilinkBySlug(files, sourcePath, targetPath);
    }

    const sourceDir = dirname(sourcePath);
    const sameDir = matches.find((file) => dirname(file.path) === sourceDir);

    if (sameDir) {
        return sameDir.path;
    }

    const wikiMatch = matches.find((file) => {
        return normalizeWorkspacePath(file.path).includes("/wiki/");
    });

    return wikiMatch?.path ?? matches[0].path;
}

function resolveBareWikilinkBySlug(
    files: MarkdownFileEntry[],
    sourcePath: string,
    targetPath: string,
) {
    const targetSlug = toAsciiSlug(targetPath);

    if (targetSlug.length < 12 || !targetSlug.includes("-")) {
        return null;
    }

    const matches = files.filter((file) => {
        const fileSlug = stripMarkdownExtension(file.name).toLowerCase();

        return fileSlug === targetSlug || fileSlug.startsWith(`${targetSlug}-`);
    });

    if (matches.length === 0) {
        return null;
    }

    const sourceDir = dirname(sourcePath);
    const sameDirMatches = matches.filter(
        (file) => dirname(file.path) === sourceDir,
    );

    if (sameDirMatches.length === 1) {
        return sameDirMatches[0].path;
    }

    const wikiMatches = matches.filter((file) => {
        return normalizeWorkspacePath(file.path).includes("/wiki/");
    });

    if (wikiMatches.length === 1) {
        return wikiMatches[0].path;
    }

    return matches.length === 1 ? matches[0].path : null;
}

function findExactMarkdownPath(
    files: MarkdownFileEntry[],
    rootPath: string,
    candidatePath: string,
) {
    const normalized = normalizeWorkspacePath(candidatePath);

    if (!isPathInsideRoot(rootPath, normalized)) {
        return null;
    }

    return (
        files.find((file) => normalizeWorkspacePath(file.path) === normalized)
            ?.path ?? null
    );
}

function collectMarkdownFiles(nodes: FileTreeNode[]) {
    const files: MarkdownFileEntry[] = [];

    for (const node of nodes) {
        if (node.kind === "file") {
            if (isMarkdownFilePath(node.path)) {
                files.push({
                    name: node.name,
                    path: normalizeWorkspacePath(node.path),
                });
            }
        } else {
            files.push(...collectMarkdownFiles(node.children));
        }
    }

    return files;
}

function withMarkdownExtensions(path: string) {
    const normalized = normalizeWorkspacePath(path);

    if (isMarkdownFilePath(normalized)) {
        return [normalized];
    }

    return [`${normalized}.md`, `${normalized}.markdown`];
}

function isWikiRootQualifiedTarget(path: string) {
    return (
        path.startsWith("wiki/") ||
        path.startsWith("raw/") ||
        path === "index" ||
        path === "log"
    );
}

function isAbsoluteWorkspacePath(path: string) {
    return /^[A-Za-z]:\//.test(path);
}

function joinWorkspacePath(basePath: string, childPath: string) {
    return normalizeWorkspacePath(`${basePath}/${childPath}`);
}

function dirname(path: string) {
    const normalized = normalizeWorkspacePath(path);
    const index = normalized.lastIndexOf("/");

    if (index <= 0) {
        return index === 0 ? "/" : "";
    }

    return normalized.slice(0, index);
}

function stripMarkdownExtension(path: string) {
    return path.replace(/\.(md|markdown)$/i, "");
}

function toAsciiSlug(value: string) {
    return stripMarkdownExtension(value)
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-");
}

function splitOnce(value: string, separator: string) {
    const index = value.indexOf(separator);

    if (index < 0) {
        return [value, undefined] as const;
    }

    return [value.slice(0, index), value.slice(index + 1)] as const;
}
