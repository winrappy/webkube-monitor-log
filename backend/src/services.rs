use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, StatefulSet};
use k8s_openapi::api::core::v1::{ConfigMap, Container, Namespace, Pod, Secret};
use kube::{
    api::{ListParams, LogParams},
    config::{KubeConfigOptions, Kubeconfig},
    Api, Client, ResourceExt,
};
use std::{
    collections::BTreeMap,
    path::Path,
    time::{Duration, Instant},
};
use tokio::task::JoinSet;

use tracing::error;

use crate::constants::API_CACHE_TTL_SECONDS;
use crate::models::{ContextInfo, EnvVar, KubeConfigFile, LogEntry, NamespaceItem, PodStatusItem, WorkloadItem, WorkloadSpecItem};
use crate::state::{AppState, CacheEntry};

struct WorkloadSnapshot {
    selector: BTreeMap<String, String>,
    containers: Vec<Container>,
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

// Kubeconfigs generated on macOS (Homebrew, installer) embed absolute host paths like
// /opt/homebrew/share/google-cloud-sdk/bin/gke-gcloud-auth-plugin. Those paths don't
// exist inside the Linux container, causing ENOENT when kube tries to exec the plugin.
// Stripping to just the binary name lets the container resolve it via PATH.
fn normalize_exec_commands(mut kubeconfig: Kubeconfig) -> Kubeconfig {
    for named_auth in &mut kubeconfig.auth_infos {
        if let Some(ref mut auth) = named_auth.auth_info {
            if let Some(ref mut exec) = auth.exec {
                if let Some(ref cmd) = exec.command.clone() {
                    if let Some(name) = Path::new(cmd).file_name().and_then(|n| n.to_str()) {
                        exec.command = Some(name.to_string());
                    }
                }
            }
        }
    }
    kubeconfig
}

async fn build_client_for_context(context: Option<&str>) -> Result<Client, StatusCode> {
    let kubeconfig = Kubeconfig::read_from(kubeconfig_path()).map_err(|e| {
        error!(error = %e, path = %kubeconfig_path(), "Failed to read kubeconfig");
        StatusCode::SERVICE_UNAVAILABLE
    })?;
    let kubeconfig = normalize_exec_commands(kubeconfig);
    let options = KubeConfigOptions {
        context: context.map(str::to_string),
        ..KubeConfigOptions::default()
    };
    let config = kube::Config::from_custom_kubeconfig(kubeconfig, &options)
        .await
        .map_err(|e| {
            error!(error = %e, context = ?context, "Failed to build kube config from kubeconfig");
            StatusCode::SERVICE_UNAVAILABLE
        })?;
    Client::try_from(config).map_err(|e| {
        error!(error = %e, "Failed to create kube client");
        StatusCode::SERVICE_UNAVAILABLE
    })
}

pub(crate) async fn get_context(state: &AppState) -> Result<ContextInfo, StatusCode> {
    let now = Instant::now();
    {
        let cache = state.cache.read().await;
        if let Some(entry) = cache.context.as_ref() {
            if entry.expires_at > now {
                return Ok(entry.value.clone());
            }
        }
    }

    let kubeconfig_future = tokio::fs::read_to_string(kubeconfig_path());
    let gcloud_config_future =
        tokio::fs::read_to_string(format!("{}/configurations/config_default", gcloud_config_path()));

    let (kubeconfig_contents, gcloud_config_contents) =
        tokio::join!(kubeconfig_future, gcloud_config_future);

    let kube_config = match kubeconfig_contents {
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

    let gcloud_project = match gcloud_config_contents {
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

    Ok(context_info)
}

pub(crate) async fn list_namespaces(
    state: &AppState,
    context: Option<&str>,
) -> Result<Vec<NamespaceItem>, StatusCode> {
    let now = Instant::now();
    let cache_key = context_cache_key(context);

    {
        let cache = state.cache.read().await;
        if let Some(entry) = cache.namespaces.get(&cache_key) {
            if entry.expires_at > now {
                return Ok(entry.value.clone());
            }
        }
    }

    let client = build_client_for_context(context).await?;
    let api: Api<Namespace> = Api::all(client);
    let namespaces = api
        .list(&ListParams::default())
        .await
        .map_err(|e| {
            error!(error = %e, context = ?context, "Failed to list namespaces");
            StatusCode::BAD_GATEWAY
        })?;

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

    Ok(items)
}

pub(crate) async fn list_workloads(
    state: &AppState,
    namespace: &str,
    context: Option<&str>,
) -> Result<Vec<WorkloadItem>, StatusCode> {
    let now = Instant::now();
    let cache_key = format!("{}|{}", namespace, context_cache_key(context));

    {
        let cache = state.cache.read().await;
        if let Some(entry) = cache.workloads.get(&cache_key) {
            if entry.expires_at > now {
                return Ok(entry.value.clone());
            }
        }
    }

    let client = build_client_for_context(context).await?;
    let (deployments, statefulsets, daemonsets) = tokio::try_join!(
        list_deployments(&client, namespace),
        list_statefulsets(&client, namespace),
        list_daemonsets(&client, namespace),
    )?;
    let mut workloads = Vec::new();

    workloads.extend(deployments);
    workloads.extend(statefulsets);
    workloads.extend(daemonsets);
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

    Ok(workloads)
}

pub(crate) async fn get_logs(
    namespace: &str,
    kind: &str,
    name: &str,
    search: Option<&str>,
    since_minutes: Option<u32>,
    start_time: Option<&str>,
    end_time: Option<&str>,
    context: Option<&str>,
) -> Result<Vec<LogEntry>, StatusCode> {
    let client = build_client_for_context(context).await?;
    let workload = get_workload_snapshot(&client, namespace, kind, name).await?;

    let label_selector = labels_to_selector(&workload.selector);
    let pods_api: Api<Pod> = Api::namespaced(client, namespace);
    let pods = pods_api
        .list(&ListParams::default().labels(&label_selector))
        .await
        .map_err(|e| {
            error!(error = %e, namespace, kind, name, "Failed to list pods for logs");
            StatusCode::BAD_GATEWAY
        })?;

    let mut entries = Vec::new();
    let search = search.unwrap_or_default().to_lowercase();
    let since_minutes = since_minutes.unwrap_or(15).clamp(1, 129_600);

    let since_time: Option<DateTime<Utc>> = start_time.and_then(|s| s.parse::<DateTime<Utc>>().ok());
    let end_filter: Option<DateTime<Utc>> = end_time.and_then(|s| s.parse::<DateTime<Utc>>().ok());

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

    Ok(entries)
}

pub(crate) async fn get_env(
    namespace: &str,
    kind: &str,
    name: &str,
    context: Option<&str>,
) -> Result<Vec<EnvVar>, StatusCode> {
    let client = build_client_for_context(context).await?;
    let workload = get_workload_snapshot(&client, namespace, kind, name).await?;
    let containers = workload.containers;

    let mut vars: Vec<EnvVar> = Vec::new();
    let mut env_from_jobs = JoinSet::new();
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
            for env_from in env_from_list.iter().cloned() {
                let client = client.clone();
                let namespace = namespace.to_string();
                let container_name = container.name.clone();
                env_from_jobs.spawn(async move {
                    fetch_env_from_source(client, &namespace, &container_name, env_from).await
                });
            }
        }
    }

    while let Some(result) = env_from_jobs.join_next().await {
        if let Ok(mut env_from_vars) = result {
            vars.append(&mut env_from_vars);
        }
    }

    vars.sort_by(|a, b| a.container.cmp(&b.container).then(a.name.cmp(&b.name)));
    Ok(vars)
}

pub(crate) async fn get_pod_status(
    namespace: &str,
    kind: &str,
    name: &str,
    context: Option<&str>,
) -> Result<Vec<PodStatusItem>, StatusCode> {
    let client = build_client_for_context(context).await?;
    let workload = get_workload_snapshot(&client, namespace, kind, name).await?;
    let pods_api: Api<Pod> = Api::namespaced(client, namespace);
    let pods = pods_api
        .list(&ListParams::default().labels(&labels_to_selector(&workload.selector)))
        .await
        .map_err(|e| {
            error!(error = %e, namespace, kind, name, "Failed to list pods for status");
            StatusCode::BAD_GATEWAY
        })?;

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
    Ok(items)
}

pub(crate) async fn get_workload_spec(
    namespace: &str,
    kind: &str,
    name: &str,
    context: Option<&str>,
) -> Result<WorkloadSpecItem, StatusCode> {
    let client = build_client_for_context(context).await?;

    let spec = match kind {
        "Deployment" => {
            let api: Api<Deployment> = Api::namespaced(client.clone(), namespace);
            let resource = api.get(name).await.map_err(|e| {
                error!(error = %e, namespace, kind, name, "Failed to get deployment for spec");
                StatusCode::NOT_FOUND
            })?;
            serde_json::to_value(resource.spec).map_err(|e| {
                error!(error = %e, namespace, kind, name, "Failed to serialize deployment spec");
                StatusCode::INTERNAL_SERVER_ERROR
            })?
        }
        "StatefulSet" => {
            let api: Api<StatefulSet> = Api::namespaced(client.clone(), namespace);
            let resource = api.get(name).await.map_err(|e| {
                error!(error = %e, namespace, kind, name, "Failed to get statefulset for spec");
                StatusCode::NOT_FOUND
            })?;
            serde_json::to_value(resource.spec).map_err(|e| {
                error!(error = %e, namespace, kind, name, "Failed to serialize statefulset spec");
                StatusCode::INTERNAL_SERVER_ERROR
            })?
        }
        "DaemonSet" => {
            let api: Api<DaemonSet> = Api::namespaced(client, namespace);
            let resource = api.get(name).await.map_err(|e| {
                error!(error = %e, namespace, kind, name, "Failed to get daemonset for spec");
                StatusCode::NOT_FOUND
            })?;
            serde_json::to_value(resource.spec).map_err(|e| {
                error!(error = %e, namespace, kind, name, "Failed to serialize daemonset spec");
                StatusCode::INTERNAL_SERVER_ERROR
            })?
        }
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    Ok(WorkloadSpecItem {
        kind: kind.to_string(),
        name: name.to_string(),
        namespace: namespace.to_string(),
        spec,
    })
}

async fn list_deployments(client: &Client, namespace: &str) -> Result<Vec<WorkloadItem>, StatusCode> {
    let api: Api<Deployment> = Api::namespaced(client.clone(), namespace);
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| {
            error!(error = %e, namespace, "Failed to list deployments");
            StatusCode::BAD_GATEWAY
        })?;

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
        .map_err(|e| {
            error!(error = %e, namespace, "Failed to list statefulsets");
            StatusCode::BAD_GATEWAY
        })?;

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
        .map_err(|e| {
            error!(error = %e, namespace, "Failed to list daemonsets");
            StatusCode::BAD_GATEWAY
        })?;

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

async fn fetch_env_from_source(
    client: Client,
    namespace: &str,
    container_name: &str,
    env_from: k8s_openapi::api::core::v1::EnvFromSource,
) -> Vec<EnvVar> {
    let prefix = env_from.prefix.unwrap_or_default();

    if let Some(cm_ref) = env_from.config_map_ref {
        let cm_name = cm_ref.name.unwrap_or_default();
        return fetch_config_map_env_vars(client, namespace, container_name, &prefix, &cm_name).await;
    }

    if let Some(sec_ref) = env_from.secret_ref {
        let secret_name = sec_ref.name.unwrap_or_default();
        return fetch_secret_env_vars(client, namespace, container_name, &prefix, &secret_name).await;
    }

    Vec::new()
}

async fn fetch_config_map_env_vars(
    client: Client,
    namespace: &str,
    container_name: &str,
    prefix: &str,
    config_map_name: &str,
) -> Vec<EnvVar> {
    if config_map_name.is_empty() {
        return Vec::new();
    }

    let cm_api: Api<ConfigMap> = Api::namespaced(client, namespace);
    let Ok(config_map) = cm_api.get(config_map_name).await else {
        return Vec::new();
    };

    let Some(data) = config_map.data else {
        return Vec::new();
    };

    let mut keys: Vec<_> = data.keys().cloned().collect();
    keys.sort();

    keys.into_iter()
        .map(|key| EnvVar {
            container: container_name.to_string(),
            name: apply_prefix(prefix, &key),
            value: data[&key].clone(),
        })
        .collect()
}

async fn fetch_secret_env_vars(
    client: Client,
    namespace: &str,
    container_name: &str,
    prefix: &str,
    secret_name: &str,
) -> Vec<EnvVar> {
    if secret_name.is_empty() {
        return Vec::new();
    }

    let secret_api: Api<Secret> = Api::namespaced(client, namespace);
    let Ok(secret) = secret_api.get(secret_name).await else {
        return Vec::new();
    };

    let Some(data) = secret.data else {
        return Vec::new();
    };

    let mut keys: Vec<_> = data.keys().cloned().collect();
    keys.sort();

    keys.into_iter()
        .map(|key| {
            let value = String::from_utf8(data[&key].0.clone())
                .unwrap_or_else(|_| "(binary)".to_string());
            EnvVar {
                container: container_name.to_string(),
                name: apply_prefix(prefix, &key),
                value,
            }
        })
        .collect()
}

fn apply_prefix(prefix: &str, key: &str) -> String {
    if prefix.is_empty() {
        key.to_string()
    } else {
        format!("{prefix}{key}")
    }
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

async fn get_workload_snapshot(
    client: &Client,
    namespace: &str,
    kind: &str,
    name: &str,
) -> Result<WorkloadSnapshot, StatusCode> {
    match kind {
        "Deployment" => {
            let api: Api<Deployment> = Api::namespaced(client.clone(), namespace);
            let resource = api.get(name).await.map_err(|_| StatusCode::NOT_FOUND)?;
            snapshot_from_spec(resource.spec)
        }
        "StatefulSet" => {
            let api: Api<StatefulSet> = Api::namespaced(client.clone(), namespace);
            let resource = api.get(name).await.map_err(|_| StatusCode::NOT_FOUND)?;
            snapshot_from_spec(resource.spec)
        }
        "DaemonSet" => {
            let api: Api<DaemonSet> = Api::namespaced(client.clone(), namespace);
            let resource = api.get(name).await.map_err(|_| StatusCode::NOT_FOUND)?;
            snapshot_from_spec(resource.spec)
        }
        _ => Err(StatusCode::BAD_REQUEST),
    }
}

fn snapshot_from_spec<Spec>(spec: Option<Spec>) -> Result<WorkloadSnapshot, StatusCode>
where
    Spec: WorkloadSpecAccess,
{
    let spec = spec.ok_or(StatusCode::BAD_REQUEST)?;
    let selector = spec.selector().ok_or(StatusCode::BAD_REQUEST)?;

    Ok(WorkloadSnapshot {
        selector,
        containers: spec.containers(),
    })
}

trait WorkloadSpecAccess {
    fn selector(&self) -> Option<BTreeMap<String, String>>;
    fn containers(&self) -> Vec<Container>;
}

impl WorkloadSpecAccess for k8s_openapi::api::apps::v1::DeploymentSpec {
    fn selector(&self) -> Option<BTreeMap<String, String>> {
        self.selector.match_labels.clone()
    }

    fn containers(&self) -> Vec<Container> {
        self.template
            .spec
            .as_ref()
            .map(|spec| spec.containers.clone())
            .unwrap_or_default()
    }
}

impl WorkloadSpecAccess for k8s_openapi::api::apps::v1::StatefulSetSpec {
    fn selector(&self) -> Option<BTreeMap<String, String>> {
        self.selector.match_labels.clone()
    }

    fn containers(&self) -> Vec<Container> {
        self.template
            .spec
            .as_ref()
            .map(|spec| spec.containers.clone())
            .unwrap_or_default()
    }
}

impl WorkloadSpecAccess for k8s_openapi::api::apps::v1::DaemonSetSpec {
    fn selector(&self) -> Option<BTreeMap<String, String>> {
        self.selector.match_labels.clone()
    }

    fn containers(&self) -> Vec<Container> {
        self.template
            .spec
            .as_ref()
            .map(|spec| spec.containers.clone())
            .unwrap_or_default()
    }
}

fn labels_to_selector(labels: &BTreeMap<String, String>) -> String {
    let mut parts = Vec::new();
    for (key, value) in labels {
        parts.push(format!("{key}={value}"));
    }
    parts.join(",")
}