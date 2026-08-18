export function normalizeWorkspacePath(path: string): string {
    const input = path.trim().replace(/\\/g, "/");

    if (input.length === 0) {
        return "";
    }

    const drivePrefix = input.match(/^[A-Za-z]:/)?.[0] ?? "";
    let prefix = "";
    let rest = input;

    if (drivePrefix.length > 0) {
        prefix = drivePrefix;
        rest = input.slice(drivePrefix.length);

        if (rest.startsWith("/")) {
            prefix += "/";
            rest = rest.slice(1);
        }
    } else if (input.startsWith("/")) {
        prefix = "/";
        rest = input.slice(1);
    }

    const parts: string[] = [];

    for (const part of rest.split("/")) {
        if (part.length === 0 || part === ".") {
            continue;
        }

        if (part === "..") {
            const previous = parts.at(-1);

            if (previous && previous !== "..") {
                parts.pop();
            } else if (prefix.length === 0) {
                parts.push(part);
            }

            continue;
        }

        parts.push(part);
    }

    const body = parts.join("/");

    if (prefix === "/") {
        return body.length > 0 ? `/${body}` : "/";
    }

    if (prefix.endsWith("/")) {
        return body.length > 0 ? `${prefix}${body}` : prefix;
    }

    if (prefix.length > 0) {
        return body.length > 0 ? `${prefix}/${body}` : prefix;
    }

    return body;
}

export function isPathInsideRoot(rootPath: string, candidatePath: string) {
    const root = stripTrailingSlash(normalizeWorkspacePath(rootPath));
    const candidate = stripTrailingSlash(normalizeWorkspacePath(candidatePath));
    const [normalizedRoot, normalizedCandidate] = normalizeCaseForPlatform(
        root,
        candidate,
    );

    if (normalizedRoot.length === 0) {
        return false;
    }

    const rootWithSeparator = normalizedRoot.endsWith("/")
        ? normalizedRoot
        : `${normalizedRoot}/`;

    return (
        normalizedCandidate === normalizedRoot ||
        normalizedCandidate.startsWith(rootWithSeparator)
    );
}

/**
 * How a file reads inside its workspace: relative to the root, with no leading
 * separator.
 *
 * A path that is not inside the root keeps its full spelling. Trimming it to a
 * suffix would say the file lives in this workspace, which is the one thing a
 * caller is using this to tell the user.
 */
export function workspaceRelativePath(rootPath: string, filePath: string) {
    const file = normalizeWorkspacePath(filePath);

    if (!isPathInsideRoot(rootPath, filePath)) {
        return file;
    }

    const root = stripTrailingSlash(normalizeWorkspacePath(rootPath));

    // The root is the workspace, so it has no path inside it to name.
    if (file.length === root.length) {
        return "";
    }

    // A root that already ends in a separator — "/" or a bare drive — must not
    // have one counted twice, or the first character of the name is eaten.
    return file.slice(root.endsWith("/") ? root.length : root.length + 1);
}

export function isMarkdownFilePath(path: string) {
    const normalized = normalizeWorkspacePath(path).toLowerCase();

    return normalized.endsWith(".md") || normalized.endsWith(".markdown");
}

export function isPdfFilePath(path: string) {
    return normalizeWorkspacePath(path).toLowerCase().endsWith(".pdf");
}

export function isHtmlFilePath(path: string) {
    const normalized = normalizeWorkspacePath(path).toLowerCase();

    return normalized.endsWith(".html") || normalized.endsWith(".htm");
}

export function isMhtmlFilePath(path: string) {
    return normalizeWorkspacePath(path).toLowerCase().endsWith(".mhtml");
}

export function isRenderableHtmlFilePath(path: string) {
    return isHtmlFilePath(path) || isMhtmlFilePath(path);
}

const PLAIN_TEXT_EXTENSIONS = new Set([
    "",
    ".csv",
    ".go",
    ".java",
    ".js",
    ".json",
    ".jsp",
    ".ndjson",
    ".properties",
    ".py",
    ".rst",
    ".sh",
    ".sql",
    ".srt",
    ".template",
    ".ts",
    ".txt",
    ".xml",
    ".xsd",
    ".yaml",
    ".yml",
]);

const IMAGE_EXTENSIONS = new Set([
    ".awebp",
    ".avif",
    ".bmp",
    ".gif",
    ".heic",
    ".jfif",
    ".jpeg",
    ".jpg",
    ".png",
    ".svg",
    ".tif",
    ".tiff",
    ".webp",
]);

export function isPlainTextFilePath(path: string) {
    return PLAIN_TEXT_EXTENSIONS.has(getFileExtension(path));
}

export function isImageFilePath(path: string) {
    return IMAGE_EXTENSIONS.has(getFileExtension(path));
}

export function isEditableFilePath(path: string) {
    return isMarkdownFilePath(path);
}

export function isPreviewableFilePath(path: string) {
    return (
        isMarkdownFilePath(path) ||
        isPdfFilePath(path) ||
        isPlainTextFilePath(path) ||
        isRenderableHtmlFilePath(path) ||
        isImageFilePath(path)
    );
}

export function shouldOpenWithDefaultApplication(path: string) {
    return !isPreviewableFilePath(path);
}

export function isHiddenFileTreeEntry(path: string) {
    const normalized = normalizeWorkspacePath(path);
    const name = normalized.split("/").pop() ?? normalized;

    return name.length > 0 && name.startsWith(".");
}

function stripTrailingSlash(path: string) {
    if (path === "/" || /^[A-Za-z]:\/?$/.test(path)) {
        return path;
    }

    return path.replace(/\/+$/, "");
}

function normalizeCaseForPlatform(
    rootPath: string,
    candidatePath: string,
): [string, string] {
    if (/^[A-Za-z]:/.test(rootPath) || /^[A-Za-z]:/.test(candidatePath)) {
        return [rootPath.toLowerCase(), candidatePath.toLowerCase()];
    }

    return [rootPath, candidatePath];
}

function getFileExtension(path: string) {
    const normalized = normalizeWorkspacePath(path).toLowerCase();
    const name = normalized.split("/").pop() ?? normalized;
    const dotIndex = name.lastIndexOf(".");

    if (dotIndex <= 0) {
        return "";
    }

    return name.slice(dotIndex);
}
