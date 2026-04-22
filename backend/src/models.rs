use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Serialize)]
pub(crate) struct NamespaceItem {
    pub(crate) name: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct WorkloadItem {
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) namespace: String,
    pub(crate) selector: BTreeMap<String, String>,
}

#[derive(Serialize)]
pub(crate) struct LogEntry {
    pub(crate) source: String,
    pub(crate) line: String,
    pub(crate) timestamp: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct WorkloadQuery {
    pub(crate) namespace: String,
    pub(crate) context: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct LogQuery {
    pub(crate) namespace: String,
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) search: Option<String>,
    pub(crate) since_minutes: Option<u32>,
    pub(crate) start_time: Option<String>,
    pub(crate) end_time: Option<String>,
    pub(crate) context: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct EnvQuery {
    pub(crate) namespace: String,
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) context: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct PodStatusQuery {
    pub(crate) namespace: String,
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) context: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ContextQuery {
    pub(crate) context: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct EnvVar {
    pub(crate) container: String,
    pub(crate) name: String,
    pub(crate) value: String,
}

#[derive(Serialize)]
pub(crate) struct PodStatusItem {
    pub(crate) name: String,
    pub(crate) phase: String,
    pub(crate) ready: String,
    pub(crate) restarts: i32,
}

#[derive(Clone, Serialize)]
pub(crate) struct ContextInfo {
    pub(crate) kube_context: Option<String>,
    pub(crate) cluster: Option<String>,
    pub(crate) gcloud_project: Option<String>,
    pub(crate) contexts: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct KubeConfigFile {
    #[serde(rename = "current-context")]
    pub(crate) current_context: Option<String>,
    pub(crate) contexts: Option<Vec<KubeNamedContext>>,
}

#[derive(Deserialize)]
pub(crate) struct KubeNamedContext {
    pub(crate) name: String,
    pub(crate) context: KubeContextDetail,
}

#[derive(Deserialize)]
pub(crate) struct KubeContextDetail {
    pub(crate) cluster: Option<String>,
}
