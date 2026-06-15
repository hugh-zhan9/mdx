use serde_json::Value;

use crate::models::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryProviderMessage {
    pub role: String,
    pub content: String,
}

pub trait MemoryProvider {
    fn complete_json(&self, messages: &[MemoryProviderMessage]) -> Result<Value, WorkspaceError>;
}

pub struct ReusedLlmProvider {
    config: crate::llm_wiki_models::LlmProviderConfig,
}

impl ReusedLlmProvider {
    pub fn from_default_config() -> Result<Option<Self>, WorkspaceError> {
        let config_path = crate::llm_wiki_llm::default_llm_config_path()?;
        crate::llm_wiki_llm::load_optional_llm_config_from_path(config_path)?
            .map(|config| Ok(Self { config }))
            .transpose()
    }

    #[allow(dead_code)]
    pub fn from_config_path(path: impl AsRef<std::path::Path>) -> Result<Self, WorkspaceError> {
        crate::llm_wiki_llm::load_llm_config_from_path(path).map(|config| Self { config })
    }
}

impl MemoryProvider for ReusedLlmProvider {
    fn complete_json(&self, messages: &[MemoryProviderMessage]) -> Result<Value, WorkspaceError> {
        let output = crate::llm_wiki_llm::call_chat_completion(
            &self.config,
            messages
                .iter()
                .map(|message| crate::llm_wiki_llm::LlmChatMessage {
                    role: message.role.clone(),
                    content: message.content.clone(),
                })
                .collect(),
        )?;
        Ok(serde_json::from_str(&output).unwrap_or(Value::String(output)))
    }
}

#[cfg(test)]
pub struct MockMemoryProvider {
    response: Value,
}

#[cfg(test)]
impl MockMemoryProvider {
    pub fn new(response: Value) -> Self {
        Self { response }
    }
}

#[cfg(test)]
impl MemoryProvider for MockMemoryProvider {
    fn complete_json(&self, _messages: &[MemoryProviderMessage]) -> Result<Value, WorkspaceError> {
        Ok(self.response.clone())
    }
}
