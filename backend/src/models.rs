use chrono::{DateTime, Utc};
use serde::de::Deserializer;
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
    #[serde(default)]
    pub runtime_minutes: Option<u32>,
    #[serde(default)]
    pub last_watched_at: Option<DateTime<Utc>>,
    #[serde(default, alias = "votes")]
    pub points: u32,
    #[serde(
        default,
        alias = "voters",
        deserialize_with = "deserialize_vote_history"
    )]
    pub vote_history: Vec<Vote>,
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
    #[serde(default)]
    pub runtime_minutes: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct VoteRequest {
    pub voter: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vote {
    pub voter: String,
    #[serde(default)]
    pub voted_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub points_awarded: Option<u32>,
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

fn deserialize_vote_history<'de, D>(deserializer: D) -> Result<Vec<Vote>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum VoteItem {
        Record(Vote),
        Name(String),
    }

    let items = Vec::<VoteItem>::deserialize(deserializer)?;
    Ok(items
        .into_iter()
        .map(|item| match item {
            VoteItem::Record(record) => record,
            VoteItem::Name(name) => Vote {
                voter: name,
                voted_at: None,
                points_awarded: None,
            },
        })
        .collect())
}
