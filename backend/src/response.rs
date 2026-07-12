use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::Value;
use std::sync::OnceLock;
use tracing::info;

static ENVELOPE_MODE: OnceLock<bool> = OnceLock::new();

fn gateway_envelope_enabled() -> bool {
    *ENVELOPE_MODE.get_or_init(|| {
        let (enabled, reason) = if env_flag("API_GATEWAY_LAMBDA_MODE") {
            (true, "API_GATEWAY_LAMBDA_MODE=1")
        } else if std::env::var("AWS_LAMBDA_FUNCTION_NAME").is_ok() {
            (true, "AWS_LAMBDA_FUNCTION_NAME set")
        } else if std::env::var("AWS_LAMBDA_RUNTIME_API").is_ok() {
            (true, "AWS_LAMBDA_RUNTIME_API set")
        } else {
            (
                false,
                "no Lambda env vars detected; returning plain HTTP responses",
            )
        };

        info!(
            "API Gateway envelope {} ({})",
            if enabled { "enabled" } else { "disabled" },
            reason
        );

        enabled
    })
}

fn env_flag(name: &str) -> bool {
    matches!(
        std::env::var(name).as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("YES")
    )
}

fn envelope(status: StatusCode, body: Value) -> Response {
    if gateway_envelope_enabled() {
        let payload = serde_json::json!({
            "statusCode": status.as_u16(),
            "headers": {
                "content-type": "application/json"
            },
            "body": body.to_string()
        });
        Json(payload).into_response()
    } else {
        (status, Json(body)).into_response()
    }
}

pub fn build_response<T: Serialize>(status: StatusCode, body: &T) -> Response {
    match serde_json::to_value(body) {
        Ok(value) => envelope(status, value),
        Err(err) => {
            let fallback = serde_json::json!({
                "message": format!("failed to serialise response: {err}")
            });
            envelope(StatusCode::INTERNAL_SERVER_ERROR, fallback)
        }
    }
}

pub struct ApiResponse<T> {
    status: StatusCode,
    body: T,
}

impl<T> ApiResponse<T> {
    pub fn new(status: StatusCode, body: T) -> Self {
        Self { status, body }
    }

    pub fn ok(body: T) -> Self {
        Self::new(StatusCode::OK, body)
    }
}

impl<T> IntoResponse for ApiResponse<T>
where
    T: Serialize,
{
    fn into_response(self) -> Response {
        build_response(self.status, &self.body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use tokio::runtime::Runtime;

    #[test]
    fn wraps_body_for_gateway_when_flag_set() {
        std::env::set_var("API_GATEWAY_LAMBDA_MODE", "1");

        let response = build_response(StatusCode::CREATED, &serde_json::json!({"status": "ok"}));
        // Response body should be the envelope JSON
        let rt = Runtime::new().expect("runtime");
        let body_bytes = rt
            .block_on(async move { to_bytes(response.into_body(), usize::MAX).await })
            .expect("collect body");
        let parsed: Value = serde_json::from_slice(&body_bytes).expect("json body");

        assert_eq!(parsed["statusCode"], 201);
        assert_eq!(parsed["headers"]["content-type"], "application/json");
        assert_eq!(parsed["body"], "{\"status\":\"ok\"}");
    }
}
