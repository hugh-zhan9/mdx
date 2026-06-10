export interface FileWatchPayload {
    watchId: string;
    rootPath?: string | null;
    path: string;
    newPath?: string | null;
    fingerprint?: string | null;
    eventTime: string;
}

export type FrontendFileWatchEvent =
    | (FileWatchPayload & { kind: "changed" })
    | (FileWatchPayload & { kind: "deleted" })
    | (FileWatchPayload & { kind: "created" })
    | (FileWatchPayload & { kind: "renamed"; newPath: string });

export interface SelfWriteMarker {
    path: string;
    markdown: string;
    fingerprint?: string;
}

export interface WatchStartResult {
    watchId: string;
}

export interface WatchStopResult {
    stopped: boolean;
}

export interface WatchErrorPayload {
    watchId: string;
    message: string;
    eventTime: string;
}
