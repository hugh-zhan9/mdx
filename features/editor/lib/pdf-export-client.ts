import { tauriCore } from "@/common/lib/tauri";

type PdfExportResult = {
    pageCount: number;
    warnings: string[];
    exportMs: number;
};

export async function exportPdf(
    rootPath: string,
    request: Record<string, unknown>,
) {
    const { invoke } = await tauriCore();
    return invoke<PdfExportResult>("layout_export_pdf", {
        rootPath,
        request,
    });
}
