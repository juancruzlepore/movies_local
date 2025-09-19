mod error;
mod models;
mod storage;

use std::net::SocketAddr;
use std::sync::Arc;
use std::{env, time::Duration};

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use error::AppError;
use models::{Movie, NewMovie, SearchParams, SearchResponse, SearchResultItem};
use storage::Storage;
use tokio::signal;
use tracing::{info, warn};

#[derive(Clone)]
struct AppState {
    storage: Arc<Storage>,
    client: reqwest::Client,
    omdb_api_key: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "movies_local_backend=info,axum=info");
    }

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .compact()
        .init();

    let data_path = env::var("MOVIES_DB_PATH").unwrap_or_else(|_| "data/movies.json".to_string());
    let bind_addr = env::var("BIND_ADDRESS").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let omdb_api_key = env::var("OMDB_API_KEY").ok();

    let storage = Storage::initialise(data_path.into()).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let state = AppState {
        storage: Arc::new(storage),
        client,
        omdb_api_key,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/movies", get(list_movies).post(add_movie))
        .route("/search", get(search_movies))
        .with_state(state);

    let addr: SocketAddr = bind_addr.parse()?;
    info!("listening on {addr}");

    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{signal, SignalKind};

        if let Ok(mut sigterm) = signal(SignalKind::terminate()) {
            sigterm.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok"}))
}

async fn list_movies(State(state): State<AppState>) -> Result<Json<Vec<Movie>>, AppError> {
    let mut movies = state.storage.list();
    movies.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(Json(movies))
}

async fn add_movie(
    State(state): State<AppState>,
    Json(payload): Json<NewMovie>,
) -> Result<(StatusCode, Json<Movie>), AppError> {
    validate_new_movie(&payload)?;
    let movie = state.storage.add(payload).await?;
    Ok((StatusCode::CREATED, Json(movie)))
}

async fn search_movies(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SearchResponse>, AppError> {
    if params.query.trim().is_empty() {
        return Err(AppError::BadRequest("query parameter cannot be empty".into()));
    }

    let response = state.search_omdb(&params).await?;
    Ok(Json(response))
}

fn validate_new_movie(payload: &NewMovie) -> Result<(), AppError> {
    if payload.title.trim().is_empty() {
        return Err(AppError::BadRequest("title cannot be empty".into()));
    }
    if payload.imdb_id.trim().is_empty() {
        return Err(AppError::BadRequest("imdb_id cannot be empty".into()));
    }
    if payload.added_by.trim().is_empty() {
        return Err(AppError::BadRequest("added_by cannot be empty".into()));
    }
    Ok(())
}

impl AppState {
    async fn search_omdb(&self, params: &SearchParams) -> Result<SearchResponse, AppError> {
        let key = self
            .omdb_api_key
            .as_ref()
            .ok_or_else(|| AppError::Configuration("OMDB_API_KEY is not configured".into()))?;

        let mut request = self
            .client
            .get("https://www.omdbapi.com/")
            .query(&[("apikey", key), ("s", &params.query)]);

        if let Some(media_type) = params.media_type.as_ref() {
            request = request.query(&[("type", media_type)]);
        }

        let response = request
            .send()
            .await
            .map_err(|err| AppError::Downstream(format!("omdb request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(AppError::Downstream(format!(
                "omdb returned unexpected status: {}",
                response.status()
            )));
        }

        let payload: models::OmdbSearchResponse = response
            .json()
            .await
            .map_err(|err| AppError::Downstream(format!("failed to decode omdb response: {err}")))?;

        if payload.response.eq_ignore_ascii_case("true") {
            let results = payload
                .search
                .unwrap_or_default()
                .into_iter()
                .map(SearchResultItem::from_omdb)
                .collect();

            let total_results = payload
                .total_results
                .and_then(|value| value.parse::<u32>().ok());

            Ok(SearchResponse {
                results,
                total_results,
            })
        } else {
            warn!("omdb responded with error: {:?}", payload.error);
            Ok(SearchResponse {
                results: Vec::new(),
                total_results: Some(0),
            })
        }
    }
}
