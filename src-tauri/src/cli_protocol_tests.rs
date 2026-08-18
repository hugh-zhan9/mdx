use crate::cli_protocol::{
    list_response_from_snapshot, resolve_cli_path, run_memory_request, CliRequest,
    CliWikiSearchResult, TabSnapshot, WorkspaceSnapshot,
};

mod mdx_cli_for_tests {
    #![allow(dead_code)]

    use crate as loam_lib;

    include!("bin/loam_cli.rs");
}

mod mdx_mcp_for_tests {
    #![allow(dead_code)]

    use crate as loam_lib;

    include!("bin/loam_mcp.rs");
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
        "loam-cli",
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

/// The commands that went with the abandoned model are not merely unhandled —
/// they do not parse. An agent or a script written against the old CLI gets a
/// usage error, not a command that quietly does something else.
#[test]
fn the_commands_of_the_abandoned_model_no_longer_parse() {
    for arguments in [
        vec!["loam-cli", "memory", "--root", "/tmp/ws", "inbox", "list"],
        vec!["loam-cli", "memory", "--root", "/tmp/ws", "working", "get"],
        vec![
            "loam-cli", "memory", "--root", "/tmp/ws", "thread", "show", "thread-1",
        ],
        vec!["loam-cli", "memory", "--root", "/tmp/ws", "index", "rebuild"],
        vec![
            "loam-cli", "memory", "--root", "/tmp/ws", "migrate", "storage", "--to", "postgres",
        ],
        vec!["loam-cli", "memory", "--root", "/tmp/ws", "repair"],
        vec!["loam-cli", "memory", "--root", "/tmp/ws", "archive", "mem_1"],
    ] {
        let command = arguments[4];
        assert!(
            mdx_cli_for_tests::parse_command_for_test(arguments.clone()).is_err(),
            "`memory {command}` belongs to a model this product no longer has"
        );
    }
}

/// The other half of the same contract: the replacements do parse.
#[test]
fn the_memory_command_surface_is_the_new_one() {
    for arguments in [
        vec!["loam-cli", "memory", "status"],
        vec!["loam-cli", "memory", "init"],
        vec!["loam-cli", "memory", "model", "--download"],
        vec!["loam-cli", "memory", "reindex"],
        vec!["loam-cli", "memory", "add", "--body", "we chose X"],
        vec!["loam-cli", "memory", "show", "drawer-1"],
        vec!["loam-cli", "memory", "list", "--kind", "conclusion"],
        vec!["loam-cli", "memory", "delete", "drawer-1"],
        vec!["loam-cli", "memory", "search", "auth"],
        vec!["loam-cli", "memory", "context", "auth"],
        vec!["loam-cli", "memory", "brief", "auth"],
        vec!["loam-cli", "memory", "recall", "auth"],
        vec![
            "loam-cli",
            "memory",
            "distill",
            "--statement",
            "We use JWT",
            "--body",
            "Access tokens are JWTs.",
            "--ref",
            "drawer-1",
        ],
        vec!["loam-cli", "memory", "gate", "drawer-1"],
        vec!["loam-cli", "memory", "adopt", "drawer-1"],
        vec![
            "loam-cli",
            "memory",
            "demote",
            "drawer-1",
            "--reason-type",
            "obsolete",
            "--reason",
            "superseded by the new flow",
            "--evidence-ref",
            "drawer-2",
        ],
        vec!["loam-cli", "memory", "promote", "drawer-1"],
        vec!["loam-cli", "memory", "capture", "scan", "--path", "/tmp/ws/notes"],
        vec![
            "loam-cli",
            "memory",
            "capture",
            "import",
            "--path",
            "/tmp/ws/notes",
        ],
        vec!["loam-cli", "memory", "legacy-import", "--dry-run"],
        vec!["loam-cli", "memory", "export", "--output", "/tmp/bundle"],
        vec!["loam-cli", "memory", "import", "--input", "/tmp/bundle"],
    ] {
        let command = arguments[2];
        assert!(
            mdx_cli_for_tests::parse_command_for_test(arguments.clone()).is_ok(),
            "`memory {command}` is part of the memory protocol and must parse"
        );
    }
}

#[test]
fn mcp_lists_memory_backend_tools() {
    let manifest = mdx_mcp_for_tests::tools_manifest_for_test();
    let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
    let tools = manifest["tools"].as_array().unwrap();

    for name in [
        "memory_recall",
        "memory_search",
        "memory_context",
        "memory_brief",
        "memory_add",
        "memory_show",
        "memory_distill",
        "memory_gate",
        "memory_adopt",
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
fn parses_the_memory_protocol_requests() {
    let status: CliRequest = serde_json::from_str(r#"{"cmd":"memory-status"}"#).unwrap();
    assert_eq!(status, CliRequest::MemoryStatus);

    let add: CliRequest =
        serde_json::from_str(r#"{"cmd":"memory-add","body":"we chose SQLite"}"#).unwrap();
    assert_eq!(
        add,
        CliRequest::MemoryAdd {
            body: "we chose SQLite".to_string(),
            source: None,
        }
    );

    let distill: CliRequest = serde_json::from_str(
        r#"{"cmd":"memory-distill","statement":"We use JWT","body":"Access tokens are JWTs.","supporting_refs":["drawer-1"]}"#,
    )
    .unwrap();
    assert_eq!(
        distill,
        CliRequest::MemoryDistill {
            statement: "We use JWT".to_string(),
            body: "Access tokens are JWTs.".to_string(),
            tier: None,
            supporting_refs: vec!["drawer-1".to_string()],
        }
    );

    let demote: CliRequest = serde_json::from_str(
        r#"{"cmd":"memory-demote","drawer_id":"drawer-1","reason_type":"contradicted","reason":"the flow changed","evidence_refs":["drawer-2"],"retire":true}"#,
    )
    .unwrap();
    assert_eq!(
        demote,
        CliRequest::MemoryDemote {
            drawer_id: "drawer-1".to_string(),
            reason_type: "contradicted".to_string(),
            reason: "the flow changed".to_string(),
            evidence_refs: vec!["drawer-2".to_string()],
            retire: true,
        }
    );

    let model: CliRequest = serde_json::from_str(r#"{"cmd":"memory-model"}"#).unwrap();
    assert_eq!(model, CliRequest::MemoryModel { download: false });

    let legacy: CliRequest =
        serde_json::from_str(r#"{"cmd":"memory-legacy-import","dry_run":true}"#).unwrap();
    assert_eq!(legacy, CliRequest::MemoryLegacyImport { dry_run: true });
}

#[test]
fn parses_memory_bundle_requests() {
    let export: CliRequest =
        serde_json::from_str(r#"{"cmd":"memory-export","output_path":"/tmp/memory-bundle"}"#)
            .unwrap();
    assert_eq!(
        export,
        CliRequest::MemoryExport {
            output_path: "/tmp/memory-bundle".to_string(),
        }
    );

    let import: CliRequest =
        serde_json::from_str(r#"{"cmd":"memory-import","input_path":"/tmp/memory-bundle"}"#)
            .unwrap();
    assert_eq!(
        import,
        CliRequest::MemoryImport {
            input_path: "/tmp/memory-bundle".to_string(),
        }
    );
}

/// The wire is a contract too: the old commands are not accepted as JSON
/// either, so a script that kept sending them fails loudly.
#[test]
fn the_wire_commands_of_the_abandoned_model_no_longer_deserialize() {
    for line in [
        r#"{"cmd":"memory-inbox-list","include_reviewed":true}"#,
        r#"{"cmd":"memory-inbox-accept","inbox_id":"inbox_1"}"#,
        r#"{"cmd":"memory-inbox-reject","inbox_id":"inbox_1"}"#,
        r#"{"cmd":"memory-working-get"}"#,
        r##"{"cmd":"memory-working-set","content":"# Working"}"##,
        r#"{"cmd":"memory-thread-save","source":"manual","title":"T","body":"B"}"#,
        r#"{"cmd":"memory-thread-list"}"#,
        r#"{"cmd":"memory-index-status"}"#,
        r#"{"cmd":"memory-index-rebuild"}"#,
        r#"{"cmd":"memory-repair"}"#,
        r#"{"cmd":"memory-archive","target":"mem_1"}"#,
    ] {
        assert!(
            serde_json::from_str::<CliRequest>(line).is_err(),
            "{line} names a concept this product no longer has"
        );
    }
}

/// The payload a memory command answers with is whatever the memory layer
/// returned, verbatim. The CLI does not restate those shapes, so the three
/// protocol surfaces cannot drift into describing the same answer differently.
#[test]
fn a_memory_response_carries_the_memory_layer_payload_unchanged() {
    crate::memory::config::testing::with_scoped_home(|_home| {
        let workspace = tempfile::tempdir().unwrap();

        let response = run_memory_request(workspace.path(), CliRequest::MemoryStatus);

        assert!(response.ok, "{:?}", response.error);
        let payload = response.memory.expect("a status payload");
        assert_eq!(payload["enabled"], false);
        assert!(payload["model"].as_str().is_some());
        let json = serde_json::to_string(&crate::cli_protocol::CliResponse {
            ok: true,
            memory: Some(payload),
            ..crate::cli_protocol::CliResponse::default()
        })
        .unwrap();
        assert!(json.starts_with(r#"{"ok":true,"memory":{"#));
    });
}

/// Turning memory on binds the workspace to a project and writes nothing else:
/// there is no `memory/` tree to create any more.
#[test]
fn initializing_memory_enables_it_and_binds_the_workspace() {
    crate::memory::config::testing::with_scoped_home(|_home| {
        let workspace = tempfile::tempdir().unwrap();

        let response = run_memory_request(workspace.path(), CliRequest::MemoryInit);

        assert!(response.ok, "{:?}", response.error);
        let payload = response.memory.expect("a status payload");
        assert_eq!(payload["enabled"], true);
        assert!(payload["wing"].as_str().is_some(), "{payload}");
        assert!(!workspace.path().join("memory").exists());
    });
}

/// Without the embedding model nothing may be written, and the reason has to
/// survive the trip to the caller unchanged.
#[test]
fn writing_material_without_the_model_fails_with_the_upstream_error_code() {
    crate::memory::config::testing::with_scoped_home(|_home| {
        let workspace = tempfile::tempdir().unwrap();

        let response = run_memory_request(
            workspace.path(),
            CliRequest::MemoryAdd {
                body: "we chose SQLite".to_string(),
                source: None,
            },
        );

        assert!(!response.ok);
        assert_eq!(
            response.error_code.as_deref(),
            Some("embedding_model_missing")
        );
        assert!(response.memory.is_none());
    });
}

#[test]
fn an_empty_query_is_rejected_before_the_library_is_opened() {
    let response = run_memory_request(
        std::path::Path::new("/tmp/ws"),
        CliRequest::MemorySearch {
            query: "   ".to_string(),
            limit: None,
            wing: None,
            room: None,
        },
    );

    assert!(!response.ok);
    assert_eq!(response.error_code.as_deref(), Some("invalid_query"));
}

/// The capture pair previews before it stores, because material cannot be
/// un-remembered once it is in the library.
#[test]
fn capture_scan_reports_where_a_path_would_be_filed_without_storing_it() {
    crate::memory::config::testing::with_scoped_home(|_home| {
        let workspace = tempfile::tempdir().unwrap();
        let transcript = workspace.path().join("notes").join("session.md");
        std::fs::create_dir_all(transcript.parent().unwrap()).unwrap();
        std::fs::write(&transcript, "a whole conversation").unwrap();

        let response = run_memory_request(
            workspace.path(),
            CliRequest::MemoryCaptureScan {
                path: transcript.to_string_lossy().into_owned(),
            },
        );

        assert!(response.ok, "{:?}", response.error);
        let payload = response.memory.expect("a capture target");
        assert_eq!(payload["room"], "notes");
        assert_eq!(payload["path"], transcript.to_string_lossy().as_ref());
    });
}

#[test]
fn capture_scan_refuses_a_path_that_is_not_there() {
    let workspace = tempfile::tempdir().unwrap();

    let response = run_memory_request(
        workspace.path(),
        CliRequest::MemoryCaptureScan {
            path: workspace
                .path()
                .join("nothing-here.md")
                .to_string_lossy()
                .into_owned(),
        },
    );

    assert!(!response.ok);
    assert_eq!(response.error_code.as_deref(), Some("invalid_path"));
}

#[test]
fn the_memory_executor_refuses_a_command_that_is_not_a_memory_command() {
    let response = run_memory_request(
        std::path::Path::new("/tmp/ws"),
        CliRequest::Open {
            path: "/tmp/ws/a.md".to_string(),
        },
    );

    assert!(!response.ok);
    assert_eq!(response.error_code.as_deref(), Some("not_a_memory_command"));
}
