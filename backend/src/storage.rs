use std::path::PathBuf;

use parking_lot::RwLock;
use tokio::fs;

use crate::models::{Movie, NewMovie};
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
            created_at: Utc::now(),
        };

        let mut guard = self.inner.write();
        guard.push(movie.clone());
        let snapshot = guard.clone();
        drop(guard);

        self.persist(&snapshot).await?;

        Ok(movie)
    }

    async fn persist(&self, data: &[Movie]) -> Result<(), StorageError> {
        let serialised = serde_json::to_vec_pretty(data)?;
        fs::write(&self.path, serialised).await?;
        Ok(())
    }
}
