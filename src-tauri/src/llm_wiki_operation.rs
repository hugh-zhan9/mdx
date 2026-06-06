use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::llm_wiki_models::LlmWikiOperationState;
use crate::models::WorkspaceError;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct LlmWikiOperationRegistry {
    next_id: Arc<AtomicU64>,
    states: Arc<Mutex<BTreeMap<String, LlmWikiOperationState>>>,
}

impl LlmWikiOperationRegistry {
    pub fn new() -> Self {
        Self {
            next_id: Arc::new(AtomicU64::new(1)),
            states: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }

    #[allow(dead_code)]
    pub fn start(&self, operation: &str) -> String {
        let sequence = self.next_id.fetch_add(1, Ordering::SeqCst);
        let operation_id = format!("llm-wiki-operation-{sequence}");
        self.start_with_id(&operation_id, operation)
            .expect("llm wiki generated operation id is valid");
        operation_id
    }

    pub fn start_with_id(&self, operation_id: &str, operation: &str) -> Result<(), WorkspaceError> {
        let operation_id = operation_id.trim();
        if operation_id.is_empty() {
            return Err(WorkspaceError::new(
                "invalid_operation_id",
                "llm wiki operation id must not be empty",
            ));
        }
        let state = LlmWikiOperationState {
            operation_id: operation_id.to_string(),
            operation: operation.to_string(),
            stage: "starting".to_string(),
            cancelled: false,
        };

        self.states
            .lock()
            .map_err(|_| {
                WorkspaceError::new(
                    "operation_registry_failed",
                    "failed to access llm wiki operation registry",
                )
            })?
            .insert(operation_id.to_string(), state);
        Ok(())
    }

    pub fn set_stage(&self, id: &str, stage: &str) -> Result<(), WorkspaceError> {
        let mut states = self.lock_states()?;
        let state = states.get_mut(id).ok_or_else(operation_not_found)?;
        state.stage = stage.to_string();
        Ok(())
    }

    pub fn state(&self, id: &str) -> Result<LlmWikiOperationState, WorkspaceError> {
        let states = self.lock_states()?;
        states.get(id).cloned().ok_or_else(operation_not_found)
    }

    pub fn cancel(&self, id: &str) -> Result<(), WorkspaceError> {
        let mut states = self.lock_states()?;
        let state = states.get_mut(id).ok_or_else(operation_not_found)?;
        state.cancelled = true;
        Ok(())
    }

    pub fn is_cancelled(&self, id: &str) -> bool {
        self.states
            .lock()
            .map(|states| states.get(id).map(|state| state.cancelled).unwrap_or(false))
            .unwrap_or(false)
    }

    pub fn finish(&self, id: &str) {
        if let Ok(mut states) = self.states.lock() {
            states.remove(id);
        }
    }

    fn lock_states(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, BTreeMap<String, LlmWikiOperationState>>, WorkspaceError>
    {
        self.states.lock().map_err(|_| {
            WorkspaceError::new(
                "operation_registry_failed",
                "failed to access llm wiki operation registry",
            )
        })
    }
}

pub fn ensure_not_cancelled(
    registry: &LlmWikiOperationRegistry,
    id: &str,
) -> Result<(), WorkspaceError> {
    if registry.is_cancelled(id) {
        return Err(WorkspaceError::new(
            "cancelled",
            "llm wiki operation was cancelled",
        ));
    }
    Ok(())
}

fn operation_not_found() -> WorkspaceError {
    WorkspaceError::new("operation_not_found", "llm wiki operation was not found")
}
