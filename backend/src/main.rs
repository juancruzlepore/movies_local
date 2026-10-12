mod error;
mod models;
mod response;
mod storage;

use std::net::SocketAddr;
use std::sync::Arc;
use std::{env, time::Duration};

use axum::extract::{Path, Query, State};
use axum::http::{Method, StatusCode};
use axum::response::Redirect;
use axum::routing::{get, post};
use axum::{body::Body, Json, Router};
use chrono::{Duration as ChronoDuration, Utc};
use error::AppError;
use lambda_http::{
    run as lambda_run, service_fn as lambda_service, Body as LambdaBody, Request as LambdaRequest,
    Response as LambdaResponse, Service,
};
use models::{
    Household, HouseholdRequest, Movie, NewMovie, SearchParams, SearchResponse, SearchResultItem,
    Vote, VoteRequest,
};
use parking_lot::RwLock;
use response::ApiResponse;
use serde::Deserialize;
use storage::{Storage, StorageConfig, VoteOutcome, SMALL_VOTE_POINTS};
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
    mock_movies: Option<Arc<RwLock<Vec<Movie>>>>,
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
    let s3_bucket = env::var("MOVIES_DB_S3_BUCKET").ok();
    let s3_key = env::var("MOVIES_DB_S3_KEY").unwrap_or_else(|_| "movies.json".to_string());

    let use_mock_data = matches!(
        env::var("MOCK_MOVIE_DATA")
            .or_else(|_| env::var("USE_MOCK_DATA"))
            .as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("YES")
    );

    let storage_config = if let Some(bucket) = s3_bucket {
        StorageConfig::s3(bucket, s3_key)
    } else {
        StorageConfig::local(data_path.into())
    };

    let storage = Storage::initialise(storage_config).await?;
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
            Some(Arc::new(RwLock::new(build_mock_movies())))
        } else {
            None
        },
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE])
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/households", get(list_households).post(create_household))
        .route("/households/:id/users", post(add_user))
        .route(
            "/households/:id/users/:name",
            axum::routing::delete(remove_user),
        )
        .route(
            "/households/:household_id/movies",
            get(list_movies).post(add_movie),
        )
        .route(
            "/households/:household_id/movies/:id/votes",
            post(vote_movie),
        )
        .route(
            "/households/:household_id/movies/:id/watch",
            post(mark_watched),
        )
        .route(
            "/households/:household_id/movies/:id/readd",
            post(readd_movie),
        )
        .route(
            "/households/:household_id/movies/:id",
            axum::routing::delete(remove_movie),
        )
        .route("/search", get(search_movies))
        .route("/posters/:imdb_id", get(resolve_poster))
        .with_state(state)
        .layer(cors);

    if is_lambda_env() {
        info!("detected Lambda environment; running handler mode");
        run_lambda(app)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    } else {
        let addr: SocketAddr = bind_addr.parse()?;
        let listener = TcpListener::bind(addr).await?;
        let local_addr = listener.local_addr()?;
        info!("listening on {local_addr}");

        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal())
            .await?;
    }

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

async fn health() -> ApiResponse<serde_json::Value> {
    ApiResponse::ok(serde_json::json!({"status": "ok"}))
}

async fn list_households(State(state): State<AppState>) -> ApiResponse<Vec<Household>> {
    ApiResponse::ok(state.storage.list_households())
}

async fn create_household(
    State(state): State<AppState>,
    Json(payload): Json<HouseholdRequest>,
) -> Result<ApiResponse<Household>, AppError> {
    if payload.name.trim().is_empty() {
        return Err(AppError::BadRequest("name cannot be empty".into()));
    }
    let household = state.storage.create_household(payload.name).await?;
    Ok(ApiResponse::ok(household))
}

async fn add_user(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<VoteRequest>, // Reusing VoteRequest for simple {voter: name} payload
) -> Result<ApiResponse<Household>, AppError> {
    if payload.voter.trim().is_empty() {
        return Err(AppError::BadRequest("voter cannot be empty".into()));
    }
    let household = state.storage.add_user(id, payload.voter).await?;
    Ok(ApiResponse::ok(household))
}

async fn remove_user(
    State(state): State<AppState>,
    Path((id, name)): Path<(Uuid, String)>,
) -> Result<ApiResponse<Household>, AppError> {
    let household = state.storage.remove_user(id, name).await?;
    Ok(ApiResponse::ok(household))
}

async fn list_movies(
    State(state): State<AppState>,
    Path(household_id): Path<Uuid>,
) -> Result<ApiResponse<Vec<Movie>>, AppError> {
    if let Some(mock_movies) = &state.mock_movies {
        return Ok(ApiResponse::ok(mock_movies.read().clone()));
    }

    let mut movies = state.storage.list(household_id)?;
    movies.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(ApiResponse::ok(movies))
}

async fn add_movie(
    State(state): State<AppState>,
    Path(household_id): Path<Uuid>,
    Json(mut payload): Json<NewMovie>,
) -> Result<ApiResponse<Movie>, AppError> {
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

    let movie = state.storage.add(household_id, payload).await?;
    Ok(ApiResponse::new(StatusCode::CREATED, movie))
}

async fn vote_movie(
    State(state): State<AppState>,
    Path((household_id, id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<VoteRequest>,
) -> Result<ApiResponse<Movie>, AppError> {
    validate_vote(&payload)?;
    let voter = payload.voter.trim().to_string();

    match state.storage.vote(household_id, id, voter.clone()).await? {
        VoteOutcome::PointsAwarded(movie) => Ok(ApiResponse::ok(movie)),
        VoteOutcome::LimitReached { limit } => {
            warn!(
                "vote rejected voter='{}' movie_id='{}' reason='daily limit'",
                voter, id
            );
            Err(AppError::TooManyRequests(format!(
                "Daily vote limit reached ({} per day)",
                limit
            )))
        }
        VoteOutcome::NotInVoting => Err(AppError::BadRequest(
            "movie must be re-added before voting".into(),
        )),
        VoteOutcome::NotFound => Err(AppError::NotFound("movie not found".into())),
    }
}

async fn mark_watched(
    State(state): State<AppState>,
    Path((household_id, id)): Path<(Uuid, Uuid)>,
) -> Result<ApiResponse<Movie>, AppError> {
    if let Some(mock_movies) = &state.mock_movies {
        let mut movies = mock_movies.write();
        if let Some(movie) = movies.iter_mut().find(|movie| movie.id == id) {
            if movie.in_voting != Some(false) {
                movie.last_watched_at = Some(Utc::now());
                movie.times_watched = movie.times_watched.saturating_add(1);
                movie.in_voting = Some(false);
                movie.points = 0.0;
            }
            return Ok(ApiResponse::ok(movie.clone()));
        }
        return Err(AppError::NotFound("movie not found".into()));
    }

    match state.storage.mark_watched(household_id, id).await? {
        Some(movie) => Ok(ApiResponse::ok(movie)),
        None => Err(AppError::NotFound("movie not found".into())),
    }
}

async fn readd_movie(
    State(state): State<AppState>,
    Path((household_id, id)): Path<(Uuid, Uuid)>,
) -> Result<ApiResponse<Movie>, AppError> {
    if let Some(mock_movies) = &state.mock_movies {
        let mut movies = mock_movies.write();
        if let Some(movie) = movies.iter_mut().find(|movie| movie.id == id) {
            movie.in_voting = Some(true);
            movie.points = 0.0;
            return Ok(ApiResponse::ok(movie.clone()));
        }
        return Err(AppError::NotFound("movie not found".into()));
    }

    match state.storage.readd_to_voting(household_id, id).await? {
        Some(movie) => Ok(ApiResponse::ok(movie)),
        None => Err(AppError::NotFound("movie not found".into())),
    }
}

async fn remove_movie(
    State(state): State<AppState>,
    Path((household_id, id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    if let Some(mock_movies) = &state.mock_movies {
        let mut movies = mock_movies.write();
        let original_len = movies.len();
        movies.retain(|movie| movie.id != id);
        return if movies.len() != original_len {
            Ok(StatusCode::NO_CONTENT)
        } else {
            Err(AppError::NotFound("movie not found".into()))
        };
    }

    if state.storage.remove_movie(household_id, id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound("movie not found".into()))
    }
}

async fn search_movies(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<ApiResponse<SearchResponse>, AppError> {
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

    Ok(ApiResponse::ok(response))
}

async fn resolve_poster(
    State(state): State<AppState>,
    Path(imdb_id): Path<String>,
) -> Result<Redirect, AppError> {
    if !is_valid_imdb_id(&imdb_id) {
        return Err(AppError::BadRequest("invalid IMDb id".into()));
    }

    let poster_url = state.fetch_movie_poster(&imdb_id).await?;
    let proxied_url = format!(
        "https://images.weserv.nl/?url={}&w=600&fit=cover&output=webp",
        urlencoding::encode(&poster_url)
    );
    Ok(Redirect::temporary(&proxied_url))
}

fn is_valid_imdb_id(value: &str) -> bool {
    value.len() >= 3
        && value.starts_with("tt")
        && value[2..]
            .chars()
            .all(|character| character.is_ascii_digit())
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
            points_awarded: Some(SMALL_VOTE_POINTS),
        },
        Vote {
            voter: "Waymond".to_string(),
            voted_at: Some(now - ChronoDuration::hours(3)),
            points_awarded: Some(SMALL_VOTE_POINTS),
        },
        Vote {
            voter: "Becky".to_string(),
            voted_at: Some(now - ChronoDuration::hours(5)),
            points_awarded: Some(SMALL_VOTE_POINTS),
        },
        Vote {
            voter: "Gong Gong".to_string(),
            voted_at: Some(now - ChronoDuration::hours(8)),
            points_awarded: Some(SMALL_VOTE_POINTS),
        },
        Vote {
            voter: "Deirdre".to_string(),
            voted_at: Some(now - ChronoDuration::hours(12)),
            points_awarded: Some(SMALL_VOTE_POINTS),
        },
    ];

    let spiderverse_votes = vec![
        Vote {
            voter: "Gwen".to_string(),
            voted_at: Some(now - ChronoDuration::hours(4)),
            points_awarded: Some(SMALL_VOTE_POINTS),
        },
        Vote {
            voter: "Peter B.".to_string(),
            voted_at: Some(now - ChronoDuration::hours(6)),
            points_awarded: Some(SMALL_VOTE_POINTS),
        },
        Vote {
            voter: "Hobie".to_string(),
            voted_at: Some(now - ChronoDuration::hours(7)),
            points_awarded: Some(SMALL_VOTE_POINTS),
        },
    ];

    let bakeoff_votes = vec![
        Vote {
            voter: "Prue".to_string(),
            voted_at: Some(now - ChronoDuration::hours(10)),
            points_awarded: Some(SMALL_VOTE_POINTS),
        },
        Vote {
            voter: "Noel".to_string(),
            voted_at: Some(now - ChronoDuration::hours(16)),
            points_awarded: Some(SMALL_VOTE_POINTS),
        },
    ];

    let eeaao_points: f32 = eeaao_votes
        .iter()
        .map(|vote| vote.points_awarded.unwrap_or(SMALL_VOTE_POINTS))
        .sum();
    let spiderverse_points: f32 = spiderverse_votes
        .iter()
        .map(|vote| vote.points_awarded.unwrap_or(SMALL_VOTE_POINTS))
        .sum();
    let bakeoff_points: f32 = bakeoff_votes
        .iter()
        .map(|vote| vote.points_awarded.unwrap_or(SMALL_VOTE_POINTS))
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
            times_watched: 2,
            in_voting: Some(false),
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
            times_watched: 0,
            in_voting: Some(true),
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
            times_watched: 4,
            in_voting: Some(false),
            points: bakeoff_points,
            vote_history: bakeoff_votes,
            created_at: now - ChronoDuration::days(7),
        },
    ]
}

impl AppState {
    async fn fetch_movie_poster(&self, imdb_id: &str) -> Result<String, AppError> {
        #[derive(Deserialize)]
        struct OmdbPosterResponse {
            #[serde(rename = "Poster")]
            poster: Option<String>,
            #[serde(rename = "Response")]
            response: String,
            #[serde(rename = "Error")]
            error: Option<String>,
        }

        let key = self
            .omdb_api_key
            .as_ref()
            .ok_or_else(|| AppError::Configuration("OMDB_API_KEY is not configured".into()))?;
        let response = self
            .client
            .get("https://www.omdbapi.com/")
            .query(&[("apikey", key.as_str()), ("i", imdb_id)])
            .send()
            .await
            .map_err(|err| AppError::Downstream(format!("omdb request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(AppError::Downstream(format!(
                "omdb returned unexpected status: {}",
                response.status()
            )));
        }

        let payload: OmdbPosterResponse = response.json().await.map_err(|err| {
            AppError::Downstream(format!("failed to decode omdb response: {err}"))
        })?;
        let poster = payload.poster.filter(|value| value != "N/A");
        if payload.response.eq_ignore_ascii_case("true") {
            poster.ok_or_else(|| AppError::NotFound("poster not found".into()))
        } else {
            Err(AppError::NotFound(
                payload.error.unwrap_or_else(|| "poster not found".into()),
            ))
        }
    }

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
            let results: Vec<SearchResultItem> = payload
                .search
                .unwrap_or_default()
                .into_iter()
                .filter(|item| {
                    !matches!(
                        item.media_type.as_deref(),
                        Some(media_type) if media_type.eq_ignore_ascii_case("game")
                    )
                })
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

fn is_lambda_env() -> bool {
    matches!(
        std::env::var("API_GATEWAY_LAMBDA_MODE")
            .or_else(|_| std::env::var("AWS_LAMBDA_RUNTIME_API"))
            .as_deref(),
        Ok(_)
    )
}

async fn run_lambda(app: Router) -> Result<(), lambda_http::Error> {
    let handler = lambda_service(move |event: LambdaRequest| {
        let mut app = app.clone();
        async move {
            let axum_request = lambda_to_axum(event)?;
            let response = app
                .call(axum_request)
                .await
                .map_err(lambda_http::Error::from)?;
            axum_to_lambda(response).await
        }
    });

    lambda_run(handler).await
}

fn lambda_to_axum(request: LambdaRequest) -> Result<axum::http::Request<Body>, lambda_http::Error> {
    let (parts, body) = request.into_parts();
    let body = match body {
        LambdaBody::Empty => Body::empty(),
        LambdaBody::Text(text) => Body::from(text),
        LambdaBody::Binary(bin) => Body::from(bin),
    };

    Ok(axum::http::Request::from_parts(parts, body))
}

async fn axum_to_lambda(
    response: axum::http::Response<axum::body::Body>,
) -> Result<LambdaResponse<LambdaBody>, lambda_http::Error> {
    let (parts, body) = response.into_parts();
    let bytes = axum::body::to_bytes(body, usize::MAX)
        .await
        .map_err(lambda_http::Error::from)?;

    Ok(lambda_http::Response::from_parts(
        parts,
        LambdaBody::Binary(bytes.to_vec()),
    ))
}
