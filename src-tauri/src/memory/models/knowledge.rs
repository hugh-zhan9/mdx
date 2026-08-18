//! What the conclusion lifecycle reports back.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistilledConclusion {
    pub drawer_id: String,
    /// False when this exact conclusion already existed.
    pub created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptedConclusion {
    pub drawer_id: String,
    pub status: String,
    /// The record of this review, kept so the adoption can be traced back to a
    /// person and a moment rather than appearing out of nowhere.
    pub confirmation_drawer_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetiredConclusion {
    pub drawer_id: String,
    pub status: String,
}
