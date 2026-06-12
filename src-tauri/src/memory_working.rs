use crate::memory_fs::{
    append_memory_log_entry, ensure_memory_ready, read_workspace_file, write_workspace_file,
};
use crate::models::WorkspaceError;

pub fn memory_working_get(root: impl AsRef<std::path::Path>) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;
    read_workspace_file(root, "memory/working.md")
}

pub fn memory_working_set(
    root: impl AsRef<std::path::Path>,
    markdown: String,
) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;
    write_workspace_file(root, "memory/working.md", markdown.as_bytes())?;
    append_memory_log_entry(
        root,
        "memory_working_update action=set path=memory/working.md",
    )?;
    Ok(markdown)
}

pub fn memory_working_append(
    root: impl AsRef<std::path::Path>,
    section: String,
    text: String,
) -> Result<String, WorkspaceError> {
    let root = root.as_ref();
    ensure_memory_ready(root)?;
    let mut markdown = memory_working_get(root)?;
    let heading = format!("## {}", section.trim());
    let bullet = format!("- {}", text.trim());

    if let Some(index) = markdown.find(&heading) {
        let insert_at = markdown[index..]
            .find("\n## ")
            .map(|offset| index + offset)
            .unwrap_or(markdown.len());
        markdown.insert_str(insert_at, &format!("\n{bullet}\n"));
    } else {
        if !markdown.ends_with('\n') {
            markdown.push('\n');
        }
        markdown.push_str(&format!("\n{heading}\n{bullet}\n"));
    }

    write_workspace_file(root, "memory/working.md", markdown.as_bytes())?;
    append_memory_log_entry(
        root,
        &format!(
            "memory_working_update action=append section={} path=memory/working.md",
            section.trim()
        ),
    )?;
    Ok(markdown)
}
