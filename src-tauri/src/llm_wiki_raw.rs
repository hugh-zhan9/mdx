use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::process::Command;

use crate::llm_wiki_fs::{is_raw_pdf_file, raw_file_hash};
use crate::llm_wiki_query::safe_read_regular_text;
use crate::models::WorkspaceError;
use crate::path_guard::is_allowed_markdown_file;

#[cfg(test)]
pub(crate) fn test_pdf_env_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

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
    let extracted = match extract_pdf_with_builtin(bytes) {
        Ok(text) => text,
        Err(primary_error) => match extract_pdf_with_pdftotext(bytes) {
            Ok(text) => text,
            Err(fallback_error) => {
                return Err(WorkspaceError::new(
                    "pdf_extract_failed",
                    format!("{primary_error}; pdftotext fallback failed: {fallback_error}",),
                ));
            }
        },
    };
    let trimmed = extracted.trim();
    if trimmed.is_empty() {
        return Err(WorkspaceError::new(
            "pdf_extract_empty",
            "raw PDF source does not contain extractable text",
        ));
    }
    if !is_usable_pdf_text(trimmed) {
        return Err(WorkspaceError::new(
            "pdf_extract_unusable",
            "raw PDF source does not contain usable extractable text; it may be scanned, image-only, or encoded as unreadable glyphs",
        ));
    }

    Ok(format!(
        "# Raw PDF Source\n\nPath: {relative_path}\n\n{trimmed}\n"
    ))
}

fn is_usable_pdf_text(text: &str) -> bool {
    let mut non_whitespace = 0usize;
    let mut semantic_chars = 0usize;
    let mut control_chars = 0usize;
    let mut cjk_chars = 0usize;

    for ch in text.chars() {
        if ch.is_whitespace() {
            continue;
        }

        non_whitespace += 1;
        if ch.is_control() {
            control_chars += 1;
            continue;
        }

        if ch.is_alphanumeric() {
            semantic_chars += 1;
        }
        if is_cjk_char(ch) {
            cjk_chars += 1;
        }
    }

    if non_whitespace < 10 {
        return false;
    }

    if control_chars.saturating_mul(5) > non_whitespace {
        return false;
    }

    if looks_like_pdf_metadata_only(text) {
        return false;
    }

    semantic_chars >= 8 || cjk_chars >= 4
}

fn is_cjk_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2A6DF
            | 0x2A700..=0x2B73F
            | 0x2B740..=0x2B81F
            | 0x2B820..=0x2CEAF
    )
}

fn looks_like_pdf_metadata_only(text: &str) -> bool {
    let normalized = text.replace(' ', "");
    (normalized.contains("GeneralInformation")
        || normalized.contains("ＧｅｎｅｒａｌＩｎｆｏｒｍａｔｉｏｎ"))
        && normalized.contains("书名")
        && normalized.contains("作者")
        && normalized.contains("页数")
        && (normalized.contains("出版社") || normalized.contains("出版日期"))
}

fn extract_pdf_with_builtin(bytes: &[u8]) -> Result<String, WorkspaceError> {
    match catch_unwind(AssertUnwindSafe(|| {
        pdf_extract::extract_text_from_mem(bytes)
    })) {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(error)) => Err(WorkspaceError::new(
            "pdf_extract_failed",
            format!("failed to extract text from raw PDF source: {error}"),
        )),
        Err(panic) => Err(WorkspaceError::new(
            "pdf_extract_failed",
            format!(
                "failed to extract text from raw PDF source: extractor panicked: {}",
                panic_message(panic)
            ),
        )),
    }
}

fn extract_pdf_with_pdftotext(bytes: &[u8]) -> Result<String, WorkspaceError> {
    if std::env::var_os("MDX_DISABLE_PDFTOTEXT").is_some() {
        return Err(WorkspaceError::new(
            "pdf_extract_failed",
            "pdftotext fallback is disabled",
        ));
    }

    let temp = tempfile::tempdir().map_err(|error| {
        WorkspaceError::from_io(
            "pdf_extract_failed",
            "failed to create temporary directory for pdftotext",
            &error,
        )
    })?;
    let input_path = temp.path().join("source.pdf");
    let output_path = temp.path().join("source.txt");
    std::fs::write(&input_path, bytes).map_err(|error| {
        WorkspaceError::from_io(
            "pdf_extract_failed",
            "failed to write temporary PDF for pdftotext",
            &error,
        )
    })?;

    let output = run_pdftotext(&input_path, &output_path)?;

    if !output.status.success() {
        return Err(WorkspaceError::new(
            "pdf_extract_failed",
            format!(
                "pdftotext exited with status {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        ));
    }

    std::fs::read_to_string(&output_path).map_err(|error| {
        WorkspaceError::from_io(
            "pdf_extract_failed",
            "failed to read pdftotext output",
            &error,
        )
    })
}

fn run_pdftotext(
    input_path: &Path,
    output_path: &Path,
) -> Result<std::process::Output, WorkspaceError> {
    let candidates = [
        "pdftotext",
        "/opt/homebrew/bin/pdftotext",
        "/usr/local/bin/pdftotext",
    ];
    let mut last_error = None;

    for command in candidates {
        match Command::new(command)
            .arg("-enc")
            .arg("UTF-8")
            .arg("-layout")
            .arg(input_path)
            .arg(output_path)
            .output()
        {
            Ok(output) => return Ok(output),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                last_error = Some(error);
            }
            Err(error) => {
                return Err(WorkspaceError::from_io(
                    "pdf_extract_failed",
                    format!("failed to run {command} for raw PDF source"),
                    &error,
                ));
            }
        }
    }

    let fallback_error = last_error.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "pdftotext not found")
    });
    Err(WorkspaceError::from_io(
        "pdf_extract_failed",
        "failed to run pdftotext for raw PDF source",
        &fallback_error,
    ))
}

fn panic_message(panic: Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = panic.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = panic.downcast_ref::<String>() {
        return message.clone();
    }

    "unknown panic".to_string()
}

#[cfg(test)]
mod tests {
    use std::sync::MutexGuard;

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
        let _path = PathEnvGuard::replace_with_original();
        let root = tempdir().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();
        std::fs::write(root.path().join("raw/articles/broken.pdf"), b"%PDF-1.7\n").unwrap();

        let error = prepare_raw_source(root.path(), "raw/articles/broken.pdf").unwrap_err();

        assert_eq!(error.error_code(), "pdf_extract_failed");
    }

    #[test]
    #[cfg(unix)]
    fn prepare_raw_source_falls_back_to_pdftotext_when_builtin_pdf_extract_fails() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempdir().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();
        std::fs::write(root.path().join("raw/articles/broken.pdf"), b"%PDF-1.7\n").unwrap();
        let bin = root.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let pdftotext = bin.join("pdftotext");
        std::fs::write(
            &pdftotext,
            "#!/bin/sh\nprintf 'Fallback PDF text from pdftotext\\n' > \"$5\"\n",
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&pdftotext).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&pdftotext, permissions).unwrap();
        let _path = PathEnvGuard::prepend(&bin);

        let source = prepare_raw_source(root.path(), "raw/articles/broken.pdf").unwrap();

        assert!(source.text.contains("Fallback PDF text from pdftotext"));
    }

    #[test]
    #[cfg(unix)]
    fn prepare_raw_source_rejects_fallback_text_with_too_many_control_characters() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempdir().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();
        std::fs::write(root.path().join("raw/articles/broken.pdf"), b"%PDF-1.7\n").unwrap();
        let bin = root.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let pdftotext = bin.join("pdftotext");
        std::fs::write(
            &pdftotext,
            "#!/bin/sh\npython3 - <<'PY' > \"$5\"\nprint('\\x01\\x02\\x03\\x04' * 80 + 'abc123' * 10)\nPY\n",
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&pdftotext).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&pdftotext, permissions).unwrap();
        let _path = PathEnvGuard::prepend(&bin);

        let error = prepare_raw_source(root.path(), "raw/articles/broken.pdf").unwrap_err();

        assert_eq!(error.error_code(), "pdf_extract_unusable");
        assert!(error
            .to_string()
            .contains("raw PDF source does not contain usable extractable text"));
    }

    #[test]
    #[cfg(unix)]
    fn prepare_raw_source_rejects_fallback_text_with_only_pdf_metadata() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempdir().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();
        std::fs::write(root.path().join("raw/articles/broken.pdf"), b"%PDF-1.7\n").unwrap();
        let bin = root.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let pdftotext = bin.join("pdftotext");
        std::fs::write(
            &pdftotext,
            "#!/bin/sh\ncat > \"$5\" <<'TXT'\n［Ｇｅｎｅｒａｌ Ｉｎｆｏｒｍａｔｉｏｎ］\n书名＝Ｍａｖｅｎ 实战\n作者＝许虹斌著\n页数＝３６１\n出版社＝机械工业出版社\n出版日期＝２０１１\nTXT\n",
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&pdftotext).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&pdftotext, permissions).unwrap();
        let _path = PathEnvGuard::prepend(&bin);

        let error = prepare_raw_source(root.path(), "raw/articles/broken.pdf").unwrap_err();

        assert_eq!(error.error_code(), "pdf_extract_unusable");
    }

    #[test]
    #[cfg(unix)]
    fn prepare_raw_source_reports_pdf_extract_failure_when_pdftotext_is_unavailable() {
        let root = tempdir().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();
        std::fs::write(root.path().join("raw/articles/broken.pdf"), b"%PDF-1.7\n").unwrap();
        let _env = DisablePdftotextGuard::new();

        let error = prepare_raw_source(root.path(), "raw/articles/broken.pdf").unwrap_err();

        assert_eq!(error.error_code(), "pdf_extract_failed");
        assert!(error.to_string().contains("pdftotext fallback failed"));
        assert!(error.to_string().contains("pdftotext fallback is disabled"));
    }

    #[cfg(unix)]
    struct DisablePdftotextGuard {
        _lock: MutexGuard<'static, ()>,
        old_value: Option<std::ffi::OsString>,
    }

    #[cfg(unix)]
    impl DisablePdftotextGuard {
        fn new() -> Self {
            let lock = path_env_lock()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let old_value = std::env::var_os("MDX_DISABLE_PDFTOTEXT");
            std::env::set_var("MDX_DISABLE_PDFTOTEXT", "1");
            Self {
                _lock: lock,
                old_value,
            }
        }
    }

    #[cfg(unix)]
    impl Drop for DisablePdftotextGuard {
        fn drop(&mut self) {
            if let Some(old_value) = self.old_value.as_ref() {
                std::env::set_var("MDX_DISABLE_PDFTOTEXT", old_value);
            } else {
                std::env::remove_var("MDX_DISABLE_PDFTOTEXT");
            }
        }
    }

    #[cfg(unix)]
    struct PathEnvGuard {
        _lock: MutexGuard<'static, ()>,
        old_path: Option<std::ffi::OsString>,
        restore_path: bool,
    }

    #[cfg(unix)]
    impl PathEnvGuard {
        fn replace_with_original() -> Self {
            Self {
                _lock: path_env_lock()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()),
                old_path: None,
                restore_path: false,
            }
        }

        fn prepend(path: &std::path::Path) -> Self {
            let lock = path_env_lock()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let old_path = std::env::var_os("PATH");
            let mut paths = vec![path.to_path_buf()];
            if let Some(old_path) = &old_path {
                paths.extend(std::env::split_paths(old_path));
            }
            let next_path = std::env::join_paths(paths).unwrap();
            std::env::set_var("PATH", next_path);

            Self {
                _lock: lock,
                old_path,
                restore_path: true,
            }
        }
    }

    #[cfg(unix)]
    impl Drop for PathEnvGuard {
        fn drop(&mut self) {
            if !self.restore_path {
                return;
            }

            if let Some(old_path) = &self.old_path {
                std::env::set_var("PATH", old_path);
            } else {
                std::env::remove_var("PATH");
            }
        }
    }

    #[cfg(unix)]
    fn path_env_lock() -> &'static std::sync::Mutex<()> {
        super::test_pdf_env_lock()
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
