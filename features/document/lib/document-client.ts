import { tauriCore } from "@/common/lib/tauri";
import type { DocumentFileResult, DocumentSaveResult } from "./types";

export async function readDocumentFile(path: string) {
    const { invoke } = await tauriCore();
    return invoke<DocumentFileResult>("read_document_file", { path });
}

export async function saveDocumentFile(
    realPath: string,
    content: string,
    expectedFingerprint: string,
) {
    const { invoke } = await tauriCore();
    return invoke<DocumentSaveResult>("save_document_file", {
        realPath,
        content,
        expectedFingerprint,
    });
}

export async function overwriteDocumentFile(realPath: string, content: string) {
    const { invoke } = await tauriCore();
    return invoke<DocumentSaveResult>("overwrite_document_file", {
        realPath,
        content,
    });
}
