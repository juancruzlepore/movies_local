use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Movie {
    pub id: Uuid,
    pub title: String,
    pub imdb_id: String,
    pub added_by: String,
    #[serde(default)]
    pub poster_url: Option<String>,
    #[serde(default)]
    pub year: Option<String>,
    #[serde(default)]
    pub media_type: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub plot: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct NewMovie {
    pub title: String,
    pub imdb_id: String,
    pub added_by: String,
    #[serde(default)]
    pub poster_url: Option<String>,
    #[serde(default)]
    pub year: Option<String>,
    #[serde(default)]
    pub media_type: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub plot: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SearchParams {
    pub query: String,
    #[serde(default)]
    pub media_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub title: String,
    pub year: Option<String>,
    pub imdb_id: String,
    pub media_type: Option<String>,
    pub poster_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResultItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_results: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct OmdbSearchResponse {
    #[serde(rename = "Search")]
    pub search: Option<Vec<OmdbSearchItem>>,
    #[serde(rename = "totalResults")]
    pub total_results: Option<String>,
    #[serde(rename = "Response")]
    pub response: String,
    #[serde(rename = "Error")]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OmdbSearchItem {
    #[serde(rename = "Title")]
    pub title: String,
    #[serde(rename = "Year")]
    pub year: Option<String>,
    #[serde(rename = "imdbID")]
    pub imdb_id: String,
    #[serde(rename = "Type")]
    pub media_type: Option<String>,
    #[serde(rename = "Poster")]
    pub poster_url: Option<String>,
}

impl SearchResultItem {
    pub fn from_omdb(item: OmdbSearchItem) -> Self {
        Self {
            title: item.title,
            year: item.year,
            imdb_id: item.imdb_id,
            media_type: item.media_type,
            poster_url: item.poster_url,
        }
    }
}
