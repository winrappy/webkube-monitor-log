use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, StatefulSet};
use k8s_openapi::api::core::v1::{ConfigMap, Namespace, Pod, Secret};
use kube::{
    api::{ListParams, LogParams},
    config::{KubeConfigOptions, Kubeconfig},
    Api, Client, ResourceExt,
};
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};
use tokio::task::JoinSet;

use crate::constants::API_CACHE_TTL_SECONDS;
use crate::models::{
    ContextInfo, ContextQuery, EnvQuery, EnvVar, KubeConfigFile, LogEntry, LogQuery, NamespaceItem,
    PodStatusItem, PodStatusQuery, WorkloadItem, WorkloadQuery,
};
use crate::state::{AppState, CacheEntry};

pub(crate) async fn health() -> impl IntoResponse {
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
    let kubeconfig =
        Kubeconfig::read_from(kubeconfig_path()).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let options = KubeConfigOptions {
        context: context.map(str::to_string),
        ..KubeConfigOptions::default()
    };
    let config = kube::Config::from_custom_kubeconfig(kubeconfig, &options)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Client::try_from(config).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}

pub(crate) async fn get_context(State(state): State<AppState>) -> Result<Json<ContextInfo>, StatusCode> {
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

    let kube_context = kube_config
        .as_ref()
        .and_then(|cfg| cfg.current_context.clone());
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

    let gcloud_project =
        match tokio::fs::read_to_string(format!("{}/configurations/config_default", gcloud_config_path()))
            .await
        {
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

pub(crate) async fn list_namespaces(
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
        .map(|ns| NamespaceItem {
            name: ns.name_any(),
        })
        .collect();

    items.sort_by(|a, b| a.name.cmp(&b.name));

    {
        let mut cache = state.cache.write().await;
        cache.namespaces.retain(|_, entry| entry.expires_at > now);
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

pub(crate) async fn list_workloads(
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
        cache.workloads.retain(|_, entry| entry.expires_at > now);
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

async fn list_deployments(client: &Client, namespace: &str) -> Result<Vec<WorkloadItem>, StatusCode> {
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

async fn list_daemonsets(client: &Client, namespace: &str) -> Result<Vec<WorkloadItem>, StatusCode> {
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

pub(crate) async fn get_logs(
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
        (Some(left), Some(right)) => right.cmp(left),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.source.cmp(&b.source),
    });

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

    if restart_count > 0 {
        if let Ok(log) = pods_api
            .logs(
                &pod_name,
                &LogParams {
                    follow: false,
                    timestamps: true,
                    previous: true,
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

async fn get_selector(client: &Client, query: &LogQuery) -> Result<BTreeMap<String, String>, StatusCode> {
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

pub(crate) async fn get_env(
    State(_state): State<AppState>,
    Query(query): Query<EnvQuery>,
) -> Result<Json<Vec<EnvVar>>, StatusCode> {
    let client = build_client_for_context(query.context.as_deref()).await?;

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
        if let Some(env_list) = &container.env {
            for env in env_list {
                let value = if let Some(v) = &env.value {
                    v.clone()
                } else if let Some(from) = &env.value_from {
                    if let Some(ref cm) = from.config_map_key_ref {
                        format!(
                            "(configMap: {}/{})",
                            cm.name.as_deref().unwrap_or("?"),
                            cm.key
                        )
                    } else if let Some(ref sec) = from.secret_key_ref {
                        format!(
                            "(secret: {}/{})",
                            sec.name.as_deref().unwrap_or("?"),
                            sec.key
                        )
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

pub(crate) async fn get_pod_status(
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
