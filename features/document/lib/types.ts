export interface DocumentFileResult {
    content: string;
    fileName: string;
    displayPath: string;
    realPath: string;
    fingerprint: string;
}

export interface DocumentSaveResult {
    fingerprint: string;
}

export interface LoadedDocumentState {
    fileName: string;
    displayPath: string;
    realPath: string;
    markdown: string;
    savedMarkdown: string;
    fingerprint: string;
    dirty: boolean;
    outlineCollapsed: boolean;
}
