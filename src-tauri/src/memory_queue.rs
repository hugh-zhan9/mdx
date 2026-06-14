use sha2::{Digest, Sha256};

use crate::memory_storage::{MemoryStorage, StoredJob};
use crate::WorkspaceError;

pub fn enqueue_distill_for_session(
    storage: &mut dyn MemoryStorage,
    workspace_id: &str,
    session_pk: &str,
    range_hash: &str,
) -> Result<bool, WorkspaceError> {
    let idempotency_key = format!("distill:{session_pk}:{range_hash}");
    let now = crate::memory_fs::now_utc_rfc3339()?;
    storage.enqueue_job_idempotent(&StoredJob {
        job_id: stable_job_id(&idempotency_key),
        workspace_id: workspace_id.to_string(),
        kind: "memory.distill".to_string(),
        status: "queued".to_string(),
        idempotency_key,
        payload: serde_json::json!({
            "session_pk": session_pk,
            "range_hash": range_hash
        }),
        attempts: 0,
        next_run_at: now.clone(),
        created_at: now.clone(),
        updated_at: now,
        last_error: None,
    })
}

fn stable_job_id(idempotency_key: &str) -> String {
    let digest = Sha256::digest(idempotency_key.as_bytes());
    format!("job:{digest:x}")
}
