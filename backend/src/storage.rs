use std::path::PathBuf;

use parking_lot::RwLock;
use tokio::fs;

use crate::models::{AppData, Household, Movie, NewMovie, Vote};
use chrono::{NaiveDate, Utc};
use thiserror::Error;
use uuid::Uuid;

pub const DAILY_VOTE_LIMIT: usize = 2;
pub const ANNE_DAILY_VOTE_LIMIT: usize = 3;
pub const BIG_VOTE_POINTS: f32 = 1.5;
pub const SMALL_VOTE_POINTS: f32 = 1.0;
pub const ANNE_BONUS_VOTE_POINTS: f32 = 0.5;

#[derive(Debug, Clone)]
pub enum VoteOutcome {
    PointsAwarded(Movie),
    LimitReached { limit: usize },
    NotFound,
}

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("data serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("not found")]
    NotFound,
}

#[derive(Debug)]
pub struct Storage {
    path: PathBuf,
    inner: RwLock<AppData>,
}

impl Storage {
    pub async fn initialise(path: PathBuf) -> Result<Self, StorageError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let app_data = if fs::try_exists(&path).await? {
            let contents = fs::read(&path).await?;
            if contents.is_empty() {
                AppData::default()
            } else {
                // Try to parse as AppData first
                match serde_json::from_slice::<AppData>(&contents) {
                    Ok(data) => data,
                    Err(_) => {
                        // Fallback: Try to parse as Vec<Movie> (legacy)
                        let movies: Vec<Movie> = serde_json::from_slice(&contents)?;
                        let default_household = Household {
                            id: Uuid::new_v4(),
                            name: "Default Household".to_string(),
                            users: Vec::new(), // Legacy data didn't have users, so start empty or maybe infer?
                            movies,
                            created_at: Utc::now(),
                        };
                        AppData {
                            households: vec![default_household],
                        }
                    }
                }
            }
        } else {
            AppData::default()
        };

        // Normalise movies in all households
        let normalised_households = app_data
            .households
            .into_iter()
            .map(|mut h| {
                h.movies = h.movies.into_iter().map(normalise_movie).collect();
                h
            })
            .collect();

        Ok(Self {
            path,
            inner: RwLock::new(AppData {
                households: normalised_households,
            }),
        })
    }

    pub fn list_households(&self) -> Vec<Household> {
        self.inner.read().households.clone()
    }

    pub async fn create_household(&self, name: String) -> Result<Household, StorageError> {
        let household = Household {
            id: Uuid::new_v4(),
            name,
            users: Vec::new(),
            movies: Vec::new(),
            created_at: Utc::now(),
        };

        let snapshot = {
            let mut guard = self.inner.write();
            guard.households.push(household.clone());
            guard.clone()
        };

        self.persist(&snapshot).await?;

        Ok(household)
    }

    pub async fn add_user(&self, household_id: Uuid, name: String) -> Result<Household, StorageError> {
        let (household, snapshot) = {
            let mut guard = self.inner.write();
            if let Some(household) = guard.households.iter_mut().find(|h| h.id == household_id) {
                if !household.users.contains(&name) {
                    household.users.push(name);
                }
                (Some(household.clone()), Some(guard.clone()))
            } else {
                (None, None)
            }
        };

        if let Some(data) = snapshot {
            self.persist(&data).await?;
        }

        household.ok_or(StorageError::NotFound)
    }

    pub async fn remove_user(&self, household_id: Uuid, name: String) -> Result<Household, StorageError> {
        let (household, snapshot) = {
            let mut guard = self.inner.write();
            if let Some(household) = guard.households.iter_mut().find(|h| h.id == household_id) {
                household.users.retain(|u| u != &name);
                (Some(household.clone()), Some(guard.clone()))
            } else {
                (None, None)
            }
        };

        if let Some(data) = snapshot {
            self.persist(&data).await?;
        }

        household.ok_or(StorageError::NotFound)
    }

    pub fn list(&self, household_id: Uuid) -> Result<Vec<Movie>, StorageError> {
        self.inner
            .read()
            .households
            .iter()
            .find(|h| h.id == household_id)
            .map(|h| h.movies.clone())
            .ok_or(StorageError::NotFound)
    }

    pub async fn add(&self, household_id: Uuid, request: NewMovie) -> Result<Movie, StorageError> {
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
            runtime_minutes: request.runtime_minutes,
            last_watched_at: None,
            points: 0.0,
            vote_history: Vec::new(),
            created_at: Utc::now(),
        };

        let snapshot = {
            let mut guard = self.inner.write();
            if let Some(household) = guard.households.iter_mut().find(|h| h.id == household_id) {
                household.movies.push(movie.clone());
                Some(guard.clone())
            } else {
                None
            }
        };

        if let Some(data) = snapshot {
            self.persist(&data).await?;
            Ok(movie)
        } else {
            Err(StorageError::NotFound)
        }
    }

    pub async fn vote(
        &self,
        household_id: Uuid,
        id: Uuid,
        voter: String,
    ) -> Result<VoteOutcome, StorageError> {
        let trimmed_voter = voter.trim().to_string();
        let normalised_voter = trimmed_voter.to_lowercase();

        let (result, snapshot) = {
            let mut guard = self.inner.write();
            if let Some(household) = guard.households.iter_mut().find(|h| h.id == household_id) {
                let today = Utc::now().date_naive();
                let votes_today = count_votes_for_day(&household.movies, &normalised_voter, today);
                let limit = vote_limit_for(&normalised_voter);

                if votes_today >= limit {
                    (VoteOutcome::LimitReached { limit }, None)
                } else if let Some(movie) = household.movies.iter_mut().find(|item| item.id == id) {
                    let points_awarded = points_for_vote(votes_today, &normalised_voter);

                    movie.vote_history.push(Vote {
                        voter: trimmed_voter.clone(),
                        voted_at: Some(Utc::now()),
                        points_awarded: Some(points_awarded),
                    });
                    recalculate_points(movie);
                    (
                        VoteOutcome::PointsAwarded(movie.clone()),
                        Some(guard.clone()),
                    )
                } else {
                    (VoteOutcome::NotFound, None)
                }
            } else {
                (VoteOutcome::NotFound, None)
            }
        };

        if let Some(data) = snapshot {
            self.persist(&data).await?;
        }

        Ok(result)
    }

    pub async fn mark_watched(
        &self,
        household_id: Uuid,
        id: Uuid,
    ) -> Result<Option<Movie>, StorageError> {
        let (movie, snapshot) = {
            let mut guard = self.inner.write();
            if let Some(household) = guard.households.iter_mut().find(|h| h.id == household_id) {
                if let Some(movie) = household.movies.iter_mut().find(|item| item.id == id) {
                    movie.last_watched_at = Some(Utc::now());
                    recalculate_points(movie);
                    (Some(movie.clone()), Some(guard.clone()))
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            }
        };

        if let Some(data) = snapshot {
            self.persist(&data).await?;
        }

        Ok(movie)
    }

    async fn persist(&self, data: &AppData) -> Result<(), StorageError> {
        let serialised = serde_json::to_vec_pretty(data)?;
        fs::write(&self.path, serialised).await?;
        Ok(())
    }
}

fn normalise_movie(mut movie: Movie) -> Movie {
    recalculate_points(&mut movie);
    movie
}

fn recalculate_points(movie: &mut Movie) {
    let cutoff = movie.last_watched_at;

    let points: f32 = movie
        .vote_history
        .iter()
        .filter(|vote| match (vote.voted_at, cutoff) {
            (_, None) => true,
            (Some(voted_at), Some(threshold)) => voted_at > threshold,
            (None, Some(_)) => false,
        })
        .map(|vote| vote.points_awarded.unwrap_or(SMALL_VOTE_POINTS))
        .sum();

    movie.points = points;
}

fn count_votes_for_day(movies: &[Movie], normalised_voter: &str, day: NaiveDate) -> usize {
    movies
        .iter()
        .flat_map(|movie| &movie.vote_history)
        .filter(|record| {
            record
                .voted_at
                .as_ref()
                .map(|timestamp| timestamp.date_naive() == day)
                .unwrap_or(false)
                && record.voter.trim().to_lowercase() == normalised_voter
        })
        .count()
}

fn is_anne(normalised_voter: &str) -> bool {
    normalised_voter == "anne"
}

fn vote_limit_for(normalised_voter: &str) -> usize {
    if is_anne(normalised_voter) {
        ANNE_DAILY_VOTE_LIMIT
    } else {
        DAILY_VOTE_LIMIT
    }
}

fn points_for_vote(votes_today: usize, normalised_voter: &str) -> f32 {
    if votes_today == 0 {
        return BIG_VOTE_POINTS;
    }

    if votes_today == 1 {
        return SMALL_VOTE_POINTS;
    }

    if is_anne(normalised_voter) && votes_today == 2 {
        return ANNE_BONUS_VOTE_POINTS;
    }

    SMALL_VOTE_POINTS
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
            runtime_minutes: Some(136),
        }
    }

    #[tokio::test]
    async fn add_persists_movie() {
        let path = temp_storage_path();
        let storage = Storage::initialise(path.clone())
            .await
            .expect("init storage");

        let household = storage
            .create_household("Test House".to_string())
            .await
            .expect("create household");

        let movie = storage
            .add(household.id, sample_movie_request())
            .await
            .expect("add movie");

        let all_movies = storage.list(household.id).expect("list movies");
        assert_eq!(all_movies.len(), 1);
        assert_eq!(all_movies[0].title, "The Matrix");
        assert_eq!(movie.id, all_movies[0].id);
        assert_eq!(movie.runtime_minutes, Some(136));
        assert_eq!(all_movies[0].runtime_minutes, Some(136));

        let persisted = fs::read(&path).await.expect("read persisted file");
        assert!(!persisted.is_empty());

        let parsed: AppData = serde_json::from_slice(&persisted).expect("parse persisted data");
        assert_eq!(parsed.households.len(), 1);
        let saved_movie = &parsed.households[0].movies[0];
        assert_eq!(saved_movie.title, "The Matrix");
        assert_eq!(saved_movie.imdb_id, "tt0133093");
        assert_eq!(saved_movie.runtime_minutes, Some(136));
    }

    #[tokio::test]
    async fn vote_updates_movie_and_persists() {
        let path = temp_storage_path();
        let storage = Storage::initialise(path.clone())
            .await
            .expect("init storage");

        let household = storage
            .create_household("Test House".to_string())
            .await
            .expect("create household");

        let movie = storage
            .add(household.id, sample_movie_request())
            .await
            .expect("add movie");

        let result = storage
            .vote(household.id, movie.id, "trinity".to_string())
            .await
            .expect("vote movie");

        let updated = match result {
            VoteOutcome::PointsAwarded(movie) => movie,
            other => panic!("expected updated movie, got {:?}", other),
        };
        assert_eq!(updated.points, BIG_VOTE_POINTS);
        assert_eq!(updated.vote_history.len(), 1);
        assert_eq!(updated.vote_history[0].voter, "trinity");
        assert_eq!(
            updated.vote_history[0].points_awarded,
            Some(BIG_VOTE_POINTS)
        );
        assert_eq!(updated.runtime_minutes, Some(136));

        let persisted = fs::read(&path).await.expect("read persisted file");
        let persisted = fs::read(&path).await.expect("read persisted file");
        let parsed: AppData = serde_json::from_slice(&persisted).expect("parse persisted data");
        let saved_movie = &parsed.households[0].movies[0];
        assert_eq!(saved_movie.points, BIG_VOTE_POINTS);
        assert_eq!(saved_movie.vote_history.len(), 1);
        assert_eq!(saved_movie.vote_history[0].voter, "trinity");
        assert_eq!(
            saved_movie.vote_history[0].points_awarded,
            Some(BIG_VOTE_POINTS)
        );
        assert_eq!(saved_movie.runtime_minutes, Some(136));
    }

    #[tokio::test]
    async fn vote_enforces_daily_limit() {
        let path = temp_storage_path();
        let storage = Storage::initialise(path).await.expect("init storage");

        let household = storage
            .create_household("Test House".to_string())
            .await
            .expect("create household");

        let primary = storage
            .add(household.id, sample_movie_request())
            .await
            .expect("add movie");

        let mut sequel_request = sample_movie_request();
        sequel_request.title = "The Matrix Reloaded".to_string();
        sequel_request.imdb_id = "tt0234215".to_string();
        let sequel = storage
            .add(household.id, sequel_request)
            .await
            .expect("add sequel");

        let first = storage
            .vote(household.id, primary.id, "Trinity".to_string())
            .await
            .expect("first vote");
        assert!(matches!(first, VoteOutcome::PointsAwarded(_)));

        let second = storage
            .vote(household.id, sequel.id, "Trinity".to_string())
            .await
            .expect("second vote");
        assert!(matches!(second, VoteOutcome::PointsAwarded(_)));

        let third = storage
            .vote(household.id, primary.id, "Trinity".to_string())
            .await
            .expect("third vote");
        match third {
            VoteOutcome::LimitReached { limit } => assert_eq!(limit, DAILY_VOTE_LIMIT),
            other => panic!("expected limit reached, got {:?}", other),
        }

        let movies = storage.list(household.id).expect("list movies");
        let primary_entry = movies
            .iter()
            .find(|m| m.id == primary.id)
            .expect("primary exists");
        let sequel_entry = movies
            .iter()
            .find(|m| m.id == sequel.id)
            .expect("sequel exists");

        assert_eq!(primary_entry.points, BIG_VOTE_POINTS);
        assert_eq!(
            primary_entry
                .vote_history
                .first()
                .and_then(|vote| vote.points_awarded),
            Some(BIG_VOTE_POINTS)
        );
        assert_eq!(primary_entry.runtime_minutes, Some(136));

        assert_eq!(sequel_entry.points, SMALL_VOTE_POINTS);
        assert_eq!(
            sequel_entry
                .vote_history
                .first()
                .and_then(|vote| vote.points_awarded),
            Some(SMALL_VOTE_POINTS)
        );
        assert_eq!(sequel_entry.runtime_minutes, Some(136));
    }

    #[tokio::test]
    async fn anne_receives_extra_vote() {
        let path = temp_storage_path();
        let storage = Storage::initialise(path).await.expect("init storage");

        let household = storage
            .create_household("Test House".to_string())
            .await
            .expect("create household");

        let primary = storage
            .add(household.id, sample_movie_request())
            .await
            .expect("add movie");

        let mut sequel_request = sample_movie_request();
        sequel_request.title = "The Matrix Reloaded".to_string();
        sequel_request.imdb_id = "tt0234215".to_string();
        let sequel = storage
            .add(household.id, sequel_request)
            .await
            .expect("add sequel");

        let first = storage
            .vote(household.id, primary.id, "Anne".to_string())
            .await
            .expect("first vote");
        assert!(matches!(first, VoteOutcome::PointsAwarded(_)));

        let second = storage
            .vote(household.id, sequel.id, "Anne".to_string())
            .await
            .expect("second vote");
        assert!(matches!(second, VoteOutcome::PointsAwarded(_)));

        let third = storage
            .vote(household.id, primary.id, "Anne".to_string())
            .await
            .expect("third vote");

        let primary_after_third = match third {
            VoteOutcome::PointsAwarded(movie) => movie,
            other => panic!("expected updated movie, got {:?}", other),
        };

        assert_eq!(
            primary_after_third.points,
            BIG_VOTE_POINTS + ANNE_BONUS_VOTE_POINTS
        );
        assert_eq!(primary_after_third.vote_history.len(), 2);
        assert_eq!(
            primary_after_third
                .vote_history
                .last()
                .and_then(|vote| vote.points_awarded),
            Some(ANNE_BONUS_VOTE_POINTS)
        );

        let fourth = storage
            .vote(household.id, sequel.id, "Anne".to_string())
            .await
            .expect("fourth vote");

        match fourth {
            VoteOutcome::LimitReached { limit } => assert_eq!(limit, ANNE_DAILY_VOTE_LIMIT),
            other => panic!("expected limit reached, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn mark_watched_resets_points_but_preserves_history() {
        let path = temp_storage_path();
        let storage = Storage::initialise(path.clone())
            .await
            .expect("init storage");

        let household = storage
            .create_household("Test House".to_string())
            .await
            .expect("create household");

        let movie = storage
            .add(household.id, sample_movie_request())
            .await
            .expect("add movie");

        // Cast an initial vote
        storage
            .vote(household.id, movie.id, "neo".to_string())
            .await
            .expect("first vote");

        // Mark as watched
        let watched = storage
            .mark_watched(household.id, movie.id)
            .await
            .expect("mark watched")
            .expect("movie exists");

        assert!(watched.last_watched_at.is_some());
        assert_eq!(watched.points, 0.0);
        assert_eq!(watched.vote_history.len(), 1);

        let persisted = fs::read(&path).await.expect("read persisted file");
        let persisted = fs::read(&path).await.expect("read persisted file");
        let parsed: AppData = serde_json::from_slice(&persisted).expect("parse data");
        let saved_movie = &parsed.households[0].movies[0];
        assert_eq!(saved_movie.points, 0.0);
        assert!(saved_movie.last_watched_at.is_some());
        assert_eq!(saved_movie.vote_history.len(), 1);

        // Votes after watch are counted again
        let follow_up = storage
            .vote(household.id, movie.id, "trinity".to_string())
            .await
            .expect("second vote");

        let follow_up = match follow_up {
            VoteOutcome::PointsAwarded(movie) => movie,
            other => panic!("unexpected outcome: {:?}", other),
        };

        assert_eq!(follow_up.points, BIG_VOTE_POINTS);
        assert!(follow_up.last_watched_at.is_some());
        assert_eq!(follow_up.vote_history.len(), 2);
    }
}
