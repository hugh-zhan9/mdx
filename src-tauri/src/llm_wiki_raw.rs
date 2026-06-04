use std::path::Path;

use crate::llm_wiki_fs::{is_raw_pdf_file, raw_file_hash};
use crate::llm_wiki_query::safe_read_regular_text;
use crate::models::WorkspaceError;
use crate::path_guard::is_allowed_markdown_file;

#[derive(Debug)]
pub struct PreparedRawSource {
    pub text: String,
    pub hash: String,
}

pub fn prepare_raw_source(
    root: &Path,
    raw_relative_path: &str,
) -> Result<PreparedRawSource, WorkspaceError> {
    let path = root.join(raw_relative_path);
    let bytes = read_regular_raw_bytes(&path)?;
    let hash = raw_file_hash(raw_relative_path, &bytes);
    let text = if is_allowed_markdown_file(&path) {
        safe_read_regular_text(root, &path, "llm wiki raw file")?
    } else if is_raw_pdf_file(&path) {
        extract_pdf_source_text(raw_relative_path, &bytes)?
    } else {
        return Err(WorkspaceError::new(
            "unsupported_llm_wiki_raw_type",
            "llm wiki raw path has an unsupported file type",
        ));
    };

    Ok(PreparedRawSource { text, hash })
}

fn read_regular_raw_bytes(path: &Path) -> Result<Vec<u8>, WorkspaceError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        WorkspaceError::from_io("path_failed", "failed to inspect llm wiki raw file", &error)
    })?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(WorkspaceError::new(
            "path_type_conflict",
            "llm wiki raw file is not a regular file",
        ));
    }

    std::fs::read(path).map_err(|error| {
        WorkspaceError::from_io("read_failed", "failed to read llm wiki raw file", &error)
    })
}

fn extract_pdf_source_text(relative_path: &str, bytes: &[u8]) -> Result<String, WorkspaceError> {
    let extracted = pdf_extract::extract_text_from_mem(bytes).map_err(|error| {
        WorkspaceError::new(
            "pdf_extract_failed",
            format!("failed to extract text from raw PDF source: {error}"),
        )
    })?;
    let trimmed = extracted.trim();
    if trimmed.is_empty() {
        return Err(WorkspaceError::new(
            "pdf_extract_empty",
            "raw PDF source does not contain extractable text",
        ));
    }

    Ok(format!(
        "# Raw PDF Source\n\nPath: {relative_path}\n\n{trimmed}\n"
    ))
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::prepare_raw_source;
    use crate::llm_wiki_fs::initialize_llm_wiki_workspace;

    #[test]
    fn prepare_raw_source_reads_markdown_without_wrapping() {
        let root = tempdir().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();
        std::fs::write(root.path().join("raw/notes/a.md"), "# A\n").unwrap();

        let source = prepare_raw_source(root.path(), "raw/notes/a.md").unwrap();

        assert_eq!(source.text, "# A\n");
        assert!(source.hash.starts_with("sha256:"));
    }

    #[test]
    fn prepare_raw_source_extracts_text_from_pdf() {
        let root = tempdir().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();
        std::fs::write(
            root.path().join("raw/articles/report.pdf"),
            minimal_text_pdf("PDF source text"),
        )
        .unwrap();

        let source = prepare_raw_source(root.path(), "raw/articles/report.pdf").unwrap();

        assert!(source.text.contains("# Raw PDF Source"));
        assert!(source.text.contains("Path: raw/articles/report.pdf"));
        assert!(source.text.contains("PDF source text"));
        assert!(source.hash.starts_with("sha256:"));
    }

    #[test]
    fn prepare_raw_source_rejects_invalid_pdf() {
        let root = tempdir().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();
        std::fs::write(root.path().join("raw/articles/broken.pdf"), b"%PDF-1.7\n").unwrap();

        let error = prepare_raw_source(root.path(), "raw/articles/broken.pdf").unwrap_err();

        assert_eq!(error.error_code(), "pdf_extract_failed");
    }

    fn minimal_text_pdf(text: &str) -> Vec<u8> {
        let escaped = text
            .replace('\\', "\\\\")
            .replace('(', "\\(")
            .replace(')', "\\)");
        let stream = format!("BT /F1 18 Tf 32 96 Td ({escaped}) Tj ET");
        let objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_string(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
            format!(
                "<< /Length {} >>\nstream\n{stream}\nendstream",
                stream.len(),
            ),
        ];

        let mut pdf = String::from("%PDF-1.4\n");
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.push_str(&format!("{} 0 obj\n{object}\nendobj\n", index + 1));
        }
        let xref_offset = pdf.len();
        pdf.push_str("xref\n0 6\n0000000000 65535 f \n");
        for offset in offsets {
            pdf.push_str(&format!("{offset:010} 00000 n \n"));
        }
        pdf.push_str(&format!(
            "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
        ));
        pdf.into_bytes()
    }
}
