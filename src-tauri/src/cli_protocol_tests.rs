use crate::cli_protocol::{
    list_response_from_snapshot, resolve_cli_path, CliRequest, CliWikiSearchResult, TabSnapshot,
    WorkspaceSnapshot,
};
use crate::memory::MemoryWorkspaceStatus;

mod mdx_cli_for_tests {
    #![allow(dead_code)]

    use crate as mdx_lib;

    include!("bin/mdx_cli.rs");
}

mod mdx_mcp_for_tests {
    #![allow(dead_code)]

    use crate as mdx_lib;

    include!("bin/mdx_mcp.rs");
}

#[test]
fn parses_open_and_save_commands() {
    let open: CliRequest = serde_json::from_str(r#"{"cmd":"open","path":"/tmp/ws/a.md"}"#).unwrap();
    assert!(matches!(open, CliRequest::Open { path } if path == "/tmp/ws/a.md"));

    let save: CliRequest = serde_json::from_str(r#"{"cmd":"save","tab_id":"tab-1"}"#).unwrap();
    assert!(matches!(save, CliRequest::Save { tab_id } if tab_id == Some("tab-1".into())));
}

#[test]
fn rejects_paths_outside_active_workspace() {
    let snapshot = WorkspaceSnapshot {
        root_path: Some("/tmp/ws".into()),
        active_tab_id: Some("tab-1".into()),
        tabs: vec![],
    };
    let err = resolve_cli_path(&snapshot, "/tmp/other/a.md").unwrap_err();
    assert_eq!(err.error_code(), "outside_workspace");
}

#[test]
fn list_returns_windows_workspace_tabs_and_dirty_state() {
    let snapshot = WorkspaceSnapshot {
        root_path: Some("/tmp/ws".into()),
        active_tab_id: Some("tab-1".into()),
        tabs: vec![TabSnapshot {
            tab_id: "tab-1".into(),
            path: "/tmp/ws/a.md".into(),
            title: "a.md".into(),
            dirty: true,
        }],
    };
    let response = list_response_from_snapshot(&snapshot);
    assert!(response.ok);
    assert_eq!(response.tabs[0].tab_id, "tab-1");
    assert!(response.tabs[0].dirty);
}

#[test]
fn parses_llm_wiki_query_and_search_commands() {
    let query: CliRequest =
        serde_json::from_str(r#"{"cmd":"llm-wiki-query","question":"raw 目录是什么"}"#).unwrap();
    assert!(matches!(query, CliRequest::LlmWikiQuery { question } if question == "raw 目录是什么"));

    let search: CliRequest =
        serde_json::from_str(r#"{"cmd":"llm-wiki-search","query":"Document Mode"}"#).unwrap();
    assert!(matches!(search, CliRequest::LlmWikiSearch { query } if query == "Document Mode"));
}

#[test]
fn parses_llm_wiki_status_request() {
    let request: CliRequest = serde_json::from_str(r#"{"cmd":"llm-wiki-status"}"#).unwrap();
    assert_eq!(request, CliRequest::LlmWikiStatus);
}

#[test]
fn parses_memory_hook_command_without_desktop_socket() {
    let command = mdx_cli_for_tests::parse_command_for_test([
        "mdx-cli",
        "memory",
        "--root",
        "/tmp/ws",
        "hook",
        "codex",
        "UserPromptSubmit",
        "--deadline-ms",
        "400",
    ])
    .unwrap();

    let debug = format!("{command:?}");
    assert!(debug.contains("Hook"));
    assert!(debug.contains("codex"));
    assert!(debug.contains("UserPromptSubmit"));
}

#[test]
fn parses_memory_migrate_storage_dry_run() {
    let command = mdx_cli_for_tests::parse_command_for_test([
        "mdx-cli",
        "memory",
        "--root",
        "/tmp/ws",
        "migrate",
        "storage",
        "--to",
        "postgres",
        "--dry-run",
    ])
    .unwrap();

    let debug = format!("{command:?}");
    assert!(debug.contains("Migrate"));
    assert!(debug.contains("Storage"));
    assert!(debug.contains("postgres"));
    assert!(debug.contains("dry_run: true"));
}

#[test]
fn mcp_lists_memory_backend_tools() {
    let manifest = mdx_mcp_for_tests::tools_manifest_for_test();
    let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
    let tools = manifest["tools"].as_array().unwrap();

    for name in [
        "memory_recall",
        "memory_search",
        "memory_add",
        "memory_inbox_add",
        "memory_inbox_list",
        "memory_inbox_accept",
        "memory_hook_status",
        "memory_diagnostics",
    ] {
        assert!(
            tools.iter().any(|tool| tool["name"].as_str() == Some(name)),
            "missing MCP tool {name}"
        );
    }

    let hook_status = tools
        .iter()
        .find(|tool| tool["name"].as_str() == Some("memory_hook_status"))
        .unwrap();
    assert_eq!(
        hook_status["inputSchema"]["properties"]["agent"]["type"],
        "string"
    );

    let diagnostics = tools
        .iter()
        .find(|tool| tool["name"].as_str() == Some("memory_diagnostics"))
        .unwrap();
    assert_eq!(
        diagnostics["inputSchema"]["properties"]["include_logs"]["type"],
        "boolean"
    );
}

#[test]
fn parses_llm_wiki_ingest_request() {
    let request: CliRequest =
        serde_json::from_str(r#"{"cmd":"llm-wiki-ingest","rawPath":"raw/notes/a.md"}"#).unwrap();
    assert_eq!(
        request,
        CliRequest::LlmWikiIngest {
            raw_path: "raw/notes/a.md".to_string()
        }
    );
}

#[test]
fn parses_llm_wiki_digest_request() {
    let request: CliRequest = serde_json::from_str(
        r#"{"cmd":"llm-wiki-digest","title":"karpathy-llm-wiki","prompt":"Summarize"}"#,
    )
    .unwrap();
    assert_eq!(
        request,
        CliRequest::LlmWikiDigest {
            title: "karpathy-llm-wiki".to_string(),
            prompt: "Summarize".to_string()
        }
    );
}

#[test]
fn parses_llm_wiki_lint_request() {
    let request: CliRequest = serde_json::from_str(r#"{"cmd":"llm-wiki-lint"}"#).unwrap();
    assert_eq!(request, CliRequest::LlmWikiLint);
}

#[test]
fn serializes_llm_wiki_query_response_as_snake_case_json() {
    let response = crate::cli_protocol::CliResponse {
        ok: true,
        answer: Some("raw 目录用于存放一手素材。".to_string()),
        references: Some(vec![CliWikiSearchResult {
            path: "wiki/concepts/raw.md".to_string(),
            title: "raw".to_string(),
            snippet: "raw 目录用于存放一手素材".to_string(),
        }]),
        insufficient_context: Some(false),
        ..crate::cli_protocol::CliResponse::default()
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains(r#""ok":true"#));
    assert!(json.contains(r#""answer":"raw 目录用于存放一手素材。""#));
    assert!(json.contains(r#""insufficient_context":false"#));
    assert!(json.contains(r#""references":[{"path":"wiki/concepts/raw.md","title":"raw","snippet":"raw 目录用于存放一手素材"}]"#));
    assert!(!json.contains("insufficientContext"));
}

#[test]
fn serializes_empty_llm_wiki_query_references() {
    let response = crate::cli_protocol::CliResponse {
        ok: true,
        answer: Some("当前知识库中没有足够上下文回答这个问题。".to_string()),
        references: Some(Vec::new()),
        insufficient_context: Some(true),
        ..crate::cli_protocol::CliResponse::default()
    };

    assert_eq!(
        serde_json::to_string(&response).unwrap(),
        r#"{"ok":true,"answer":"当前知识库中没有足够上下文回答这个问题。","references":[],"insufficient_context":true}"#
    );
}

#[test]
fn serializes_empty_llm_wiki_search_results() {
    let response = crate::cli_protocol::CliResponse {
        ok: true,
        results: Some(Vec::new()),
        ..crate::cli_protocol::CliResponse::default()
    };

    assert_eq!(
        serde_json::to_string(&response).unwrap(),
        r#"{"ok":true,"results":[]}"#
    );
}

#[test]
fn parses_memory_status_and_thread_save_requests() {
    let status: CliRequest = serde_json::from_str(r#"{"cmd":"memory-status"}"#).unwrap();
    assert_eq!(status, CliRequest::MemoryStatus);

    let save: CliRequest = serde_json::from_str(
        r#"{"cmd":"memory-thread-save","source":"manual","thread_id":"thread-1","title":"Decision","body":"Use Markdown memory."}"#,
    )
    .unwrap();
    assert!(matches!(
        save,
        CliRequest::MemoryThreadSave {
            source,
            thread_id,
            title,
            body,
        } if source == "manual"
            && thread_id == Some("thread-1".to_string())
            && title == "Decision"
            && body == "Use Markdown memory."
    ));
}

#[test]
fn parses_memory_bundle_requests() {
    let export: CliRequest = serde_json::from_str(
        r#"{"cmd":"memory-export","output_path":"/tmp/memory-bundle","include_log":true}"#,
    )
    .unwrap();
    assert_eq!(
        export,
        CliRequest::MemoryExport {
            output_path: "/tmp/memory-bundle".to_string(),
            include_log: true,
        }
    );

    let import: CliRequest = serde_json::from_str(
        r#"{"cmd":"memory-import","input_path":"/tmp/memory-bundle","dry_run":true}"#,
    )
    .unwrap();
    assert_eq!(
        import,
        CliRequest::MemoryImport {
            input_path: "/tmp/memory-bundle".to_string(),
            strategy: "skip".to_string(),
            dry_run: true,
        }
    );
}

#[test]
fn parses_memory_inbox_requests() {
    let list: CliRequest =
        serde_json::from_str(r#"{"cmd":"memory-inbox-list","include_reviewed":true}"#).unwrap();
    assert_eq!(
        list,
        CliRequest::MemoryInboxList {
            include_reviewed: true
        }
    );

    let accept: CliRequest = serde_json::from_str(
        r#"{"cmd":"memory-inbox-accept","inbox_id":"inbox_1","title":"Reviewed","body":"Accepted"}"#,
    )
    .unwrap();
    assert_eq!(
        accept,
        CliRequest::MemoryInboxAccept {
            inbox_id: "inbox_1".to_string(),
            title: Some("Reviewed".to_string()),
            body: Some("Accepted".to_string()),
            tags: None,
        }
    );

    let reject: CliRequest =
        serde_json::from_str(r#"{"cmd":"memory-inbox-reject","inbox_id":"inbox_1"}"#).unwrap();
    assert_eq!(
        reject,
        CliRequest::MemoryInboxReject {
            inbox_id: "inbox_1".to_string()
        }
    );
}

#[test]
fn parses_memory_distill_request() {
    let request: CliRequest = serde_json::from_str(
        r#"{"cmd":"memory-distill","target":"codex:abc123","accept":true,"force":true}"#,
    )
    .unwrap();
    assert_eq!(
        request,
        CliRequest::MemoryDistill {
            target: "codex:abc123".to_string(),
            accept: Some(true),
            force: Some(true),
        }
    );
}

#[test]
fn parses_memory_capture_requests() {
    let import: CliRequest = serde_json::from_str(
        r#"{"cmd":"memory-capture-import","source":"codex","file":"/tmp/codex.jsonl","thread_id":"codex:1","title":"Codex","distill":true}"#,
    )
    .unwrap();
    assert_eq!(
        import,
        CliRequest::MemoryCaptureImport {
            source: "codex".to_string(),
            path: "/tmp/codex.jsonl".to_string(),
            title: Some("Codex".to_string()),
            thread_id: Some("codex:1".to_string()),
            distill: true,
        }
    );
}

#[test]
fn parses_memory_capture_scan_request() {
    let scan: CliRequest =
        serde_json::from_str(r#"{"cmd":"memory-capture-scan","source":"codex"}"#).unwrap();
    assert_eq!(
        scan,
        CliRequest::MemoryCaptureScan {
            source: "codex".to_string(),
            import_threads: false,
            distill: false,
        }
    );

    let scan_with_import: CliRequest = serde_json::from_str(
        r#"{"cmd":"memory-capture-scan","source":"codex","import":true,"distill":true}"#,
    )
    .unwrap();
    assert_eq!(
        scan_with_import,
        CliRequest::MemoryCaptureScan {
            source: "codex".to_string(),
            import_threads: true,
            distill: true,
        }
    );
}

#[test]
fn serializes_memory_status_response_as_snake_case_json() {
    let response = crate::cli_protocol::CliResponse {
        ok: true,
        memory_status: Some(MemoryWorkspaceStatus {
            mode: "ordinary".to_string(),
            has_memory: false,
            can_initialize: true,
            missing_paths: vec!["memory".to_string()],
        }),
        ..crate::cli_protocol::CliResponse::default()
    };

    assert_eq!(
        serde_json::to_string(&response).unwrap(),
        r#"{"ok":true,"memory_status":{"mode":"ordinary","has_memory":false,"can_initialize":true,"missing_paths":["memory"]}}"#
    );
}

#[test]
fn serializes_memory_bundle_response_as_snake_case_json() {
    let response = crate::cli_protocol::CliResponse {
        ok: true,
        memory_export: Some(crate::memory::MemoryExportResult {
            manifest_path: "/tmp/memory-bundle/manifest.json".to_string(),
            output_path: "/tmp/memory-bundle".to_string(),
            version: 1,
            records_exported: 1,
            files_exported: 1,
            memory_count: 1,
            inbox_count: 0,
            thread_count: 0,
            log_included: false,
            copied_paths: vec!["memory/memories/2026-06-13-bundle.md".to_string()],
        }),
        ..crate::cli_protocol::CliResponse::default()
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains(r#""memory_export":{"manifest_path":"/tmp/memory-bundle/manifest.json""#));
    assert!(json.contains(r#""records_exported":1"#));
    assert!(!json.contains("manifestPath"));
}

#[test]
fn serializes_memory_distill_response_as_snake_case_json() {
    let response = crate::cli_protocol::CliResponse {
        ok: true,
        memory_distill: Some(crate::memory::MemoryDistillResult {
            target: "codex:abc123".to_string(),
            source_thread: "codex:abc123".to_string(),
            accepted: false,
            candidate_count: 1,
            inbox_count: 1,
            memory_count: 0,
            candidates: vec![crate::memory::DistillCandidate {
                title: "Use JWT".to_string(),
                body: "The project uses JWT access tokens.".to_string(),
                tags: vec!["auth".to_string()],
                importance: 0.8,
                confidence: 0.9,
                source_message_refs: vec![1],
            }],
            inbox: Vec::new(),
            memories: Vec::new(),
        }),
        ..crate::cli_protocol::CliResponse::default()
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains(r#""memory_distill":{"target":"codex:abc123""#));
    assert!(json.contains(r#""candidate_count":1"#));
    assert!(json.contains(r#""source_message_refs":[1]"#));
    assert!(!json.contains("candidateCount"));
}

#[test]
fn serializes_memory_capture_responses_as_snake_case_json() {
    let capture_path = "/Users/example/.codex/sessions/2026/06/14/rollout-a.jsonl";
    let response = crate::cli_protocol::CliResponse {
        ok: true,
        memory_capture_import: Some(crate::memory::MemoryCaptureImportResult {
            source: "codex".to_string(),
            thread_id: "codex:abc123".to_string(),
            path: "memory/threads/codex/thread.md".to_string(),
            title: "Codex".to_string(),
            message_count: 2,
            distilled: false,
            distill_status: "failed".to_string(),
            distill_error_code: Some("distill_unavailable".to_string()),
            distill_error_message: Some("distill_unavailable: unavailable".to_string()),
            distill_result: None,
        }),
        memory_capture_scan: Some(crate::memory::MemoryCaptureScanResult {
            source: "codex".to_string(),
            status: "configured".to_string(),
            paths: vec![capture_path.to_string()],
            candidates: vec![crate::memory::MemoryCaptureCandidate {
                path: capture_path.to_string(),
                source: "codex".to_string(),
                thread_id: Some("codex:abc123".to_string()),
                title: Some("Codex".to_string()),
                started_at: Some("2026-06-14T00:00:00Z".to_string()),
                modified_at: Some("2026-06-14T01:00:00Z".to_string()),
                bytes: 1234,
            }],
        }),
        ..crate::cli_protocol::CliResponse::default()
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains(r#""memory_capture_import":{"source":"codex""#));
    assert!(json.contains(r#""message_count":2"#));
    assert!(json.contains(r#""distill_status":"failed""#));
    assert!(json.contains(r#""distill_error_code":"distill_unavailable""#));
    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    let scan = &value["memory_capture_scan"];
    assert_eq!(scan["source"], "codex");
    assert_eq!(scan["status"], "configured");
    assert_eq!(scan["paths"][0], capture_path);
    assert_eq!(scan["candidates"][0]["path"], capture_path);
    assert_eq!(scan["candidates"][0]["thread_id"], "codex:abc123");
    assert_eq!(scan["candidates"][0]["modified_at"], "2026-06-14T01:00:00Z");
    assert!(!json.contains("messageCount"));
    assert!(!json.contains("distillStatus"));
    assert!(!json.contains("threadId"));
    assert!(!json.contains("modifiedAt"));
}

#[test]
fn serializes_memory_inbox_review_response_as_snake_case_json() {
    let response = crate::cli_protocol::CliResponse {
        ok: true,
        memory_inbox_review: Some(crate::memory::InboxReviewResult {
            inbox_id: "inbox_1".to_string(),
            path: "memory/inbox/2026-06-13-decision.md".to_string(),
            status: "rejected".to_string(),
            accepted_memory_id: None,
            memory: None,
        }),
        ..crate::cli_protocol::CliResponse::default()
    };

    assert_eq!(
        serde_json::to_string(&response).unwrap(),
        r#"{"ok":true,"memory_inbox_review":{"inbox_id":"inbox_1","path":"memory/inbox/2026-06-13-decision.md","status":"rejected","accepted_memory_id":null,"memory":null}}"#
    );
}
