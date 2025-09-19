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
| `OMDB_API_KEY` | _(required)_ | Needed for `/search` to proxy queries to the OMDb API. |

### Run the server
```bash
cd backend
cargo run
```
The server creates (or reuses) the JSON data file and exposes these HTTP endpoints:
- `GET /health` – lightweight readiness probe
- `GET /movies` – returns the stored list ordered by newest first
- `POST /movies` – stores a movie entry; expects JSON with `title`, `imdb_id`, and `added_by`
- `GET /search?query=Inception&media_type=movie` – proxies to OMDb and normalises the payload for the frontend

## Frontend (static web)
The frontend is a single-page experience located in `frontend/` and optimised for phones:
- `index.html` – HTML shell that loads the UI
- `styles.css` – glassmorphism-inspired theme for the mobile layout
- `app.js` – vanilla JS module that loads your name from `localStorage`, fetches the shared list, searches OMDb through the backend, and posts new entries

You can serve the folder with any static file server, for example:
```bash
cd frontend
python3 -m http.server 9000
```
Then open `http://localhost:9000` on your device. The script points to `http://<current-host>:8080` by default, matching the backend default. When you need a different API URL, set `window.API_BASE_URL` before loading `app.js` (e.g. `<script>window.API_BASE_URL = "http://192.168.1.20:8080";</script>` in `index.html`).

## Next steps
- Add authentication or PIN protection to avoid accidental edits from unknown clients
- Expand storage to support covers/notes and move from JSON to something more robust (SQLite)
- Package the frontend with a build tool so assets can be minified and versioned
