use crate::models::WorkspaceError;

/// Opens a web address in whatever browser the user has.
///
/// Only `http` and `https` are opened. Everything else is refused rather than
/// handed to the operating system: a document is text from somewhere, and `open`
/// will happily launch an application for a scheme nobody in this app intended
/// to support. Refusing is the answer for `javascript:`, `data:` and `file:`
/// alike — nothing here needs them, and the one that would be useful (opening a
/// file) already has a command of its own that checks the workspace it is in.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), WorkspaceError> {
    open_external_url_impl(url, open_external_url_os).map(|_| ())
}

pub(crate) fn open_external_url_impl<T>(
    url: String,
    open: impl FnOnce(&str) -> Result<T, WorkspaceError>,
) -> Result<T, WorkspaceError> {
    let trimmed = url.trim();

    if !is_web_url(trimmed) {
        return Err(WorkspaceError::new(
            "unsupported_url",
            "only http and https addresses are opened",
        ));
    }

    open(trimmed)
}

/// Whether this is a web address, judged on its scheme alone.
///
/// The scheme is compared without case, because `HTTPS://` is the same address
/// and a comparison that missed it would refuse a link that works everywhere
/// else. Anything before the scheme — whitespace, a control character, another
/// scheme — means this is not one.
fn is_web_url(url: &str) -> bool {
    let Some((scheme, rest)) = url.split_once("://") else {
        return false;
    };

    if rest.is_empty() {
        return false;
    }

    matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https")
}

#[cfg(target_os = "macos")]
fn open_external_url_os(url: &str) -> Result<(), WorkspaceError> {
    // `--` so an address starting with a dash is an argument rather than a flag.
    std::process::Command::new("open")
        .arg("--")
        .arg(url)
        .status()
        .map_err(|error| {
            WorkspaceError::from_io("open_failed", "failed to open the address", &error)
        })
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(WorkspaceError::new(
                    "open_failed",
                    format!("the browser exited with status {status}"),
                ))
            }
        })
}

#[cfg(not(target_os = "macos"))]
fn open_external_url_os(_url: &str) -> Result<(), WorkspaceError> {
    Err(WorkspaceError::new(
        "open_failed",
        "opening a web address is only enabled on macOS",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opened(url: &str) -> Result<String, WorkspaceError> {
        open_external_url_impl(url.to_string(), |opened| Ok(opened.to_string()))
    }

    #[test]
    fn opens_web_addresses() {
        assert_eq!(opened("https://example.com/docs").unwrap(), "https://example.com/docs");
        assert_eq!(opened("http://example.com").unwrap(), "http://example.com");
        // The scheme is a scheme whatever case it is written in.
        assert_eq!(opened("HTTPS://example.com").unwrap(), "HTTPS://example.com");
        // Surrounding whitespace is not part of the address.
        assert_eq!(opened("  https://example.com  ").unwrap(), "https://example.com");
    }

    #[test]
    fn refuses_everything_else() {
        for url in [
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///etc/passwd",
            "mailto:someone@example.com",
            "vscode://file/etc/passwd",
            "notes/other.md",
            "https://",
            "",
            " ",
        ] {
            let error = opened(url).expect_err(url);
            assert_eq!(error.error_code(), "unsupported_url", "{url}");
        }
    }

    #[test]
    fn refuses_an_address_with_something_in_front_of_its_scheme() {
        // Whatever sits in front of the scheme is part of the scheme as far as
        // this reads it, and "x https" is not one this app opens. Surrounding
        // whitespace is the exception, and it is trimmed above.
        for url in [
            "x https://example.com",
            "ht tp://example.com",
            "://example.com",
        ] {
            assert_eq!(
                opened(url).expect_err(url).error_code(),
                "unsupported_url",
                "{url}"
            );
        }
    }
}
