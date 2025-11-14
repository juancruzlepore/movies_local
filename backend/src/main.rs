mod error;
mod models;
mod storage;

use std::net::SocketAddr;
use std::sync::Arc;
use std::{env, time::Duration};

use axum::extract::{Path, Query, State};
use axum::http::{Method, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration as ChronoDuration, Utc};
use error::AppError;
use models::{Movie, NewMovie, SearchParams, SearchResponse, SearchResultItem, Vote, VoteRequest};
use serde::Deserialize;
use storage::{Storage, VoteOutcome, ANNE_VOTE_POINTS, DAILY_VOTE_LIMIT};
use tokio::net::TcpListener;
use tokio::signal;
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    storage: Arc<Storage>,
    client: reqwest::Client,
    omdb_api_key: Option<String>,
    mock_movies: Option<Vec<Movie>>,
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

    let use_mock_data = matches!(
        env::var("MOCK_MOVIE_DATA")
            .or_else(|_| env::var("USE_MOCK_DATA"))
            .as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("YES")
    );

    let storage = Storage::initialise(data_path.into()).await?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .use_rustls_tls()
        .timeout(Duration::from_secs(10))
        .user_agent("movies-local-backend/0.1")
        .build()?;

    let state = AppState {
        storage: Arc::new(storage),
        client,
        omdb_api_key,
        mock_movies: if use_mock_data {
            Some(build_mock_movies())
        } else {
            None
        },
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/movies", get(list_movies).post(add_movie))
        .route("/movies/:id/votes", post(vote_movie))
        .route("/movies/:id/watch", post(mark_watched))
        .route("/search", get(search_movies))
        .with_state(state)
        .layer(cors);

    let addr: SocketAddr = bind_addr.parse()?;
    let listener = TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr()?;
    info!("listening on {local_addr}");

    axum::serve(listener, app)
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
    if let Some(mock_movies) = &state.mock_movies {
        return Ok(Json(mock_movies.clone()));
    }

    let mut movies = state.storage.list();
    movies.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(Json(movies))
}

async fn add_movie(
    State(state): State<AppState>,
    Json(mut payload): Json<NewMovie>,
) -> Result<(StatusCode, Json<Movie>), AppError> {
    validate_new_movie(&payload)?;

    match state.fetch_movie_runtime(&payload.imdb_id).await {
        Ok(runtime) => payload.runtime_minutes = runtime,
        Err(err) => {
            warn!(
                "failed to fetch runtime imdb_id='{}': {}",
                payload.imdb_id, err
            );
        }
    }

    let movie = state.storage.add(payload).await?;
    Ok((StatusCode::CREATED, Json(movie)))
}

async fn vote_movie(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<VoteRequest>,
) -> Result<Json<Movie>, AppError> {
    validate_vote(&payload)?;
    let voter = payload.voter.trim().to_string();

    match state.storage.vote(id, voter.clone()).await? {
        VoteOutcome::PointsAwarded(movie) => Ok(Json(movie)),
        VoteOutcome::LimitReached => {
            warn!(
                "vote rejected voter='{}' movie_id='{}' reason='daily limit'",
                voter, id
            );
            Err(AppError::TooManyRequests(format!(
                "Daily vote limit reached ({} per day)",
                DAILY_VOTE_LIMIT
            )))
        }
        VoteOutcome::NotFound => Err(AppError::NotFound("movie not found".into())),
    }
}

async fn mark_watched(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Movie>, AppError> {
    match state.storage.mark_watched(id).await? {
        Some(movie) => Ok(Json(movie)),
        None => Err(AppError::NotFound("movie not found".into())),
    }
}

async fn search_movies(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SearchResponse>, AppError> {
    if params.query.trim().is_empty() {
        return Err(AppError::BadRequest(
            "query parameter cannot be empty".into(),
        ));
    }

    info!(
        "search requested query='{}' media_type={:?}",
        params.query, params.media_type
    );

    let response = match state.search_omdb(&params).await {
        Ok(payload) => payload,
        Err(err) => {
            warn!(
                "search failed query='{}' media_type={:?}: {}",
                params.query, params.media_type, err
            );
            return Err(err);
        }
    };

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

fn validate_vote(payload: &VoteRequest) -> Result<(), AppError> {
    if payload.voter.trim().is_empty() {
        return Err(AppError::BadRequest("voter cannot be empty".into()));
    }
    Ok(())
}

fn build_mock_movies() -> Vec<Movie> {
    let now = Utc::now();

    let eeaao_votes = vec![
        Vote {
            voter: "Joy".to_string(),
            voted_at: Some(now - ChronoDuration::hours(2)),
            points_awarded: Some(ANNE_VOTE_POINTS),
        },
        Vote {
            voter: "Waymond".to_string(),
            voted_at: Some(now - ChronoDuration::hours(3)),
            points_awarded: Some(ANNE_VOTE_POINTS),
        },
        Vote {
            voter: "Becky".to_string(),
            voted_at: Some(now - ChronoDuration::hours(5)),
            points_awarded: Some(ANNE_VOTE_POINTS),
        },
        Vote {
            voter: "Gong Gong".to_string(),
            voted_at: Some(now - ChronoDuration::hours(8)),
            points_awarded: Some(ANNE_VOTE_POINTS),
        },
        Vote {
            voter: "Deirdre".to_string(),
            voted_at: Some(now - ChronoDuration::hours(12)),
            points_awarded: Some(ANNE_VOTE_POINTS),
        },
    ];

    let spiderverse_votes = vec![
        Vote {
            voter: "Gwen".to_string(),
            voted_at: Some(now - ChronoDuration::hours(4)),
            points_awarded: Some(ANNE_VOTE_POINTS),
        },
        Vote {
            voter: "Peter B.".to_string(),
            voted_at: Some(now - ChronoDuration::hours(6)),
            points_awarded: Some(ANNE_VOTE_POINTS),
        },
        Vote {
            voter: "Hobie".to_string(),
            voted_at: Some(now - ChronoDuration::hours(7)),
            points_awarded: Some(ANNE_VOTE_POINTS),
        },
    ];

    let bakeoff_votes = vec![
        Vote {
            voter: "Prue".to_string(),
            voted_at: Some(now - ChronoDuration::hours(10)),
            points_awarded: Some(ANNE_VOTE_POINTS),
        },
        Vote {
            voter: "Noel".to_string(),
            voted_at: Some(now - ChronoDuration::hours(16)),
            points_awarded: Some(ANNE_VOTE_POINTS),
        },
    ];

    let eeaao_points: f32 = eeaao_votes
        .iter()
        .map(|vote| vote.points_awarded.unwrap_or(ANNE_VOTE_POINTS))
        .sum();
    let spiderverse_points: f32 = spiderverse_votes
        .iter()
        .map(|vote| vote.points_awarded.unwrap_or(ANNE_VOTE_POINTS))
        .sum();
    let bakeoff_points: f32 = bakeoff_votes
        .iter()
        .map(|vote| vote.points_awarded.unwrap_or(ANNE_VOTE_POINTS))
        .sum();

    vec![
        Movie {
            id: Uuid::parse_str("f5a5c2a3-5b74-4ef1-8f9e-2e8de3e83c85").expect("valid uuid"),
            title: "Everything Everywhere All at Once".to_string(),
            imdb_id: "tt6710474".to_string(),
            added_by: "Evelyn".to_string(),
            poster_url: Some("https://example.com/posters/everything-everywhere.jpg".to_string()),
            year: Some("2022".to_string()),
            media_type: Some("movie".to_string()),
            notes: Some("Multiverse adventure for the laundromat crew.".to_string()),
            plot: Some("An overwhelmed laundromat owner discovers the power to fight across universes.".to_string()),
            runtime_minutes: Some(139),
            last_watched_at: Some(now - ChronoDuration::hours(6)),
            points: eeaao_points,
            vote_history: eeaao_votes,
            created_at: now - ChronoDuration::days(1),
        },
        Movie {
            id: Uuid::parse_str("f9e9a2c6-2a19-4c5d-96b2-4b967ac9a5c0").expect("valid uuid"),
            title: "Spider-Man: Across the Spider-Verse".to_string(),
            imdb_id: "tt9362722".to_string(),
            added_by: "Miles".to_string(),
            poster_url: Some("https://example.com/posters/spiderverse-2.jpg".to_string()),
            year: Some("2023".to_string()),
            media_type: Some("movie".to_string()),
            notes: Some("Animated sequel night with the Spot as the villain.".to_string()),
            plot: Some("Miles Morales teams up with Gwen Stacy and the Spider-Society on a multiversal mission.".to_string()),
            runtime_minutes: Some(140),
            last_watched_at: None,
            points: spiderverse_points,
            vote_history: spiderverse_votes,
            created_at: now - ChronoDuration::days(3),
        },
        Movie {
            id: Uuid::parse_str("bce29ad0-1a73-49a0-9a3f-0fdd42a05ad2").expect("valid uuid"),
            title: "The Great British Bake Off: Holiday Special".to_string(),
            imdb_id: "tt7605052".to_string(),
            added_by: "Paul".to_string(),
            poster_url: Some("https://example.com/posters/gbbo-holiday-special.jpg".to_string()),
            year: Some("2021".to_string()),
            media_type: Some("series".to_string()),
            notes: Some("Cozy seasonal episode for background comfort.".to_string()),
            plot: Some("Fan favourites return to the tent for festive bakes.".to_string()),
            runtime_minutes: Some(60),
            last_watched_at: Some(now - ChronoDuration::days(2)),
            points: bakeoff_points,
            vote_history: bakeoff_votes,
            created_at: now - ChronoDuration::days(7),
        },
    ]
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

        let payload: models::OmdbSearchResponse = response.json().await.map_err(|err| {
            AppError::Downstream(format!("failed to decode omdb response: {err}"))
        })?;

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

    async fn fetch_movie_runtime(&self, imdb_id: &str) -> Result<Option<u32>, AppError> {
        let key = match self.omdb_api_key.as_ref() {
            Some(key) => key,
            None => return Ok(None),
        };

        #[derive(Debug, Deserialize)]
        struct OmdbDetailResponse {
            #[serde(rename = "Response")]
            response: String,
            #[serde(rename = "Error")]
            error: Option<String>,
            #[serde(rename = "Runtime")]
            runtime: Option<String>,
        }

        let response = self
            .client
            .get("https://www.omdbapi.com/")
            .query(&[("apikey", key.as_str()), ("i", imdb_id)])
            .send()
            .await
            .map_err(|err| AppError::Downstream(format!("omdb detail failed: {err}")))?;

        if !response.status().is_success() {
            return Err(AppError::Downstream(format!(
                "omdb detail returned unexpected status: {}",
                response.status()
            )));
        }

        let payload: OmdbDetailResponse = response.json().await.map_err(|err| {
            AppError::Downstream(format!("failed to decode omdb detail response: {err}"))
        })?;

        if !payload.response.eq_ignore_ascii_case("true") {
            if let Some(error) = payload.error {
                warn!(
                    "omdb detail responded with error imdb_id='{}': {}",
                    imdb_id, error
                );
            }
            return Ok(None);
        }

        Ok(payload
            .runtime
            .and_then(|value| parse_runtime_minutes(&value)))
    }
}

fn parse_runtime_minutes(value: &str) -> Option<u32> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("N/A") {
        return None;
    }

    let digits = trimmed.split_whitespace().next().unwrap_or(trimmed);

    digits.parse().ok()
}
