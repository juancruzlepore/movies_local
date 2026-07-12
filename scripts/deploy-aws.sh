#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-eu-west-2}"
LAMBDA_FUNCTION="${MOVIES_LAMBDA_FUNCTION:-movies-backend}"
FRONTEND_BUCKET="${MOVIES_FRONTEND_BUCKET:-movies-frontend.jclepore}"
API_BASE="${MOVIES_API_BASE:-https://zf23h8tk44.execute-api.eu-west-2.amazonaws.com}"
FRONTEND_URL="${MOVIES_FRONTEND_URL:-http://movies-frontend.jclepore.s3-website.eu-west-2.amazonaws.com}"
LAMBDA_ZIP="$ROOT_DIR/backend/target/lambda/movies_local_backend/bootstrap.zip"

command -v aws >/dev/null
command -v cargo >/dev/null
command -v cargo-lambda >/dev/null
command -v curl >/dev/null

echo "Running release checks"
(cd "$ROOT_DIR/backend" && cargo fmt --check && cargo test && cargo lambda build --release --arm64 --output-format zip)
node --check "$ROOT_DIR/frontend/app.js"
git -C "$ROOT_DIR" diff --check

echo "Deploying backend to Lambda: $LAMBDA_FUNCTION ($REGION)"
aws lambda update-function-code \
  --function-name "$LAMBDA_FUNCTION" \
  --region "$REGION" \
  --zip-file "fileb://$LAMBDA_ZIP" \
  >/dev/null
aws lambda wait function-updated \
  --function-name "$LAMBDA_FUNCTION" \
  --region "$REGION"

# OMDb calls may outlive the old three-second Lambda timeout on a cold start.
aws lambda update-function-configuration \
  --function-name "$LAMBDA_FUNCTION" \
  --region "$REGION" \
  --timeout 15 \
  >/dev/null
aws lambda wait function-updated \
  --function-name "$LAMBDA_FUNCTION" \
  --region "$REGION"

echo "Deploying static frontend to s3://$FRONTEND_BUCKET"
aws s3 sync "$ROOT_DIR/frontend/" "s3://$FRONTEND_BUCKET/" \
  --region "$REGION" \
  --delete \
  --cache-control no-cache

echo "Verifying production"
health_body="$(curl --fail --silent --show-error "$API_BASE/health")"
if [[ "$health_body" != *'status'* || "$health_body" != *'ok'* ]]; then
  echo "Unexpected health response: $health_body" >&2
  exit 1
fi

poster_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$API_BASE/posters/tt0145487")"
if [[ "$poster_status" != "307" && "$poster_status" != "302" ]]; then
  echo "Poster fallback returned HTTP $poster_status" >&2
  exit 1
fi

frontend_html="$(curl --fail --silent --show-error "$FRONTEND_URL/")"
if [[ "$frontend_html" != *'app.js?v=poster-fallback-1'* ]]; then
  echo "Frontend did not expose the expected release marker" >&2
  exit 1
fi

echo "Deployment verified: $FRONTEND_URL"
