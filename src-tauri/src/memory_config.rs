use crate::memory_models::MemoryConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryFeature {
    Capture,
    RecallInjection,
    Distill,
    AutoAccept,
    Projection,
    AgentBackend,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedMemoryFeature {
    pub enabled: bool,
    pub reason: Option<String>,
    pub allow_db_write: bool,
    pub allow_spool_write: bool,
    pub allow_enqueue: bool,
    pub allow_projection: bool,
}

pub fn resolve_memory_feature(
    config: &MemoryConfig,
    feature: MemoryFeature,
    agent_source: Option<&str>,
) -> ResolvedMemoryFeature {
    if !config.memory.enabled {
        return disabled("memory_disabled");
    }
    if !config.agent_backend.enabled && feature != MemoryFeature::Projection {
        return disabled("agent_backend_disabled");
    }
    if feature == MemoryFeature::Capture && !config.agent_backend.capture_enabled {
        return disabled("capture_disabled");
    }

    if let Some(agent) = agent_source {
        let agent_config = match normalize_agent_source(agent) {
            Some("codex") => Some(("codex", &config.agents.codex)),
            Some("claude") => Some(("claude", &config.agents.claude)),
            Some("cursor") => Some(("cursor", &config.agents.cursor)),
            _ => None,
        };
        if let Some((agent, agent_config)) = agent_config {
            if !agent_config.enabled {
                return disabled(format!("{agent}_disabled"));
            }
            if agent_config.paused {
                return disabled(format!("{agent}_paused"));
            }
        }
    }

    match feature {
        MemoryFeature::RecallInjection if !config.agent_backend.recall_injection_enabled => {
            read_only_disabled("recall_injection_disabled")
        }
        MemoryFeature::Distill if !config.agent_backend.distill_enabled => {
            disabled("distill_disabled")
        }
        MemoryFeature::AutoAccept if !config.agent_backend.auto_accept => {
            disabled("auto_accept_disabled")
        }
        MemoryFeature::Projection if !config.projection.enabled => disabled("projection_disabled"),
        _ => enabled(),
    }
}

fn normalize_agent_source(agent: &str) -> Option<&'static str> {
    match agent {
        "codex" => Some("codex"),
        "claude" | "claude-code" | "claude_code" => Some("claude"),
        "cursor" => Some("cursor"),
        _ => None,
    }
}

fn enabled() -> ResolvedMemoryFeature {
    ResolvedMemoryFeature {
        enabled: true,
        reason: None,
        allow_db_write: true,
        allow_spool_write: true,
        allow_enqueue: true,
        allow_projection: true,
    }
}

fn disabled(reason: impl Into<String>) -> ResolvedMemoryFeature {
    ResolvedMemoryFeature {
        enabled: false,
        reason: Some(reason.into()),
        allow_db_write: false,
        allow_spool_write: false,
        allow_enqueue: false,
        allow_projection: false,
    }
}

fn read_only_disabled(reason: impl Into<String>) -> ResolvedMemoryFeature {
    ResolvedMemoryFeature {
        enabled: false,
        reason: Some(reason.into()),
        allow_db_write: true,
        allow_spool_write: true,
        allow_enqueue: false,
        allow_projection: true,
    }
}
