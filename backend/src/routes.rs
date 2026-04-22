use axum::{middleware, routing::get, Router};
use tower_http::cors::{Any, CorsLayer};

use crate::{auth::auth_middleware, handlers, state::AppState};

pub(crate) fn build_app(state: AppState) -> Router {
    let api = Router::new()
        .route("/namespaces", get(handlers::list_namespaces))
        .route("/workloads", get(handlers::list_workloads))
        .route("/logs", get(handlers::get_logs))
        .route("/env", get(handlers::get_env))
        .route("/pod-status", get(handlers::get_pod_status))
        .route("/context", get(handlers::get_context))
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    Router::new()
        .route("/health", get(handlers::health))
        .nest("/api", api)
        .layer(CorsLayer::new().allow_origin(Any).allow_headers(Any))
}
