use axum::{
    extract::State,
    http::{header, HeaderMap, Request, StatusCode},
    middleware::Next,
    response::IntoResponse,
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use reqwest::header::CACHE_CONTROL;
use serde::Deserialize;
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tracing::error;

use crate::state::{AuthState, JwksCache};

pub(crate) async fn auth_middleware(
    State(state): State<crate::state::AppState>,
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
    if let Some(keys) = get_cached_google_keys(auth, Instant::now()).await {
        return Ok(keys);
    }

    let _fetch_guard = auth.jwks_fetch_lock.lock().await;

    if let Some(keys) = get_cached_google_keys(auth, Instant::now()).await {
        return Ok(keys);
    }

    let response = auth
        .http_client
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

    let jwks: JwksResponse = response.json().await.map_err(|_| StatusCode::BAD_GATEWAY)?;

    let mut keys = HashMap::new();
    for jwk in jwks.keys {
        if jwk.kty != "RSA" {
            continue;
        }
        let decoding = DecodingKey::from_rsa_components(&jwk.n, &jwk.e)
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
        keys.insert(jwk.kid, decoding);
    }

    let expires_at = Instant::now() + Duration::from_secs(max_age);
    {
        let mut cache = auth.jwks_cache.write().await;
        *cache = Some(JwksCache {
            keys: keys.clone(),
            expires_at,
        });
    }

    Ok(keys)
}

async fn get_cached_google_keys(
    auth: &AuthState,
    now: Instant,
) -> Option<HashMap<String, DecodingKey>> {
    let cache = auth.jwks_cache.read().await;
    cache.as_ref().and_then(|cached| {
        if cached.expires_at > now {
            Some(cached.keys.clone())
        } else {
            None
        }
    })
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
