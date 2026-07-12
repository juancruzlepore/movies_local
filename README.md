# movies_local

Movies Local lets two (or more) people on the same network build a shared list of films and shows. The first version in this repository consists of a Rust backend that keeps a local JSON database and an unbundled mobile-first web frontend that talks to it.

## Backend (Rust)

### Requirements
- Rust toolchain (edition 2021)
- OMDb API key (free key from https://www.omdbapi.com/apikey.aspx)

### Configuration
| Environment variable | Default | Description |
| --- | --- | --- |
| `BIND_ADDRESS` | `0.0.0.0:8080` | Address where the Axum server listens. |
| `MOVIES_DB_PATH` | `data/movies.json` | Location of the JSON file that stores the shared list. |
| `MOVIES_DB_S3_BUCKET` | _(unset)_ | When set, the backend loads and persists the JSON from this S3 bucket instead of the local file. |
| `MOVIES_DB_S3_KEY` | `movies.json` | Key to use inside `MOVIES_DB_S3_BUCKET` when S3 storage is enabled. |
| `OMDB_API_KEY` | _(required)_ | Needed for `/search` to proxy queries to the OMDb API. |
| `MOCK_MOVIE_DATA` | _(unset)_ | When set to `1`, `true`, or `yes`, `/movies` returns built-in sample entries for UI previews. |

S3 mode relies on the standard AWS credential chain (environment variables, config files, or IAM role).

### Run the server
```bash
cd backend
cargo run
```

To serve built-in mock data for UI development, set `MOCK_MOVIE_DATA=1` when starting the backend:

```bash
MOCK_MOVIE_DATA=1 cargo run
```
The server creates (or reuses) the JSON data file and exposes these HTTP endpoints:
- `GET /health` – lightweight readiness probe
- `GET /movies` – returns the stored list ordered by newest first
- `POST /movies` – stores a movie entry; expects JSON with `title`, `imdb_id`, and `added_by`
- `GET /search?query=Inception&media_type=movie` – proxies to OMDb and normalises the payload for the frontend
- `GET /posters/:imdb_id` – refreshes a missing poster through OMDb and redirects to a third-party image proxy

## Frontend (static web)
The frontend is a single-page experience located in `frontend/` and optimised for phones:
- `index.html` – HTML shell that loads the UI
- `styles.css` – glassmorphism-inspired theme for the mobile layout
- `app.js` – vanilla JS module that loads your name from `localStorage`, fetches the shared list, searches OMDb through the backend, and posts new entries

Existing posters automatically retry through the free weserv.nl image proxy when their stored source fails. Missing or stale posters then use `/posters/:imdb_id` to refresh the current OMDb image URL. Poster bytes stay on third-party infrastructure rather than S3.

You can serve the folder with any static file server, for example:
```bash
cd frontend
python3 -m http.server 9000
```
Then open `http://localhost:9000` on your device. The script points to `http://<current-host>:8080` by default, matching the backend default. When you need a different API URL, set `window.API_BASE_URL` before loading `app.js` (e.g. `<script>window.API_BASE_URL = "http://192.168.1.20:8080";</script>` in `index.html`).

## AWS deployment

Production uses these resources in `eu-west-2`:

- Frontend: S3 website bucket `movies-frontend.jclepore`
- Backend: ARM64 Lambda `movies-backend` using the `provided.al2023` runtime
- API: HTTP API `zf23h8tk44` with an `ANY /{proxy+}` Lambda integration
- Data: S3 bucket `movies-backend-storage.jclepore` (`movies.json` is not touched by deployment)

Prerequisites are authenticated AWS CLI access, Rust, Node.js, and `cargo-lambda`. Deploy from the repository root:

```bash
./scripts/deploy-aws.sh
```

The script runs formatting, tests, a release ARM64 Lambda build, JavaScript syntax validation, and whitespace checks. It then updates and waits for the Lambda, sets its timeout to 15 seconds, syncs `frontend/` to the website bucket, and verifies the health endpoint, poster redirect, and frontend release marker. Environment variables such as `AWS_REGION`, `MOVIES_LAMBDA_FUNCTION`, and `MOVIES_FRONTEND_BUCKET` can override the documented defaults.

## Next steps
- Add authentication or PIN protection to avoid accidental edits from unknown clients
- Expand storage to support covers/notes and move from JSON to something more robust (SQLite)
- Package the frontend with a build tool so assets can be minified and versioned
