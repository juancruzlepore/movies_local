const API_BASE = window.API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8080`;

const displayNameInput = document.querySelector('#display-name');
const displayNameForm = document.querySelector('#display-name-form');
const landingScreen = document.querySelector('#landing-screen');
const changeNameButton = document.querySelector('#change-name');
const appMain = document.querySelector('.app-main');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-query');
const searchTypeSelect = document.querySelector('#search-type');
const searchResultsList = document.querySelector('#search-results');
const searchFeedback = document.querySelector('#search-feedback');
const moviesListByVotes = document.querySelector('#movies-list-by-votes');
const moviesListByRecent = document.querySelector('#movies-list-by-recent');
const refreshMoviesButton = document.querySelector('#refresh-movies');
const dailyVoteCounter = document.querySelector('#daily-vote-count');

const resultTemplate = document.querySelector('#result-item-template');
const movieTemplate = document.querySelector('#movie-item-template');

const STORAGE_KEY = 'movies-local-display-name';

let latestMovies = [];

function getDisplayName() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

function setDisplayName(name) {
  localStorage.setItem(STORAGE_KEY, name);
}

function hydrateDisplayName() {
  const savedName = getDisplayName();
  if (savedName) {
    displayNameInput.value = savedName;
  }
}

function showLanding(options = {}) {
  const { focusInput = true, selectInput = false, prefill = true } = options;

  if (prefill && displayNameInput) {
    const savedName = getDisplayName();
    if (savedName && savedName !== displayNameInput.value) {
      displayNameInput.value = savedName;
    }
  }

  if (landingScreen) {
    landingScreen.hidden = false;
    landingScreen.setAttribute('aria-hidden', 'false');
  }

  if (appMain) {
    appMain.hidden = true;
  }

  if (changeNameButton) {
    changeNameButton.hidden = true;
  }

  if (document.body) {
    document.body.classList.add('showing-landing');
  }

  if (displayNameInput && focusInput) {
    requestAnimationFrame(() => {
      displayNameInput.focus();
      if (selectInput) {
        displayNameInput.select();
      }
    });
  }
}

function hideLanding() {
  if (landingScreen) {
    landingScreen.hidden = true;
    landingScreen.setAttribute('aria-hidden', 'true');
  }

  if (appMain) {
    appMain.hidden = false;
  }

  if (changeNameButton) {
    changeNameButton.hidden = false;
  }

  if (document.body) {
    document.body.classList.remove('showing-landing');
  }
}

function requireDisplayName(message) {
  const name = displayNameInput.value.trim();
  if (name) return name;

  if (message) {
    setFeedback(message);
  }

  showLanding({ focusInput: true });
  return null;
}

function completeNameSetup({ message } = {}) {
  hideLanding();
  if (message) {
    setFeedback(message);
  }
  updateDailyVoteCount(latestMovies);
}

async function fetchMovies(options = {}) {
  const { showLoading = true } = options;

  if (showLoading) {
    setFeedback('Loading shared list…');
  }

  try {
    const response = await fetch(`${API_BASE}/movies`);
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    const data = await response.json();
    latestMovies = Array.isArray(data) ? data : [];
    renderMovies(latestMovies);
    updateDailyVoteCount(latestMovies);
    if (showLoading) {
      setFeedback('');
    }
  } catch (error) {
    console.error(error);
    setFeedback('Unable to load shared list. Check the server.');
    if (dailyVoteCounter) {
      dailyVoteCounter.textContent = 'Unable to load vote history right now.';
    }
  }
}

function renderMovies(movies) {
  const moviesByVotes = [...movies].sort((a, b) => {
    const voteDiff = (b.votes ?? 0) - (a.votes ?? 0);
    if (voteDiff !== 0) return voteDiff;
    const titleA = a.title ?? '';
    const titleB = b.title ?? '';
    return titleA.localeCompare(titleB);
  });

  const moviesByRecent = [...movies].sort((a, b) => {
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (timeA === timeB) {
      const titleA = a.title ?? '';
      const titleB = b.title ?? '';
      return titleA.localeCompare(titleB);
    }
    return timeB - timeA;
  });

  renderMovieList(moviesListByVotes, moviesByVotes);
  renderMovieList(moviesListByRecent, moviesByRecent);
}

function renderMovieList(container, movies) {
  container.innerHTML = '';

  if (!movies.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Nothing here yet. Find something great to watch!';
    empty.className = 'movie-empty';
    container.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const movie of movies) {
    fragment.append(buildMovieElement(movie));
  }

  container.append(fragment);
}

function buildMovieElement(movie) {
  const element = movieTemplate.content.cloneNode(true);
  const movieCard = element.querySelector('.movie-card');
  if (movieCard && movie.id) {
    movieCard.dataset.movieId = movie.id;
  }

  element.querySelector('.movie-title').textContent = movie.title;

  const metaParts = [];
  if (movie.year) metaParts.push(movie.year);
  if (movie.media_type) metaParts.push(capitalise(movie.media_type));
  element.querySelector('.movie-meta').textContent = metaParts.join(' • ');

  const posterContainer = element.querySelector('.movie-poster');
  const posterUrl = normalisePoster(movie.poster_url);
  if (posterUrl) {
    posterContainer.innerHTML = '';
    const img = document.createElement('img');
    img.src = posterUrl;
    img.alt = `${movie.title} Poster`;
    img.loading = 'lazy';
    img.decoding = 'async';
    posterContainer.appendChild(img);
    posterContainer.removeAttribute('aria-hidden');
  } else {
    posterContainer.textContent = 'No poster yet';
    posterContainer.setAttribute('aria-hidden', 'true');
  }

  const added = movie.added_by ? `${movie.added_by}` : 'Unknown friend';
  const timestamp = movie.created_at ? formatTimestamp(movie.created_at) : '';
  element.querySelector('.movie-added').textContent = `${added}${timestamp ? ` • ${timestamp}` : ''}`;

  const voteButton = element.querySelector('.vote-button');
  const votesLabel = element.querySelector('.movie-votes');
  votesLabel.textContent = formatVotes(movie.votes ?? 0);
  voteButton.addEventListener('click', () =>
    voteForMovie(movie.id, voteButton, votesLabel),
  );

  return element;
}

async function searchMovies(query, mediaType) {
  setFeedback('Searching…');
  try {
    const params = new URLSearchParams({ query });
    if (mediaType) params.set('media_type', mediaType);

    const response = await fetch(`${API_BASE}/search?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Search failed with ${response.status}`);
    }

    const payload = await response.json();
    renderSearchResults(payload.results || []);
    if (payload.results && !payload.results.length) {
      setFeedback('No matches found. Try a different title.');
    } else {
      setFeedback('');
    }
  } catch (error) {
    console.error(error);
    setFeedback('Search failed. Make sure the backend can reach OMDb.');
  }
}

function renderSearchResults(results) {
  searchResultsList.innerHTML = '';

  const fragment = document.createDocumentFragment();
  for (const result of results) {
    const element = resultTemplate.content.cloneNode(true);
    element.querySelector('.result-title').textContent = result.title;
    element.querySelector('.result-year').textContent = buildResultSubtitle(result);

    const posterContainer = element.querySelector('.result-poster');
    const posterUrl = normalisePoster(result.poster_url);
    if (posterUrl) {
      const img = document.createElement('img');
      img.src = posterUrl;
      img.alt = `${result.title} Poster`;
      posterContainer.appendChild(img);
    }

    const addButton = element.querySelector('.add-button');
    addButton.addEventListener('click', () => addMovie(result));

    fragment.appendChild(element);
  }

  searchResultsList.appendChild(fragment);
}

async function addMovie(result) {
  const addedBy = requireDisplayName('Save your name before adding a movie.');
  if (!addedBy) {
    return;
  }

  const payload = {
    title: result.title,
    imdb_id: result.imdb_id,
    added_by: addedBy,
    poster_url: normalisePoster(result.poster_url),
    year: result.year,
    media_type: result.media_type,
  };

  try {
    const response = await fetch(`${API_BASE}/movies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const problem = await safeJson(response);
      throw new Error(problem?.message || `Add failed with ${response.status}`);
    }

    setFeedback('Added to the list!');
    await fetchMovies({ showLoading: false });
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Unable to add the movie.');
  }
}

function buildResultSubtitle(result) {
  const pieces = [];
  if (result.year) pieces.push(result.year);
  if (result.media_type) pieces.push(capitalise(result.media_type));
  return pieces.join(' • ');
}

function normalisePoster(value) {
  if (!value || value === 'N/A') return null;
  return value;
}

function capitalise(value = '') {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatVotes(votes = 0) {
  return votes === 1 ? '1 vote' : `${votes} votes`;
}

function updateDailyVoteCount(movies = []) {
  if (!dailyVoteCounter) return;

  const voter = displayNameInput.value.trim();
  if (!voter) {
    dailyVoteCounter.textContent = 'Save your name to track your votes today.';
    return;
  }

  const votesToday = countVotesForToday(movies, voter);
  const voteText = votesToday === 1 ? '1 vote' : `${votesToday} votes`;
  dailyVoteCounter.textContent = `You have cast ${voteText} today.`;
}

function countVotesForToday(movies = [], voter) {
  const normalisedVoter = voter.trim().toLowerCase();
  if (!normalisedVoter) return 0;

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const date = today.getDate();

  return movies.reduce((total, movie) => {
    if (!movie || !Array.isArray(movie.voters)) return total;

    const votes = movie.voters.filter((record) => {
      if (!record || typeof record.voter !== 'string') return false;
      if (record.voter.trim().toLowerCase() !== normalisedVoter) return false;
      if (!record.voted_at) return false;

      const votedAt = new Date(record.voted_at);
      if (Number.isNaN(votedAt.getTime())) return false;

      return (
        votedAt.getFullYear() === year &&
        votedAt.getMonth() === month &&
        votedAt.getDate() === date
      );
    }).length;

    return total + votes;
  }, 0);
}

async function voteForMovie(movieId, button, votesLabel) {
  if (!movieId) return;

  const voter = requireDisplayName('Save your name before voting.');
  if (!voter) {
    return;
  }

  button.disabled = true;
  setFeedback('Recording your vote…');

  try {
    const response = await fetch(`${API_BASE}/movies/${movieId}/votes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ voter }),
    });

    if (!response.ok) {
      const problem = await safeJson(response);
      throw new Error(problem?.message || `Vote failed with ${response.status}`);
    }

    const updated = await response.json();
    const votes = updated.votes ?? 0;
    votesLabel.textContent = formatVotes(votes);
    setFeedback('Thanks for voting!');
    await fetchMovies({ showLoading: false });
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Unable to register your vote.');
  } finally {
    button.disabled = false;
  }
}

function setFeedback(text) {
  searchFeedback.textContent = text;
}

function formatTimestamp(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch (error) {
    console.error('Failed to format date', error);
    return '';
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

if (displayNameForm) {
  displayNameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!displayNameForm.reportValidity()) return;

    const name = displayNameInput.value.trim();
    if (!name) {
      displayNameInput.focus();
      return;
    }

    setDisplayName(name);
    completeNameSetup({ message: 'Name saved!' });
  });
}

displayNameInput.addEventListener('input', () => {
  updateDailyVoteCount(latestMovies);
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) {
    setFeedback('Type something to search.');
    return;
  }
  const type = searchTypeSelect.value;
  searchMovies(query, type);
});

refreshMoviesButton.addEventListener('click', () => {
  fetchMovies();
});

hydrateDisplayName();

if (displayNameInput.value.trim()) {
  completeNameSetup({ message: 'Ready when you are!' });
} else {
  showLanding({ focusInput: false });
  setFeedback('Enter your name to get started.');
  if (displayNameInput) {
    requestAnimationFrame(() => displayNameInput.focus());
  }
}

fetchMovies();
updateDailyVoteCount(latestMovies);

if (changeNameButton) {
  changeNameButton.addEventListener('click', () => {
    showLanding({ selectInput: true });
  });
}
