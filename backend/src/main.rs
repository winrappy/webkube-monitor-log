use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, Request, StatusCode},
    middleware::{self, Next},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use kube::{
    config::{KubeConfigOptions, Kubeconfig},
    api::{ListParams, LogParams},
    Api, Client, ResourceExt,
};
use reqwest::header::CACHE_CONTROL;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::task::JoinSet;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info};

use chrono::{DateTime, Utc};
use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, StatefulSet};
use k8s_openapi::api::core::v1::{ConfigMap, Namespace, Pod, Secret};

const MAX_LOG_LINES: usize = 50;
const API_CACHE_TTL_SECONDS: u64 = 15;

#[derive(Clone)]
struct AppState {
    client: Option<Client>,
    auth: Arc<AuthState>,
    cache: Arc<RwLock<ApiCache>>,
}

#[derive(Default)]
struct ApiCache {
    context: Option<CacheEntry<ContextInfo>>,
    namespaces: HashMap<String, CacheEntry<Vec<NamespaceItem>>>,
    workloads: HashMap<String, CacheEntry<Vec<WorkloadItem>>>,
}

struct CacheEntry<T> {
    value: T,
    expires_at: Instant,
}

struct AuthState {
    client_id: Option<String>,
    required: bool,
    jwks_cache: RwLock<Option<JwksCache>>,
}

struct JwksCache {
    keys: HashMap<String, DecodingKey>,
    expires_at: Instant,
}

#[derive(Clone, Serialize)]
struct NamespaceItem {
    name: String,
}

#[derive(Clone, Serialize)]
struct WorkloadItem {
    kind: String,
    name: String,
    namespace: String,
    selector: BTreeMap<String, String>,
}

#[derive(Serialize)]
struct LogEntry {
    source: String,
    line: String,
    timestamp: Option<String>,
}

#[derive(Deserialize)]
struct WorkloadQuery {
    namespace: String,
    context: Option<String>,
}

#[derive(Deserialize)]
struct LogQuery {
    namespace: String,
    kind: String,
    name: String,
    search: Option<String>,
    since_minutes: Option<u32>,
    /// RFC-3339 absolute start timestamp (custom range mode)
    start_time: Option<String>,
    /// RFC-3339 absolute end timestamp (custom range mode)
    end_time: Option<String>,
    context: Option<String>,
}

#[derive(Deserialize)]
struct EnvQuery {
    namespace: String,
    kind: String,
    name: String,
    context: Option<String>,
}

#[derive(Deserialize)]
struct PodStatusQuery {
    namespace: String,
    kind: String,
    name: String,
    context: Option<String>,
}

#[derive(Deserialize)]
struct ContextQuery {
    context: Option<String>,
}

#[derive(Serialize)]
struct EnvVar {
    container: String,
    name: String,
    value: String,
}

#[derive(Serialize)]
struct PodStatusItem {
    name: String,
    phase: String,
    ready: String,
    restarts: i32,
}

#[derive(Clone, Serialize)]
struct ContextInfo {
    kube_context: Option<String>,
    cluster: Option<String>,
    gcloud_project: Option<String>,
    contexts: Vec<String>,
}

#[derive(Deserialize)]
struct KubeConfigFile {
    #[serde(rename = "current-context")]
    current_context: Option<String>,
    contexts: Option<Vec<KubeNamedContext>>,
}

#[derive(Deserialize)]
struct KubeNamedContext {
    name: String,
    context: KubeContextDetail,
}

#[derive(Deserialize)]
struct KubeContextDetail {
    cluster: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let client = match Client::try_default().await {
        Ok(client) => Some(client),
        Err(err) => {
            error!("kubernetes client initialization failed: {err}");
            None
        }
    };
    let client_id = std::env::var("GOOGLE_CLIENT_ID").ok();
    let required = std::env::var("AUTH_REQUIRED")
        .map(|value| value != "false")
        .unwrap_or(true);

    let state = AppState {
        client,
        auth: Arc::new(AuthState {
            client_id,
            required,
            jwks_cache: RwLock::new(None),
        }),
        cache: Arc::new(RwLock::new(ApiCache::default())),
    };

    let api = Router::new()
        .route("/namespaces", get(list_namespaces))
        .route("/workloads", get(list_workloads))
        .route("/logs", get(get_logs))
        .route("/env", get(get_env))
        .route("/pod-status", get(get_pod_status))
        .route("/context", get(get_context))
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    let app = Router::new()
        .route("/health", get(health))
        .nest("/api", api)
        .layer(CorsLayer::new().allow_origin(Any).allow_headers(Any));

    let port = std::env::var("PORT").unwrap_or_else(|_| "8081".to_string());
    let addr = format!("0.0.0.0:{port}");
    info!("starting server on {addr}");

    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;

    Ok(())
}

async fn health() -> impl IntoResponse {
    "ok"
}

fn kubeconfig_path() -> String {
    std::env::var("KUBECONFIG").unwrap_or_else(|_| "/root/.kube/config".to_string())
}

fn gcloud_config_path() -> String {
    std::env::var("CLOUDSDK_CONFIG").unwrap_or_else(|_| "/root/.config/gcloud".to_string())
}

fn context_cache_key(context: Option<&str>) -> String {
    context.unwrap_or("__default").to_string()
}

async fn build_client_for_context(context: Option<&str>) -> Result<Client, StatusCode> {
    let kubeconfig = Kubeconfig::read_from(kubeconfig_path()).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let options = KubeConfigOptions {
        context: context.map(str::to_string),
        ..KubeConfigOptions::default()
    };
    let config = kube::Config::from_custom_kubeconfig(kubeconfig, &options)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Client::try_from(config).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}

async fn get_context(
    State(state): State<AppState>,
) -> Result<Json<ContextInfo>, StatusCode> {
    let now = Instant::now();
    {
        let cache = state.cache.read().await;
        if let Some(entry) = cache.context.as_ref() {
            if entry.expires_at > now {
                return Ok(Json(entry.value.clone()));
            }
        }
    }

    let kube_config = match tokio::fs::read_to_string(kubeconfig_path()).await {
        Ok(contents) => serde_yaml::from_str::<KubeConfigFile>(&contents).ok(),
        Err(_) => None,
    };

    let kube_context = kube_config.as_ref().and_then(|cfg| cfg.current_context.clone());
    let contexts = kube_config
        .as_ref()
        .and_then(|cfg| cfg.contexts.as_ref())
        .map(|items| {
            let mut names: Vec<String> = items.iter().map(|ctx| ctx.name.clone()).collect();
            names.sort();
            names
        })
        .unwrap_or_default();

    let cluster = kube_config.as_ref().and_then(|cfg| {
        let current = cfg.current_context.clone()?;
        let contexts = cfg.contexts.as_ref()?;
        contexts
            .iter()
            .find(|ctx| ctx.name == current)
            .and_then(|ctx| ctx.context.cluster.clone())
    });

    let gcloud_project = match tokio::fs::read_to_string(format!("{}/configurations/config_default", gcloud_config_path())).await {
        Ok(contents) => contents
            .lines()
            .map(str::trim)
            .find_map(|line| line.strip_prefix("project = ").map(|v| v.trim().to_string())),
        Err(_) => None,
    };

    let context_info = ContextInfo {
        kube_context,
        cluster,
        gcloud_project,
        contexts,
    };

    {
        let mut cache = state.cache.write().await;
        cache.context = Some(CacheEntry {
            value: context_info.clone(),
            expires_at: now + Duration::from_secs(API_CACHE_TTL_SECONDS),
        });
    }

    Ok(Json(context_info))
}

async fn auth_middleware(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request<axum::body::Body>,
    next: Next,
) -> Result<impl IntoResponse, StatusCode> {
    if !state.auth.required {
        return Ok(next.run(request).await);
    }

    let Some(client_id) = state.auth.client_id.clone() else {
        error!("missing GOOGLE_CLIENT_ID");
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    };

    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    verify_google_token(token, &client_id, &state.auth).await?;

    Ok(next.run(request).await)
}

async fn verify_google_token(
    token: &str,
    client_id: &str,
    auth: &AuthState,
) -> Result<(), StatusCode> {
    let header = decode_header(token).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let kid = header.kid.ok_or(StatusCode::UNAUTHORIZED)?;

    let keys = get_google_keys(auth).await?;
    let key = keys.get(&kid).ok_or(StatusCode::UNAUTHORIZED)?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[client_id]);
    validation.set_issuer(&["https://accounts.google.com", "accounts.google.com"]);

    decode::<serde_json::Value>(token, key, &validation).map_err(|_| StatusCode::UNAUTHORIZED)?;

    Ok(())
}

async fn get_google_keys(auth: &AuthState) -> Result<HashMap<String, DecodingKey>, StatusCode> {
    let now = Instant::now();

    {
        let cache = auth.jwks_cache.read().await;
        if let Some(cached) = cache.as_ref() {
            if cached.expires_at > now {
                return Ok(cached.keys.clone());
            }
        }
    }

    let response = reqwest::Client::new()
        .get("https://www.googleapis.com/oauth2/v3/certs")
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    let cache_control = response
        .headers()
        .get(CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    let max_age = cache_control
        .split(',')
        .find_map(|segment| segment.trim().strip_prefix("max-age="))
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(3600);

    let jwks: JwksResponse = response
        .json()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    let mut keys = HashMap::new();
    for jwk in jwks.keys {
        if jwk.kty != "RSA" {
            continue;
        }
        let decoding = DecodingKey::from_rsa_components(&jwk.n, &jwk.e)
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
        keys.insert(jwk.kid, decoding);
    }

    let expires_at = now + Duration::from_secs(max_age);
    {
        let mut cache = auth.jwks_cache.write().await;
        *cache = Some(JwksCache { keys: keys.clone(), expires_at });
    }

    Ok(keys)
}

#[derive(Deserialize)]
struct JwksResponse {
    keys: Vec<JwkKey>,
}

#[derive(Deserialize)]
struct JwkKey {
    kid: String,
    kty: String,
    n: String,
    e: String,
}

async fn list_namespaces(
    State(state): State<AppState>,
    Query(query): Query<ContextQuery>,
) -> Result<Json<Vec<NamespaceItem>>, StatusCode> {
    let now = Instant::now();
    let cache_key = context_cache_key(query.context.as_deref());

    {
        let cache = state.cache.read().await;
        if let Some(entry) = cache.namespaces.get(&cache_key) {
            if entry.expires_at > now {
                return Ok(Json(entry.value.clone()));
            }
        }
    }

    let client = build_client_for_context(query.context.as_deref()).await?;
    let api: Api<Namespace> = Api::all(client);
    let namespaces = api
        .list(&ListParams::default())
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    let mut items: Vec<NamespaceItem> = namespaces
        .into_iter()
        .map(|ns| NamespaceItem { name: ns.name_any() })
        .collect();

    items.sort_by(|a, b| a.name.cmp(&b.name));

    {
        let mut cache = state.cache.write().await;
        cache
            .namespaces
            .retain(|_, entry| entry.expires_at > now);
        cache.namespaces.insert(
            cache_key,
            CacheEntry {
                value: items.clone(),
                expires_at: now + Duration::from_secs(API_CACHE_TTL_SECONDS),
            },
        );
    }

    Ok(Json(items))
}

async fn list_workloads(
    State(state): State<AppState>,
    Query(query): Query<WorkloadQuery>,
) -> Result<Json<Vec<WorkloadItem>>, StatusCode> {
    let now = Instant::now();
    let cache_key = format!(
        "{}|{}",
        query.namespace,
        context_cache_key(query.context.as_deref())
    );

    {
        let cache = state.cache.read().await;
        if let Some(entry) = cache.workloads.get(&cache_key) {
            if entry.expires_at > now {
                return Ok(Json(entry.value.clone()));
            }
        }
    }

    let client = build_client_for_context(query.context.as_deref()).await?;
    let mut workloads = Vec::new();

    workloads.extend(list_deployments(&client, &query.namespace).await?);
    workloads.extend(list_statefulsets(&client, &query.namespace).await?);
    workloads.extend(list_daemonsets(&client, &query.namespace).await?);

    workloads.sort_by(|a, b| a.name.cmp(&b.name));

    {
        let mut cache = state.cache.write().await;
        cache
            .workloads
            .retain(|_, entry| entry.expires_at > now);
        cache.workloads.insert(
            cache_key,
            CacheEntry {
                value: workloads.clone(),
                expires_at: now + Duration::from_secs(API_CACHE_TTL_SECONDS),
            },
        );
    }

    Ok(Json(workloads))
}

async fn list_deployments(
    client: &Client,
    namespace: &str,
) -> Result<Vec<WorkloadItem>, StatusCode> {
    let api: Api<Deployment> = Api::namespaced(client.clone(), namespace);
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    Ok(list
        .into_iter()
        .filter_map(|deploy| {
            let selector = deploy
                .spec
                .as_ref()
                .and_then(|spec| spec.selector.match_labels.clone())?;
            Some(WorkloadItem {
                kind: "Deployment".to_string(),
                name: deploy.name_any(),
                namespace: namespace.to_string(),
                selector,
            })
        })
        .collect())
}

async fn list_statefulsets(
    client: &Client,
    namespace: &str,
) -> Result<Vec<WorkloadItem>, StatusCode> {
    let api: Api<StatefulSet> = Api::namespaced(client.clone(), namespace);
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    Ok(list
        .into_iter()
        .filter_map(|stateful| {
            let selector = stateful
                .spec
                .as_ref()
                .and_then(|spec| spec.selector.match_labels.clone())?;
            Some(WorkloadItem {
                kind: "StatefulSet".to_string(),
                name: stateful.name_any(),
                namespace: namespace.to_string(),
                selector,
            })
        })
        .collect())
}

async fn list_daemonsets(
    client: &Client,
    namespace: &str,
) -> Result<Vec<WorkloadItem>, StatusCode> {
    let api: Api<DaemonSet> = Api::namespaced(client.clone(), namespace);
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    Ok(list
        .into_iter()
        .filter_map(|daemon| {
            let selector = daemon
                .spec
                .as_ref()
                .and_then(|spec| spec.selector.match_labels.clone())?;
            Some(WorkloadItem {
                kind: "DaemonSet".to_string(),
                name: daemon.name_any(),
                namespace: namespace.to_string(),
                selector,
            })
        })
        .collect())
}

async fn get_logs(
    State(_state): State<AppState>,
    Query(query): Query<LogQuery>,
) -> Result<Json<Vec<LogEntry>>, StatusCode> {
    let client = build_client_for_context(query.context.as_deref()).await?;
    let selector = get_selector(&client, &query).await?;

    let label_selector = labels_to_selector(&selector);
    let pods_api: Api<Pod> = Api::namespaced(client, &query.namespace);
    let pods = pods_api
        .list(&ListParams::default().labels(&label_selector))
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    let mut entries = Vec::new();
    let search = query.search.unwrap_or_default().to_lowercase();
    let since_minutes = query.since_minutes.unwrap_or(15).clamp(1, 129_600);

    // Parse optional absolute time bounds.
    let since_time: Option<DateTime<Utc>> = query
        .start_time
        .as_deref()
        .and_then(|s| s.parse::<DateTime<Utc>>().ok());
    let end_filter: Option<DateTime<Utc>> = query
        .end_time
        .as_deref()
        .and_then(|s| s.parse::<DateTime<Utc>>().ok());

    let mut pod_jobs = JoinSet::new();
    for pod in pods {
        let pods_api = pods_api.clone();
        let search = search.clone();
        let since_time = since_time;
        let end_filter = end_filter;

        pod_jobs.spawn(async move {
            fetch_logs_for_pod(pods_api, pod, since_time, end_filter, since_minutes, &search).await
        });
    }

    while let Some(result) = pod_jobs.join_next().await {
        if let Ok(mut pod_entries) = result {
            entries.append(&mut pod_entries);
        }
    }

    entries.sort_by(|a, b| match (&a.timestamp, &b.timestamp) {
        (Some(left), Some(right)) => left.cmp(right),
        (Some(_), None) => std::cmp::Ordering::Greater,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (None, None) => a.source.cmp(&b.source),
    });

    if entries.len() > MAX_LOG_LINES {
        let keep_from = entries.len() - MAX_LOG_LINES;
        entries = entries.split_off(keep_from);
    }

    Ok(Json(entries))
}

async fn fetch_logs_for_pod(
    pods_api: Api<Pod>,
    pod: Pod,
    since_time: Option<DateTime<Utc>>,
    end_filter: Option<DateTime<Utc>>,
    since_minutes: u32,
    search: &str,
) -> Vec<LogEntry> {
    let pod_name = pod.name_any();
    let mut entries = Vec::new();

    // Determine whether the current container is running and its restart count.
    let (is_running, restart_count) = {
        let statuses = pod
            .status
            .as_ref()
            .and_then(|s| s.container_statuses.as_ref());
        let running = statuses
            .map(|cs| {
                cs.iter()
                    .any(|c| c.state.as_ref().and_then(|st| st.running.as_ref()).is_some())
            })
            .unwrap_or(false);
        let restarts = statuses
            .map(|cs| cs.iter().map(|c| c.restart_count).max().unwrap_or(0))
            .unwrap_or(0);
        (running, restarts)
    };

    // Fetch current container logs (only when container is actually running).
    if is_running {
        let log_params = if let Some(st) = since_time {
            LogParams {
                follow: false,
                timestamps: true,
                since_time: Some(st),
                ..LogParams::default()
            }
        } else {
            LogParams {
                follow: false,
                timestamps: true,
                since_seconds: Some(i64::from(since_minutes) * 60),
                ..LogParams::default()
            }
        };

        if let Ok(log) = pods_api.logs(&pod_name, &log_params).await {
            for line in log.lines() {
                let (timestamp, payload) = split_timestamped_log_line(line);
                if !search.is_empty() && !payload.to_lowercase().contains(search) {
                    continue;
                }
                // Drop entries that exceed the requested end time.
                if let Some(ref ef) = end_filter {
                    if let Some(ref ts) = timestamp {
                        if let Ok(t) = ts.parse::<DateTime<Utc>>() {
                            if t > *ef {
                                continue;
                            }
                        }
                    }
                }
                entries.push(LogEntry {
                    source: format!("pod/{pod_name}"),
                    line: payload,
                    timestamp,
                });
            }
        }
    }

    // Fetch previous container logs when the container has restarted at least once.
    if restart_count > 0 {
        if let Ok(log) = pods_api
            .logs(
                &pod_name,
                &LogParams {
                    follow: false,
                    timestamps: true,
                    previous: true,
                    tail_lines: Some(i64::try_from(MAX_LOG_LINES).unwrap_or(50)),
                    ..LogParams::default()
                },
            )
            .await
        {
            for line in log.lines() {
                let (timestamp, payload) = split_timestamped_log_line(line);
                if !search.is_empty() && !payload.to_lowercase().contains(search) {
                    continue;
                }
                entries.push(LogEntry {
                    source: format!("pod/{pod_name}/previous"),
                    line: payload,
                    timestamp,
                });
            }
        }
    }

    entries
}

fn split_timestamped_log_line(line: &str) -> (Option<String>, String) {
    if let Some((prefix, rest)) = line.split_once(' ') {
        let has_time_separator = prefix.contains('T');
        let looks_like_rfc3339_zone = prefix.ends_with('Z') || prefix.contains('+');

        if has_time_separator && looks_like_rfc3339_zone {
            return (Some(prefix.to_string()), rest.to_string());
        }
    }

    (None, line.to_string())
}

async fn get_selector(
    client: &Client,
    query: &LogQuery,
) -> Result<BTreeMap<String, String>, StatusCode> {
    match query.kind.as_str() {
        "Deployment" => {
            let api: Api<Deployment> = Api::namespaced(client.clone(), &query.namespace);
            let resource = api
                .get(&query.name)
                .await
                .map_err(|_| StatusCode::NOT_FOUND)?;
            resource
                .spec
                .as_ref()
                .and_then(|spec| spec.selector.match_labels.clone())
                .ok_or(StatusCode::BAD_REQUEST)
        }
        "StatefulSet" => {
            let api: Api<StatefulSet> = Api::namespaced(client.clone(), &query.namespace);
            let resource = api
                .get(&query.name)
                .await
                .map_err(|_| StatusCode::NOT_FOUND)?;
            resource
                .spec
                .as_ref()
                .and_then(|spec| spec.selector.match_labels.clone())
                .ok_or(StatusCode::BAD_REQUEST)
        }
        "DaemonSet" => {
            let api: Api<DaemonSet> = Api::namespaced(client.clone(), &query.namespace);
            let resource = api
                .get(&query.name)
                .await
                .map_err(|_| StatusCode::NOT_FOUND)?;
            resource
                .spec
                .as_ref()
                .and_then(|spec| spec.selector.match_labels.clone())
                .ok_or(StatusCode::BAD_REQUEST)
        }
        _ => Err(StatusCode::BAD_REQUEST),
    }
}

async fn get_env(
    State(_state): State<AppState>,
    Query(query): Query<EnvQuery>,
) -> Result<Json<Vec<EnvVar>>, StatusCode> {
    let client = build_client_for_context(query.context.as_deref()).await?;

    // Pull the pod template spec from the workload definition (no exec needed).
    let containers: Vec<k8s_openapi::api::core::v1::Container> = match query.kind.as_str() {
        "Deployment" => {
            let api: Api<Deployment> = Api::namespaced(client.clone(), &query.namespace);
            let res = api.get(&query.name).await.map_err(|_| StatusCode::NOT_FOUND)?;
            res.spec
                .and_then(|s| s.template.spec)
                .map(|s| s.containers)
                .unwrap_or_default()
        }
        "StatefulSet" => {
            let api: Api<StatefulSet> = Api::namespaced(client.clone(), &query.namespace);
            let res = api.get(&query.name).await.map_err(|_| StatusCode::NOT_FOUND)?;
            res.spec
                .and_then(|s| s.template.spec)
                .map(|s| s.containers)
                .unwrap_or_default()
        }
        "DaemonSet" => {
            let api: Api<DaemonSet> = Api::namespaced(client.clone(), &query.namespace);
            let res = api.get(&query.name).await.map_err(|_| StatusCode::NOT_FOUND)?;
            res.spec
                .and_then(|s| s.template.spec)
                .map(|s| s.containers)
                .unwrap_or_default()
        }
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    let mut vars: Vec<EnvVar> = Vec::new();
    for container in &containers {
        // Individual env entries
        if let Some(env_list) = &container.env {
            for env in env_list {
                let value = if let Some(v) = &env.value {
                    v.clone()
                } else if let Some(from) = &env.value_from {
                    if let Some(ref cm) = from.config_map_key_ref {
                        format!("(configMap: {}/{})", cm.name.as_deref().unwrap_or("?"), cm.key)
                    } else if let Some(ref sec) = from.secret_key_ref {
                        format!("(secret: {}/{})", sec.name.as_deref().unwrap_or("?"), sec.key)
                    } else if from.field_ref.is_some() {
                        "(fieldRef)".to_string()
                    } else {
                        "(valueFrom)".to_string()
                    }
                } else {
                    String::new()
                };
                vars.push(EnvVar {
                    container: container.name.clone(),
                    name: env.name.clone(),
                    value,
                });
            }
        }
        // Bulk envFrom references (ConfigMap / Secret) — fetch actual key/value pairs
        if let Some(env_from_list) = &container.env_from {
            for env_from in env_from_list {
                let prefix = env_from.prefix.as_deref().unwrap_or("");
                if let Some(ref cm_ref) = env_from.config_map_ref {
                    let cm_name = cm_ref.name.as_deref().unwrap_or("");
                    let cm_api: Api<ConfigMap> = Api::namespaced(client.clone(), &query.namespace);
                    if let Ok(cm) = cm_api.get(cm_name).await {
                        if let Some(data) = cm.data {
                            let mut keys: Vec<_> = data.keys().cloned().collect();
                            keys.sort();
                            for key in keys {
                                let full_key = if prefix.is_empty() {
                                    key.clone()
                                } else {
                                    format!("{prefix}{key}")
                                };
                                vars.push(EnvVar {
                                    container: container.name.clone(),
                                    name: full_key,
                                    value: data[&key].clone(),
                                });
                            }
                        }
                    }
                } else if let Some(ref sec_ref) = env_from.secret_ref {
                    let sec_name = sec_ref.name.as_deref().unwrap_or("");
                    let sec_api: Api<Secret> = Api::namespaced(client.clone(), &query.namespace);
                    if let Ok(sec) = sec_api.get(sec_name).await {
                        if let Some(data) = sec.data {
                            let mut keys: Vec<_> = data.keys().cloned().collect();
                            keys.sort();
                            for key in keys {
                                let full_key = if prefix.is_empty() {
                                    key.clone()
                                } else {
                                    format!("{prefix}{key}")
                                };
                                // Decode base64 bytes to UTF-8 string; mask if not valid UTF-8
                                let value = String::from_utf8(data[&key].0.clone())
                                    .unwrap_or_else(|_| "(binary)".to_string());
                                vars.push(EnvVar {
                                    container: container.name.clone(),
                                    name: full_key,
                                    value,
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    vars.sort_by(|a, b| a.container.cmp(&b.container).then(a.name.cmp(&b.name)));
    Ok(Json(vars))
}

async fn get_pod_status(
    State(_state): State<AppState>,
    Query(query): Query<PodStatusQuery>,
) -> Result<Json<Vec<PodStatusItem>>, StatusCode> {
    let client = build_client_for_context(query.context.as_deref()).await?;

    let selector_query = LogQuery {
        namespace: query.namespace.clone(),
        kind: query.kind,
        name: query.name,
        search: None,
        since_minutes: None,
        start_time: None,
        end_time: None,
        context: None,
    };

    let selector = get_selector(&client, &selector_query).await?;
    let pods_api: Api<Pod> = Api::namespaced(client, &query.namespace);
    let pods = pods_api
        .list(&ListParams::default().labels(&labels_to_selector(&selector)))
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    let mut items = Vec::new();
    for pod in pods {
        let name = pod.name_any();
        let phase = pod
            .status
            .as_ref()
            .and_then(|s| s.phase.clone())
            .unwrap_or_else(|| "Unknown".to_string());

        let statuses = pod
            .status
            .as_ref()
            .and_then(|s| s.container_statuses.as_ref())
            .cloned()
            .unwrap_or_default();

        let ready_count = statuses.iter().filter(|c| c.ready).count();
        let total_count = statuses.len();
        let ready = format!("{ready_count}/{total_count}");
        let restarts = statuses.iter().map(|c| c.restart_count).sum();

        items.push(PodStatusItem {
            name,
            phase,
            ready,
            restarts,
        });
    }

    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(items))
}

fn labels_to_selector(labels: &BTreeMap<String, String>) -> String {
    let mut parts = Vec::new();
    for (key, value) in labels {
        parts.push(format!("{key}={value}"));
    }
    parts.join(",")
}
