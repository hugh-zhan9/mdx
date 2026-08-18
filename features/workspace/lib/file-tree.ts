import { isHiddenFileTreeEntry, normalizeWorkspacePath } from "./path";
import type { FileTreeNode } from "./types";

export interface FileTreeBuildError {
    code: "duplicate_name";
    message: string;
    path: string;
    name: string;
}

export type FileTreeBuildResult =
    | {
          ok: true;
          nodes: FileTreeNode[];
      }
    | {
          ok: false;
          error: FileTreeBuildError;
      };

const naturalNameCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
});

export function buildFileTree(rawNodes: FileTreeNode[]): FileTreeBuildResult {
    return buildFolderChildren(
        rawNodes,
        rawNodes.length > 0 ? getFileTreeParentPath(rawNodes[0].path) : "",
    );
}

/**
 * The tree as seen from one folder.
 *
 * Returns that folder's children, so the tree reads as if the workspace started
 * there. `null` means the folder is not in this tree — deleted, renamed, or
 * belonging to another workspace — which the caller has to tell apart from a
 * folder that is simply empty.
 */
export function focusedTreeNodes(
    nodes: FileTreeNode[],
    focusPath: string,
): FileTreeNode[] | null {
    const target = normalizeWorkspacePath(focusPath);

    if (!target) {
        return null;
    }

    for (const node of nodes) {
        if (node.kind !== "folder") {
            continue;
        }

        if (node.path === target) {
            return node.children;
        }

        // Only descend where the path can be: the tree is sorted but not
        // indexed, and a folder cannot contain a path it is not a prefix of.
        if (isPathWithinFolder(target, node.path)) {
            const found = focusedTreeNodes(node.children, target);

            if (found !== null) {
                return found;
            }
        }
    }

    return null;
}

export function getFileTreeParentPath(path: string) {
    const normalizedPath = normalizeWorkspacePath(path);
    const slashIndex = normalizedPath.lastIndexOf("/");

    if (slashIndex <= 0) {
        return slashIndex === 0 ? "/" : "";
    }

    if (/^[A-Za-z]:$/.test(normalizedPath.slice(0, slashIndex))) {
        return normalizedPath.slice(0, slashIndex + 1);
    }

    return normalizedPath.slice(0, slashIndex);
}

export function isPathWithinFolder(path: string, folderPath: string) {
    const normalizedPath = normalizeWorkspacePath(path);
    const normalizedFolderPath = normalizeWorkspacePath(folderPath);

    if (!normalizedPath || !normalizedFolderPath) {
        return false;
    }

    const folderPrefix = normalizedFolderPath.endsWith("/")
        ? normalizedFolderPath
        : `${normalizedFolderPath}/`;

    return (
        normalizedPath === normalizedFolderPath ||
        normalizedPath.startsWith(folderPrefix)
    );
}

function buildFolderChildren(
    rawNodes: FileTreeNode[],
    parentPath: string,
): FileTreeBuildResult {
    const children: FileTreeNode[] = [];

    for (const rawNode of rawNodes) {
        const normalizedNode = normalizeNode(rawNode);

        if (!normalizedNode) {
            continue;
        }

        if (normalizedNode.kind === "file") {
            children.push(normalizedNode);
            continue;
        }

        const result = buildFolderChildren(
            normalizedNode.children,
            normalizedNode.path,
        );

        if (!result.ok) {
            return result;
        }

        children.push({
            ...normalizedNode,
            children: result.nodes,
        });
    }

    const duplicate = findDuplicateSibling(children);

    if (duplicate) {
        return {
            ok: false,
            error: {
                code: "duplicate_name",
                message: `Duplicate file tree entry "${duplicate.name}".`,
                path: parentPath,
                name: duplicate.name,
            },
        };
    }

    return {
        ok: true,
        nodes: children.sort(compareTreeNodes),
    };
}

function normalizeNode(node: FileTreeNode): FileTreeNode | null {
    const normalizedPath = normalizeWorkspacePath(node.path);
    const normalizedName = node.name.trim();

    if (!normalizedName || !normalizedPath) {
        return null;
    }

    if (node.kind === "file") {
        if (isHiddenFileTreeEntry(normalizedPath)) {
            return null;
        }

        return {
            kind: "file",
            name: normalizedName,
            path: normalizedPath,
        };
    }

    return {
        kind: "folder",
        name: normalizedName,
        path: normalizedPath,
        children: node.children,
    };
}

function findDuplicateSibling(nodes: FileTreeNode[]) {
    const seenNames = new Set<string>();

    for (const node of nodes) {
        const key = node.name.toLowerCase();

        if (seenNames.has(key)) {
            return node;
        }

        seenNames.add(key);
    }

    return null;
}

function compareTreeNodes(left: FileTreeNode, right: FileTreeNode) {
    if (left.kind !== right.kind) {
        return left.kind === "folder" ? -1 : 1;
    }

    const nameComparison = naturalNameCollator.compare(left.name, right.name);

    if (nameComparison !== 0) {
        return nameComparison;
    }

    return left.path.localeCompare(right.path);
}
