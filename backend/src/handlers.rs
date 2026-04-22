use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};

use crate::models::{ContextInfo, ContextQuery, EnvQuery, EnvVar, LogEntry, LogQuery, NamespaceItem, PodStatusItem, PodStatusQuery, SpecQuery, WorkloadItem, WorkloadQuery, WorkloadSpecItem};
use crate::{services, state::AppState};

pub(crate) async fn health() -> impl IntoResponse {
    "ok"
}

pub(crate) async fn get_context(State(state): State<AppState>) -> Result<Json<ContextInfo>, StatusCode> {
    services::get_context(&state).await.map(Json)
}

pub(crate) async fn list_namespaces(
    State(state): State<AppState>,
    Query(query): Query<ContextQuery>,
) -> Result<Json<Vec<NamespaceItem>>, StatusCode> {
    services::list_namespaces(&state, query.context.as_deref())
        .await
        .map(Json)
}

pub(crate) async fn list_workloads(
    State(state): State<AppState>,
    Query(query): Query<WorkloadQuery>,
) -> Result<Json<Vec<WorkloadItem>>, StatusCode> {
    services::list_workloads(&state, &query.namespace, query.context.as_deref())
        .await
        .map(Json)
}

pub(crate) async fn get_logs(
    State(_state): State<AppState>,
    Query(query): Query<LogQuery>,
) -> Result<Json<Vec<LogEntry>>, StatusCode> {
    services::get_logs(
        &query.namespace,
        &query.kind,
        &query.name,
        query.search.as_deref(),
        query.since_minutes,
        query.start_time.as_deref(),
        query.end_time.as_deref(),
        query.context.as_deref(),
    )
    .await
    .map(Json)
}

pub(crate) async fn get_env(
    State(_state): State<AppState>,
    Query(query): Query<EnvQuery>,
) -> Result<Json<Vec<EnvVar>>, StatusCode> {
    services::get_env(
        &query.namespace,
        &query.kind,
        &query.name,
        query.context.as_deref(),
    )
    .await
    .map(Json)
}

pub(crate) async fn get_pod_status(
    State(_state): State<AppState>,
    Query(query): Query<PodStatusQuery>,
) -> Result<Json<Vec<PodStatusItem>>, StatusCode> {
    services::get_pod_status(
        &query.namespace,
        &query.kind,
        &query.name,
        query.context.as_deref(),
    )
    .await
    .map(Json)
}

pub(crate) async fn get_workload_spec(
    State(_state): State<AppState>,
    Query(query): Query<SpecQuery>,
) -> Result<Json<WorkloadSpecItem>, StatusCode> {
    services::get_workload_spec(
        &query.namespace,
        &query.kind,
        &query.name,
        query.context.as_deref(),
    )
    .await
    .map(Json)
}
