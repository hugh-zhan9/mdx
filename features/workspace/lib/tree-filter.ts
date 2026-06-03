import type {
    FileTreeNode,
    FilteredFileTreeNode,
    HighlightSegment,
} from "./types";

export function filterTreeByName(
    tree: FileTreeNode[],
    query: string,
): FilteredFileTreeNode[] {
    const normalizedQuery = normalizeSearchQuery(query);

    if (normalizedQuery.length === 0) {
        return tree as FilteredFileTreeNode[];
    }

    return tree.flatMap((node) => filterNodeByName(node, normalizedQuery));
}

function filterNodeByName(
    node: FileTreeNode,
    normalizedQuery: string,
): FilteredFileTreeNode[] {
    const nodeMatches = nameIncludesQuery(node.name, normalizedQuery);

    if (node.kind === "file") {
        return nodeMatches ? [decorateNode(node, normalizedQuery)] : [];
    }

    if (nodeMatches) {
        return [decorateNode(node, normalizedQuery)];
    }

    const children = node.children.flatMap((child) =>
        filterNodeByName(child, normalizedQuery),
    );

    if (children.length === 0) {
        return [];
    }

    return [
        {
            ...node,
            children,
            nameSegments: buildHighlightSegments(node.name, normalizedQuery),
        },
    ];
}

function decorateNode(
    node: FileTreeNode,
    normalizedQuery: string,
): FilteredFileTreeNode {
    const nameSegments = buildHighlightSegments(node.name, normalizedQuery);

    if (node.kind === "file") {
        return {
            ...node,
            nameSegments,
        };
    }

    return {
        ...node,
        children: node.children.map((child) => decorateNode(child, normalizedQuery)),
        nameSegments,
    };
}

function buildHighlightSegments(
    text: string,
    normalizedQuery: string,
): HighlightSegment[] {
    if (normalizedQuery.length === 0) {
        return [{ text, highlighted: false }];
    }

    const segments: HighlightSegment[] = [];
    const lowerText = text.toLowerCase();
    let cursor = 0;

    while (cursor < text.length) {
        const matchIndex = lowerText.indexOf(normalizedQuery, cursor);

        if (matchIndex === -1) {
            segments.push({
                text: text.slice(cursor),
                highlighted: false,
            });
            break;
        }

        if (matchIndex > cursor) {
            segments.push({
                text: text.slice(cursor, matchIndex),
                highlighted: false,
            });
        }

        const matchEnd = matchIndex + normalizedQuery.length;
        segments.push({
            text: text.slice(matchIndex, matchEnd),
            highlighted: true,
        });
        cursor = matchEnd;
    }

    return segments.filter((segment) => segment.text.length > 0);
}

function normalizeSearchQuery(query: string) {
    return query.trim().toLowerCase();
}

function nameIncludesQuery(name: string, normalizedQuery: string) {
    return name.toLowerCase().includes(normalizedQuery);
}
