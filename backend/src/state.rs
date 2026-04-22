use jsonwebtoken::DecodingKey;
use kube::Client;
use reqwest::Client as HttpClient;
use std::{
    collections::HashMap,
    sync::Arc,
    time::Instant,
};
use tokio::sync::{Mutex, RwLock};

use crate::models::{ContextInfo, NamespaceItem, WorkloadItem};

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) client: Option<Client>,
    pub(crate) auth: Arc<AuthState>,
    pub(crate) cache: Arc<RwLock<ApiCache>>,
}

#[derive(Default)]
pub(crate) struct ApiCache {
    pub(crate) context: Option<CacheEntry<ContextInfo>>,
    pub(crate) namespaces: HashMap<String, CacheEntry<Vec<NamespaceItem>>>,
    pub(crate) workloads: HashMap<String, CacheEntry<Vec<WorkloadItem>>>,
}

pub(crate) struct CacheEntry<T> {
    pub(crate) value: T,
    pub(crate) expires_at: Instant,
}

pub(crate) struct AuthState {
    pub(crate) client_id: Option<String>,
    pub(crate) required: bool,
    pub(crate) http_client: HttpClient,
    pub(crate) jwks_cache: RwLock<Option<JwksCache>>,
    pub(crate) jwks_fetch_lock: Mutex<()>,
}

pub(crate) struct JwksCache {
    pub(crate) keys: HashMap<String, DecodingKey>,
    pub(crate) expires_at: Instant,
}
