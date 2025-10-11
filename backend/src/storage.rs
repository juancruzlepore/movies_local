use std::path::PathBuf;

use parking_lot::RwLock;
use tokio::fs;

use crate::models::{Movie, NewMovie, VoteRecord};
use chrono::Utc;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("data serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

#[derive(Debug)]
pub struct Storage {
    path: PathBuf,
    inner: RwLock<Vec<Movie>>,
}

impl Storage {
    pub async fn initialise(path: PathBuf) -> Result<Self, StorageError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let movies = if fs::try_exists(&path).await? {
            let contents = fs::read(&path).await?;
            if contents.is_empty() {
                Vec::new()
            } else {
                serde_json::from_slice(&contents)?
            }
        } else {
            Vec::new()
        };

        Ok(Self {
            path,
            inner: RwLock::new(movies),
        })
    }

    pub fn list(&self) -> Vec<Movie> {
        self.inner.read().clone()
    }

    pub async fn add(&self, request: NewMovie) -> Result<Movie, StorageError> {
        let movie = Movie {
            id: Uuid::new_v4(),
            title: request.title,
            imdb_id: request.imdb_id,
            added_by: request.added_by,
            poster_url: request.poster_url,
            year: request.year,
            media_type: request.media_type,
            notes: request.notes,
            plot: request.plot,
            votes: 0,
            voters: Vec::new(),
            created_at: Utc::now(),
        };

        let snapshot = {
            let mut guard = self.inner.write();
            guard.push(movie.clone());
            guard.clone()
        };

        self.persist(&snapshot).await?;

        Ok(movie)
    }

    pub async fn vote(&self, id: Uuid, voter: String) -> Result<Option<Movie>, StorageError> {
        let (movie, snapshot) = {
            let mut guard = self.inner.write();
            if let Some(movie) = guard.iter_mut().find(|item| item.id == id) {
                movie.voters.push(VoteRecord {
                    voter,
                    voted_at: Some(Utc::now()),
                });
                movie.votes = movie.votes.saturating_add(1);
                (Some(movie.clone()), Some(guard.clone()))
            } else {
                (None, None)
            }
        };

        if let Some(data) = snapshot {
            self.persist(&data).await?;
        }

        Ok(movie)
    }

    async fn persist(&self, data: &[Movie]) -> Result<(), StorageError> {
        let serialised = serde_json::to_vec_pretty(data)?;
        fs::write(&self.path, serialised).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NewMovie;
    use tokio::fs;

    fn temp_storage_path() -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("movies-local-{}.json", Uuid::new_v4()));
        path
    }

    fn sample_movie_request() -> NewMovie {
        NewMovie {
            title: "The Matrix".to_string(),
            imdb_id: "tt0133093".to_string(),
            added_by: "neo".to_string(),
            poster_url: Some("http://example.com/poster.jpg".to_string()),
            year: Some("1999".to_string()),
            media_type: Some("movie".to_string()),
            notes: Some("Follow the white rabbit.".to_string()),
            plot: Some("A hacker discovers reality is a simulation.".to_string()),
        }
    }

    #[tokio::test]
    async fn add_persists_movie() {
        let path = temp_storage_path();
        let storage = Storage::initialise(path.clone()).await.expect("init storage");

        let movie = storage
            .add(sample_movie_request())
            .await
            .expect("add movie");

        let all_movies = storage.list();
        assert_eq!(all_movies.len(), 1);
        assert_eq!(all_movies[0].title, "The Matrix");
        assert_eq!(movie.id, all_movies[0].id);

        let persisted = fs::read(&path).await.expect("read persisted file");
        assert!(!persisted.is_empty());

        let parsed: Vec<Movie> = serde_json::from_slice(&persisted).expect("parse persisted data");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].title, "The Matrix");
        assert_eq!(parsed[0].imdb_id, "tt0133093");
    }

    #[tokio::test]
    async fn vote_updates_movie_and_persists() {
        let path = temp_storage_path();
        let storage = Storage::initialise(path.clone()).await.expect("init storage");

        let movie = storage
            .add(sample_movie_request())
            .await
            .expect("add movie");

        let updated = storage
            .vote(movie.id, "trinity".to_string())
            .await
            .expect("vote movie");

        let updated = updated.expect("movie should exist");
        assert_eq!(updated.votes, 1);
        assert_eq!(updated.voters.len(), 1);
        assert_eq!(updated.voters[0].voter, "trinity");

        let persisted = fs::read(&path).await.expect("read persisted file");
        let parsed: Vec<Movie> = serde_json::from_slice(&persisted).expect("parse persisted data");
        assert_eq!(parsed[0].votes, 1);
        assert_eq!(parsed[0].voters.len(), 1);
        assert_eq!(parsed[0].voters[0].voter, "trinity");
    }
}
