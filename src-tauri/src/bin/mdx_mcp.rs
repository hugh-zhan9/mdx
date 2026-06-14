use std::io::{self, BufRead, Write};

use mdx_lib::memory::{
    memory_add, memory_detect_workspace, memory_distill, memory_inbox_accept, memory_inbox_add,
    memory_inbox_list, memory_promote, memory_recall, memory_search, memory_thread_get,
    memory_thread_save, memory_working_get, InboxAddRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const TOOLS: &[&str] = &[
    "memory_status",
    "memory_recall",
    "memory_working_get",
    "memory_add",
    "memory_thread_save",
    "memory_thread_show",
    "memory_inbox_list",
    "memory_inbox_add",
    "memory_inbox_accept",
    "memory_distill",
    "memory_search",
    "memory_promote",
];

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    #[serde(default)]
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i64,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct ToolCallParams {
    name: String,
    #[serde(default)]
    arguments: Value,
}

#[derive(Debug, Deserialize)]
struct ThreadShowArguments {
    target: String,
}

#[derive(Debug, Deserialize)]
struct InboxListArguments {
    #[serde(default)]
    include_reviewed: bool,
}

#[derive(Debug, Deserialize)]
struct InboxAddArguments {
    title: String,
    body: String,
    source_thread: Option<String>,
    #[serde(default)]
    source_message_refs: Vec<String>,
    importance: Option<f64>,
    confidence: Option<f64>,
    tags: Vec<String>,
    distill_run_id: Option<String>,
}

impl From<InboxAddArguments> for InboxAddRequest {
    fn from(arguments: InboxAddArguments) -> Self {
        Self {
            title: arguments.title,
            body: arguments.body,
            source_thread: arguments.source_thread,
            source_message_refs: arguments.source_message_refs,
            importance: arguments.importance,
            confidence: arguments.confidence,
            tags: arguments.tags,
            distill_run_id: arguments.distill_run_id,
        }
    }
}

#[derive(Debug, Deserialize)]
struct SearchArguments {
    query: String,
    limit: Option<usize>,
    tag: Option<String>,
    since: Option<String>,
}

fn parse_request(line: &str) -> Result<JsonRpcRequest, serde_json::Error> {
    serde_json::from_str(line)
}

fn main() {
    let workspace = match parse_workspace_arg(std::env::args().skip(1)) {
        Ok(workspace) => workspace,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };

    if let Err(error) = run_stdio(&workspace, io::stdin().lock(), io::stdout().lock()) {
        eprintln!("mdx-mcp stdio error: {error}");
        std::process::exit(1);
    }
}

fn parse_workspace_arg<I>(args: I) -> Result<String, String>
where
    I: IntoIterator<Item = String>,
{
    let mut workspace = None;
    let mut args = args.into_iter();

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--workspace" => {
                if workspace.is_some() {
                    return Err("mdx-mcp received duplicate --workspace argument".to_string());
                }

                let value = args
                    .next()
                    .ok_or_else(|| "mdx-mcp requires --workspace <path>".to_string())?;
                if value.trim().is_empty() || value.starts_with("--") {
                    return Err("mdx-mcp requires --workspace <path>".to_string());
                }

                workspace = Some(value);
            }
            _ => {
                return Err(format!("mdx-mcp unknown argument: {arg}"));
            }
        }
    }

    workspace.ok_or_else(|| "mdx-mcp requires --workspace <path>".to_string())
}

fn run_stdio<R, W>(workspace: &str, reader: R, mut writer: W) -> io::Result<()>
where
    R: BufRead,
    W: Write,
{
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let response = handle_line(workspace, &line);
        serde_json::to_writer(&mut writer, &response)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }

    Ok(())
}

fn handle_line(workspace: &str, line: &str) -> JsonRpcResponse {
    match parse_request(line) {
        Ok(request) => handle_request(workspace, request),
        Err(error) => JsonRpcResponse {
            jsonrpc: "2.0",
            id: Value::Null,
            result: None,
            error: Some(JsonRpcError {
                code: -32700,
                message: format!("Parse error: {error}"),
                data: None,
            }),
        },
    }
}

fn handle_request(workspace: &str, request: JsonRpcRequest) -> JsonRpcResponse {
    let id = request.id.clone();
    if request.jsonrpc != "2.0" {
        return error_response(
            id,
            -32600,
            "Invalid Request: jsonrpc must be \"2.0\"".to_string(),
            None,
        );
    }

    let result = match request.method.as_str() {
        "initialize" => Ok(initialize_result()),
        "notifications/initialized" => Ok(Value::Null),
        "tools/list" => Ok(list_tools_result()),
        "tools/call" => dispatch_tool_call(workspace, request.params),
        method => Err(protocol_error(
            -32601,
            format!("Method not found: {method}"),
            None,
        )),
    };

    match result {
        Ok(result) => JsonRpcResponse {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        },
        Err(error) => error_response(id, error.code, error.message, error.data),
    }
}

fn initialize_result() -> Value {
    json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {
            "tools": {
                "listChanged": false
            }
        },
        "serverInfo": {
            "name": "mdx-memory",
            "version": env!("CARGO_PKG_VERSION")
        }
    })
}

fn list_tools_result() -> Value {
    let tools: Vec<Value> = TOOLS.iter().map(|name| tool_descriptor(name)).collect();
    json!({ "tools": tools })
}

fn tool_descriptor(name: &str) -> Value {
    let (description, properties, required) = match name {
        "memory_status" => (
            "Inspect whether the workspace has MDX Memory initialized.",
            json!({}),
            json!([]),
        ),
        "memory_recall" => (
            "Recall relevant working memory, memories, and thread context. Consult this at the start of a conversation/task when prior context may matter.",
            json!({
                "query": { "type": "string" },
                "limit": { "type": "integer" },
                "byte_budget": { "type": "integer" },
                "include_working": { "type": "boolean" },
                "include_threads": { "type": "boolean" },
                "thread_ids": { "type": "array", "items": { "type": "string" } },
                "include_wiki_refs": { "type": "boolean" },
                "include_wiki_snippets": { "type": "boolean" },
                "tag": { "type": "string" },
                "since": { "type": "string" }
            }),
            json!(["query"]),
        ),
        "memory_working_get" => (
            "Read the workspace working memory markdown.",
            json!({}),
            json!([]),
        ),
        "memory_add" => (
            "Add a durable memory snapshot during active conversation turns for clear, durable, low-risk user preferences, facts, or decisions. Search first when duplicate risk exists to avoid duplicates. For sensitive or uncertain candidates, ask the user before saving or route them through the inbox.",
            json!({
                "title": { "type": "string" },
                "body": { "type": "string" },
                "tags": { "type": "array", "items": { "type": "string" } },
                "source_thread": { "type": "string" },
                "source_message_refs": { "type": "array", "items": { "type": "string" } },
                "importance": { "type": "number" },
                "confidence": { "type": "number" }
            }),
            json!(["title", "body", "tags"]),
        ),
        "memory_thread_save" => (
            "Save a source agent thread into MDX Memory.",
            json!({
                "source": { "type": "string" },
                "thread_id": { "type": "string" },
                "title": { "type": "string" },
                "body": { "type": "string" },
                "started_at": { "type": "string" },
                "ended_at": { "type": "string" },
                "model": { "type": "string" },
                "workspace_root": { "type": "string" },
                "tags": { "type": "array", "items": { "type": "string" } }
            }),
            json!(["source", "title", "body", "tags"]),
        ),
        "memory_thread_show" => (
            "Show a saved memory thread by id or path.",
            json!({ "target": { "type": "string" } }),
            json!(["target"]),
        ),
        "memory_inbox_list" => (
            "List memory inbox candidates.",
            json!({ "include_reviewed": { "type": "boolean" } }),
            json!([]),
        ),
        "memory_inbox_add" => (
            "Add a memory inbox candidate for sensitive, private, or uncertain memory candidates that should be reviewed before becoming durable memory.",
            json!({
                "title": { "type": "string" },
                "body": { "type": "string" },
                "source_thread": { "type": "string" },
                "source_message_refs": { "type": "array", "items": { "type": "string" } },
                "importance": { "type": "number" },
                "confidence": { "type": "number" },
                "tags": { "type": "array", "items": { "type": "string" } },
                "distill_run_id": { "type": "string" }
            }),
            json!(["title", "body", "tags"]),
        ),
        "memory_inbox_accept" => (
            "Accept a memory inbox candidate into durable memories.",
            json!({
                "inbox_id": { "type": "string" },
                "title": { "type": "string" },
                "body": { "type": "string" },
                "tags": { "type": "array", "items": { "type": "string" } }
            }),
            json!(["inbox_id"]),
        ),
        "memory_distill" => (
            "Distill a saved thread into inbox candidates or memories as a thread/background workflow. This is not the only path for memory extraction; use memory_add during active turns when a clear durable memory is ready.",
            json!({
                "target": { "type": "string" },
                "accept": { "type": "boolean" },
                "force": { "type": "boolean" }
            }),
            json!(["target", "accept", "force"]),
        ),
        "memory_search" => (
            "Search durable memory summaries. Use before adding durable memories when duplicate risk exists.",
            json!({
                "query": { "type": "string" },
                "limit": { "type": "integer" },
                "tag": { "type": "string" },
                "since": { "type": "string" }
            }),
            json!(["query"]),
        ),
        "memory_promote" => (
            "Promote a memory or thread into wiki raw material.",
            json!({
                "target": { "type": "string" },
                "ingest": { "type": "boolean" },
                "title": { "type": "string" }
            }),
            json!(["target", "ingest"]),
        ),
        _ => unreachable!("tool descriptor requested for unregistered tool"),
    };

    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required
        }
    })
}

fn dispatch_tool_call(workspace: &str, params: Value) -> Result<Value, ProtocolError> {
    let params: ToolCallParams = serde_json::from_value(params).map_err(|error| {
        protocol_error(-32602, format!("Invalid tools/call params: {error}"), None)
    })?;
    let arguments = if params.arguments.is_null() {
        Value::Object(Default::default())
    } else {
        params.arguments
    };

    match params.name.as_str() {
        "memory_status" => memory_result(memory_detect_workspace(workspace.to_string())),
        "memory_recall" => {
            let request = parse_arguments(arguments)?;
            memory_result(memory_recall(workspace.to_string(), request))
        }
        "memory_working_get" => memory_result(memory_working_get(workspace.to_string())),
        "memory_add" => {
            let request = parse_arguments(arguments)?;
            memory_result(memory_add(workspace.to_string(), request))
        }
        "memory_thread_save" => {
            let request = parse_arguments(arguments)?;
            memory_result(memory_thread_save(workspace.to_string(), request))
        }
        "memory_thread_show" => {
            let arguments: ThreadShowArguments = parse_arguments(arguments)?;
            memory_result(memory_thread_get(workspace.to_string(), arguments.target))
        }
        "memory_inbox_list" => {
            let arguments: InboxListArguments = parse_arguments(arguments)?;
            memory_result(memory_inbox_list(
                workspace.to_string(),
                arguments.include_reviewed,
            ))
        }
        "memory_inbox_add" => {
            let request: InboxAddArguments = parse_arguments(arguments)?;
            memory_result(memory_inbox_add(workspace.to_string(), request.into()))
        }
        "memory_inbox_accept" => {
            let request = parse_arguments(arguments)?;
            memory_result(memory_inbox_accept(workspace.to_string(), request))
        }
        "memory_distill" => {
            let request = parse_arguments(arguments)?;
            memory_result(memory_distill(workspace.to_string(), request))
        }
        "memory_search" => {
            let arguments: SearchArguments = parse_arguments(arguments)?;
            memory_result(memory_search(
                workspace.to_string(),
                arguments.query,
                arguments.limit,
                arguments.tag,
                arguments.since,
            ))
        }
        "memory_promote" => {
            let request = parse_arguments(arguments)?;
            memory_result(memory_promote(workspace.to_string(), request))
        }
        name => Err(protocol_error(
            -32602,
            format!("Unknown tool: {name}"),
            Some(json!({ "known_tools": TOOLS })),
        )),
    }
}

fn parse_arguments<T>(arguments: Value) -> Result<T, ProtocolError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(arguments)
        .map_err(|error| protocol_error(-32602, format!("Invalid tool arguments: {error}"), None))
}

fn memory_result<T, E>(result: Result<T, E>) -> Result<Value, ProtocolError>
where
    T: Serialize,
    E: Serialize + std::fmt::Display,
{
    match result {
        Ok(result) => serde_json::to_value(result).map_err(|error| {
            protocol_error(
                -32603,
                format!("Failed to serialize memory result: {error}"),
                None,
            )
        }),
        Err(error) => Err(workspace_error(error)),
    }
}

#[derive(Debug)]
struct ProtocolError {
    code: i64,
    message: String,
    data: Option<Value>,
}

fn protocol_error(code: i64, message: String, data: Option<Value>) -> ProtocolError {
    ProtocolError {
        code,
        message,
        data,
    }
}

fn workspace_error<E>(error: E) -> ProtocolError
where
    E: Serialize + std::fmt::Display,
{
    let data = serde_json::to_value(&error).ok();
    ProtocolError {
        code: -32000,
        message: error.to_string(),
        data,
    }
}

fn error_response(id: Value, code: i64, message: String, data: Option<Value>) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(JsonRpcError {
            code,
            message,
            data,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mcp_tool_call_request() {
        let request = parse_request(
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_status","arguments":{}}}"#,
        )
        .unwrap();
        assert_eq!(request.method, "tools/call");
        assert_eq!(request.params["name"], "memory_status");
    }

    #[test]
    fn tools_list_response_contains_expected_memory_tools() {
        let response = handle_request(
            "/tmp",
            parse_request(r#"{"jsonrpc":"2.0","id":"tools","method":"tools/list"}"#).unwrap(),
        );

        assert!(response.error.is_none());
        let tools = response.result.unwrap()["tools"]
            .as_array()
            .unwrap()
            .clone();
        let names: Vec<&str> = tools
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, TOOLS);
    }

    #[test]
    fn tools_list_response_contains_memory_inbox_add() {
        let response = handle_request(
            "/tmp",
            parse_request(r#"{"jsonrpc":"2.0","id":"tools","method":"tools/list"}"#).unwrap(),
        );

        assert!(response.error.is_none());
        let tools = response.result.unwrap()["tools"]
            .as_array()
            .unwrap()
            .clone();
        let descriptor = tools
            .iter()
            .find(|tool| tool["name"].as_str() == Some("memory_inbox_add"))
            .expect("missing memory_inbox_add descriptor");

        assert!(descriptor["description"]
            .as_str()
            .unwrap()
            .contains("Add a memory inbox candidate"));
        assert_eq!(
            descriptor["inputSchema"]["required"],
            json!(["title", "body", "tags"])
        );
    }

    #[test]
    fn tool_descriptions_guide_agent_time_memory_behavior() {
        let response = handle_request(
            "/tmp",
            parse_request(r#"{"jsonrpc":"2.0","id":"tools","method":"tools/list"}"#).unwrap(),
        );

        assert!(response.error.is_none());
        let result = response.result.unwrap();
        let tools = result["tools"].as_array().unwrap();

        let description_for = |tool_name: &str| -> String {
            tools
                .iter()
                .find(|tool| tool["name"] == tool_name)
                .unwrap_or_else(|| panic!("missing tool descriptor for {tool_name}"))["description"]
                .as_str()
                .unwrap()
                .to_lowercase()
        };

        let recall = description_for("memory_recall");
        assert!(recall.contains("start of a conversation/task"));
        assert!(recall.contains("prior context may matter"));

        let add = description_for("memory_add");
        assert!(add.contains("during active conversation turns"));
        assert!(add.contains("clear, durable, low-risk"));
        assert!(add.contains("search"));
        assert!(add.contains("avoid duplicates"));
        assert!(add.contains("sensitive"));
        assert!(add.contains("uncertain"));
        assert!(add.contains("inbox"));

        let search = description_for("memory_search");
        assert!(search.contains("before adding durable memories"));
        assert!(search.contains("duplicate risk"));

        let distill = description_for("memory_distill");
        assert!(distill.contains("thread/background"));
        assert!(distill.contains("not the only path"));
        assert!(distill.contains("memory extraction"));
    }

    #[test]
    fn initialize_response_advertises_tools_capability() {
        let response = handle_request(
            "/tmp",
            parse_request(
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}"#,
            )
            .unwrap(),
        );

        assert!(response.error.is_none());
        let result = response.result.unwrap();
        assert_eq!(result["protocolVersion"], "2024-11-05");
        assert_eq!(result["serverInfo"]["name"], "mdx-memory");
        assert_eq!(result["capabilities"]["tools"]["listChanged"], false);
    }

    #[test]
    fn initialized_notification_without_id_is_accepted() {
        let response = handle_request(
            "/tmp",
            parse_request(r#"{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}"#)
                .unwrap(),
        );

        assert!(response.error.is_none());
        assert_eq!(response.id, Value::Null);
    }

    #[test]
    fn dispatches_memory_status_tool_call() {
        let root = tempfile::tempdir().unwrap();
        let request = parse_request(
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_status","arguments":{}}}"#,
        )
        .unwrap();

        let response = handle_request(root.path().to_str().unwrap(), request);

        assert!(response.error.is_none());
        let result = response.result.unwrap();
        assert_eq!(result["mode"], "ordinary");
        assert_eq!(result["has_memory"], false);
    }

    #[test]
    fn dispatches_memory_working_get_tool_call() {
        let root = tempfile::tempdir().unwrap();
        mdx_lib::memory::memory_initialize_workspace(root.path().to_string_lossy().into_owned())
            .unwrap();
        mdx_lib::memory::memory_working_set(
            root.path().to_string_lossy().into_owned(),
            "# Working Memory\n\n## Focus\n- MCP startup\n".to_string(),
        )
        .unwrap();
        let request = parse_request(
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_working_get","arguments":{}}}"#,
        )
        .unwrap();

        let response = handle_request(root.path().to_str().unwrap(), request);

        assert!(response.error.is_none());
        assert_eq!(
            response.result.unwrap(),
            "# Working Memory\n\n## Focus\n- MCP startup\n"
        );
    }

    #[test]
    fn dispatches_memory_inbox_add_tool_call() {
        let root = tempfile::tempdir().unwrap();
        mdx_lib::memory::memory_initialize_workspace(root.path().to_string_lossy().into_owned())
            .unwrap();
        let request = parse_request(
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_inbox_add","arguments":{"title":"Review inbox capture","body":"Inbox candidates can be reviewed before becoming durable memory.","tags":["workflow"]}}}"#,
        )
        .unwrap();

        let response = handle_request(root.path().to_str().unwrap(), request);

        assert!(response.error.is_none());
        let result = response.result.unwrap();
        assert_eq!(result["frontmatter"]["title"], "Review inbox capture");
        assert_eq!(result["frontmatter"]["status"], "pending");
        assert_eq!(result["frontmatter"]["source_message_refs"], json!([]));
        assert_eq!(result["frontmatter"]["tags"], json!(["workflow"]));
        assert_eq!(
            result["body"],
            "Inbox candidates can be reviewed before becoming durable memory.\n"
        );
    }

    #[test]
    fn parse_workspace_arg_accepts_workspace_path() {
        let workspace = parse_workspace_arg(["--workspace", "/tmp/mdx"].map(String::from)).unwrap();

        assert_eq!(workspace, "/tmp/mdx");
    }

    #[test]
    fn parse_workspace_arg_rejects_unknown_argument() {
        let error = parse_workspace_arg(["--bogus", "--workspace", "/tmp/mdx"].map(String::from))
            .unwrap_err();

        assert_eq!(error, "mdx-mcp unknown argument: --bogus");
    }

    #[test]
    fn parse_workspace_arg_rejects_missing_workspace_value() {
        let error = parse_workspace_arg(["--workspace"].map(String::from)).unwrap_err();

        assert_eq!(error, "mdx-mcp requires --workspace <path>");
    }

    #[test]
    fn parse_workspace_arg_rejects_empty_workspace_value() {
        let error = parse_workspace_arg(["--workspace", "  "].map(String::from)).unwrap_err();

        assert_eq!(error, "mdx-mcp requires --workspace <path>");
    }

    #[test]
    fn parse_workspace_arg_rejects_duplicate_workspace_argument() {
        let error = parse_workspace_arg(
            ["--workspace", "/tmp/one", "--workspace", "/tmp/two"].map(String::from),
        )
        .unwrap_err();

        assert_eq!(error, "mdx-mcp received duplicate --workspace argument");
    }
}
