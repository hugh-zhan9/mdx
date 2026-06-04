export type AppWindowSession =
    | { kind: "workspace" }
    | {
          kind: "document";
          fileName: string;
          displayPath: string;
          realPath: string;
          workspaceDirty?: boolean;
      }
    | {
          kind: "documentError";
          message: string;
          path: string | null;
      };

const DOCUMENT_OPEN_ERROR_MESSAGE = "无法打开文档。";

export function normalizeAppWindowSession(input: unknown): AppWindowSession {
    if (!input || typeof input !== "object" || !("kind" in input)) {
        return { kind: "workspace" };
    }

    const raw = input as Record<string, unknown>;

    if (raw.kind === "workspace") {
        return { kind: "workspace" };
    }

    if (
        raw.kind === "document" &&
        typeof raw.fileName === "string" &&
        typeof raw.displayPath === "string" &&
        typeof raw.realPath === "string"
    ) {
        return {
            kind: "document",
            fileName: raw.fileName,
            displayPath: raw.displayPath,
            realPath: raw.realPath,
            workspaceDirty: raw.workspaceDirty === true,
        };
    }

    if (raw.kind === "documentError") {
        return {
            kind: "documentError",
            message:
                typeof raw.message === "string"
                    ? raw.message
                    : DOCUMENT_OPEN_ERROR_MESSAGE,
            path: typeof raw.path === "string" ? raw.path : null,
        };
    }

    return {
        kind: "documentError",
        message: DOCUMENT_OPEN_ERROR_MESSAGE,
        path: null,
    };
}
