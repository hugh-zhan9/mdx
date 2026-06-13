use serde::Serialize;
use serde_json::json;

use crate::memory::{MemoryAddRequest, RecallRequest, ThreadSaveRequest};
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
        ("POST", "/memory/recall") => post_json(body, |request: RecallRequest| {
            crate::memory::memory_recall(root, request)
        }),
        ("POST", "/memory/add") => post_json(body, |request: MemoryAddRequest| {
            crate::memory::memory_add(root, request)
        }),
        ("POST", "/memory/thread/save") => post_json(body, |request: ThreadSaveRequest| {
            crate::memory::memory_thread_save(root, request)
        }),
        (_, "/health" | "/memory/recall" | "/memory/add" | "/memory/thread/save") => {
            Ok(error_response(
                405,
                "method_not_allowed",
                format!("{method} is not allowed for {path}"),
            ))
        }
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
