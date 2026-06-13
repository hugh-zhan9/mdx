use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::memory::{
    InboxAddRequest, InboxReviewRequest, MemoryAddRequest, MemoryCaptureImportRequest,
    MemoryCaptureScanRequest, MemoryDistillRequest, MemoryExportRequest, MemoryImportRequest,
    MemoryIndexSearchRequest, MemoryListFilter, MemoryPromoteRequest, MemoryRepairRequest,
    RecallRequest, ThreadListFilter, ThreadSaveRequest,
};
use crate::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DaemonResponse {
    pub status: u16,
    pub body: String,
}

pub fn dispatch(
    root: String,
    method: &str,
    path: &str,
    body: &str,
) -> Result<DaemonResponse, WorkspaceError> {
    match (method, path) {
        ("GET", "/health") => health(root),
        ("GET", "/memory/status") => get_json(|| crate::memory::memory_detect_workspace(root)),
        ("POST", "/memory/repair") => post_json(body, |request: MemoryRepairRequest| {
            crate::memory::memory_repair_workspace(root, request)
        }),
        ("POST", "/memory/recall") => post_json(body, |request: RecallRequest| {
            crate::memory::memory_recall(root, request)
        }),
        ("POST", "/memory/add") => post_json(body, |request: MemoryAddRequest| {
            crate::memory::memory_add(root, request)
        }),
        ("POST", "/memory/show") => post_json(body, |request: TargetRequest| {
            crate::memory::memory_get(root, request.target)
        }),
        ("POST", "/memory/list") => post_json(body, |request: MemoryListFilter| {
            crate::memory::memory_list(root, request)
        }),
        ("POST", "/memory/archive") => post_json(body, |request: TargetRequest| {
            crate::memory::memory_archive(root, request.target)
        }),
        ("GET", "/memory/working") => get_json(|| crate::memory::memory_working_get(root)),
        ("POST", "/memory/working/set") => post_json(body, |request: WorkingSetRequest| {
            crate::memory::memory_working_set(root, request.markdown)
        }),
        ("POST", "/memory/working/append") => post_json(body, |request: WorkingAppendRequest| {
            crate::memory::memory_working_append(root, request.section, request.text)
        }),
        ("GET", "/memory/index/status") => get_json(|| crate::memory::memory_index_status(root)),
        ("POST", "/memory/index/rebuild") => get_json(|| crate::memory::memory_index_rebuild(root)),
        ("POST", "/memory/index/search") => post_json(body, |request: MemoryIndexSearchRequest| {
            crate::memory::memory_index_search(root, request)
        }),
        ("POST", "/memory/search") => post_json(body, |request: SearchRequest| {
            crate::memory::memory_search(
                root,
                request.query,
                request.limit,
                request.tag,
                request.since,
            )
        }),
        ("POST", "/memory/thread/save") => post_json(body, |request: ThreadSaveRequest| {
            crate::memory::memory_thread_save(root, request)
        }),
        ("POST", "/memory/thread/show") => post_json(body, |request: TargetRequest| {
            crate::memory::memory_thread_get(root, request.target)
        }),
        ("POST", "/memory/thread/list") => post_json(body, |request: ThreadListFilter| {
            crate::memory::memory_thread_list(root, request)
        }),
        ("POST", "/memory/inbox/add") => post_json(body, |request: InboxAddRequest| {
            crate::memory::memory_inbox_add(root, request)
        }),
        ("POST", "/memory/inbox/show") => post_json(body, |request: TargetRequest| {
            crate::memory::memory_inbox_get(root, request.target)
        }),
        ("POST", "/memory/inbox/list") => post_json(body, |request: InboxListRequest| {
            crate::memory::memory_inbox_list(root, request.include_reviewed)
        }),
        ("POST", "/memory/inbox/accept") => post_json(body, |request: InboxReviewRequest| {
            crate::memory::memory_inbox_accept(root, request)
        }),
        ("POST", "/memory/inbox/reject") => post_json(body, |request: TargetRequest| {
            crate::memory::memory_inbox_reject(root, request.target)
        }),
        ("POST", "/memory/distill") => post_json(body, |request: MemoryDistillRequest| {
            crate::memory::memory_distill(root, request)
        }),
        ("POST", "/memory/promote") => post_json(body, |request: MemoryPromoteRequest| {
            crate::memory::memory_promote(root, request)
        }),
        ("POST", "/memory/capture/import") => {
            post_json(body, |request: MemoryCaptureImportRequest| {
                crate::memory::memory_capture_import(root, request)
            })
        }
        ("POST", "/memory/capture/scan") => post_json(body, |request: MemoryCaptureScanRequest| {
            crate::memory::memory_capture_scan(root, request)
        }),
        ("POST", "/memory/export") => post_json(body, |request: MemoryExportRequest| {
            crate::memory::memory_export_bundle(root, request)
        }),
        ("POST", "/memory/import") => post_json(body, |request: MemoryImportRequest| {
            crate::memory::memory_import_bundle(root, request)
        }),
        _ if known_route(path) => Ok(error_response(
            405,
            "method_not_allowed",
            format!("{method} is not allowed for {path}"),
        )),
        _ => Ok(error_response(
            404,
            "not_found",
            format!("no route for {method} {path}"),
        )),
    }
}

pub fn dispatch_for_test(
    root: String,
    method: &str,
    path: &str,
    body: &str,
) -> Result<DaemonResponse, WorkspaceError> {
    dispatch(root, method, path, body)
}

#[derive(Debug, Deserialize)]
struct TargetRequest {
    target: String,
}

#[derive(Debug, Deserialize)]
struct InboxListRequest {
    #[serde(default)]
    include_reviewed: bool,
}

#[derive(Debug, Deserialize)]
struct SearchRequest {
    query: String,
    limit: Option<usize>,
    tag: Option<String>,
    since: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WorkingSetRequest {
    markdown: String,
}

#[derive(Debug, Deserialize)]
struct WorkingAppendRequest {
    section: String,
    text: String,
}

fn health(root: String) -> Result<DaemonResponse, WorkspaceError> {
    match crate::memory::memory_detect_workspace(root.clone()) {
        Ok(status) => json_response(
            200,
            &json!({
                "ok": true,
                "has_memory": status.has_memory,
                "can_initialize": status.can_initialize,
                "mode": status.mode,
                "missing_paths": status.missing_paths,
                "workspace": root,
                "memory_status": status,
            }),
        ),
        Err(error) => Ok(workspace_error_response(error)),
    }
}

fn get_json<R>(
    handle: impl FnOnce() -> Result<R, WorkspaceError>,
) -> Result<DaemonResponse, WorkspaceError>
where
    R: Serialize,
{
    match handle() {
        Ok(result) => json_response(200, &json!({ "ok": true, "result": result })),
        Err(error) => Ok(workspace_error_response(error)),
    }
}

fn post_json<T, R>(
    body: &str,
    handle: impl FnOnce(T) -> Result<R, WorkspaceError>,
) -> Result<DaemonResponse, WorkspaceError>
where
    T: serde::de::DeserializeOwned,
    R: Serialize,
{
    let request = match serde_json::from_str::<T>(body) {
        Ok(request) => request,
        Err(error) => {
            return Ok(error_response(
                400,
                "invalid_json",
                format!("request body is not valid JSON: {error}"),
            ));
        }
    };

    match handle(request) {
        Ok(result) => json_response(200, &json!({ "ok": true, "result": result })),
        Err(error) => Ok(workspace_error_response(error)),
    }
}

fn known_route(path: &str) -> bool {
    matches!(
        path,
        "/health"
            | "/memory/status"
            | "/memory/repair"
            | "/memory/recall"
            | "/memory/add"
            | "/memory/show"
            | "/memory/list"
            | "/memory/archive"
            | "/memory/working"
            | "/memory/working/set"
            | "/memory/working/append"
            | "/memory/index/status"
            | "/memory/index/rebuild"
            | "/memory/index/search"
            | "/memory/search"
            | "/memory/thread/save"
            | "/memory/thread/show"
            | "/memory/thread/list"
            | "/memory/inbox/add"
            | "/memory/inbox/show"
            | "/memory/inbox/list"
            | "/memory/inbox/accept"
            | "/memory/inbox/reject"
            | "/memory/distill"
            | "/memory/promote"
            | "/memory/capture/import"
            | "/memory/capture/scan"
            | "/memory/export"
            | "/memory/import"
    )
}

fn json_response(status: u16, value: &impl Serialize) -> Result<DaemonResponse, WorkspaceError> {
    serde_json::to_string(value)
        .map(|body| DaemonResponse { status, body })
        .map_err(|error| WorkspaceError::new("json_encode_failed", error.to_string()))
}

fn workspace_error_response(error: WorkspaceError) -> DaemonResponse {
    error_response(500, error.error_code(), error.to_string())
}

fn error_response(
    status: u16,
    error_code: impl AsRef<str>,
    message: impl Into<String>,
) -> DaemonResponse {
    let body = serde_json::to_string(&json!({
        "ok": false,
        "error_code": error_code.as_ref(),
        "message": message.into(),
    }))
    .unwrap_or_else(|_| "{\"ok\":false,\"error_code\":\"json_encode_failed\"}".to_string());

    DaemonResponse { status, body }
}
