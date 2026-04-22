mod auth;
mod constants;
mod handlers;
mod models;
mod routes;
mod services;
mod state;

use state::{ApiCache, AppState, AuthState};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tracing::{error, info};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let client = match kube::Client::try_default().await {
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
            http_client: reqwest::Client::new(),
            jwks_cache: RwLock::new(None),
            jwks_fetch_lock: Mutex::new(()),
        }),
        cache: Arc::new(RwLock::new(ApiCache::default())),
    };

    let app = routes::build_app(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8081".to_string());
    let addr = format!("0.0.0.0:{port}");
    info!("starting server on {addr}");

    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;

    Ok(())
}
