use crate::cli_protocol::{
    list_response_from_snapshot, resolve_cli_path, CliRequest, CliWikiSearchResult, TabSnapshot,
    WorkspaceSnapshot,
};
use crate::memory::MemoryWorkspaceStatus;

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
