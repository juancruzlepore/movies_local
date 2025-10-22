use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use thiserror::Error;

use crate::storage::StorageError;

#[derive(Serialize)]
struct ErrorBody {
    message: String,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Configuration(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    TooManyRequests(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error("{0}")]
    Downstream(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Configuration(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::TooManyRequests(_) => StatusCode::TOO_MANY_REQUESTS,
            AppError::Storage(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::Downstream(_) => StatusCode::BAD_GATEWAY,
        };

        let body = ErrorBody {
            message: self.to_string(),
        };

        (status, Json(body)).into_response()
    }
}
