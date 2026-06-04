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

export function isMarkdownFilePath(path: string) {
    const normalized = normalizeWorkspacePath(path).toLowerCase();

    return normalized.endsWith(".md") || normalized.endsWith(".markdown");
}

export function isPdfFilePath(path: string) {
    return normalizeWorkspacePath(path).toLowerCase().endsWith(".pdf");
}

const PLAIN_TEXT_EXTENSIONS = new Set([
    "",
    ".csv",
    ".go",
    ".java",
    ".js",
    ".json",
    ".jsp",
    ".mhtml",
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

export function isHtmlFilePath(path: string) {
    const normalized = normalizeWorkspacePath(path).toLowerCase();

    return normalized.endsWith(".html") || normalized.endsWith(".htm");
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
        isHtmlFilePath(path) ||
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
