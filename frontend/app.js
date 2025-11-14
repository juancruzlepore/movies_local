const API_STORAGE_KEY = 'movies-local-api-base';
const API_BASE = resolveApiBase();
const DAILY_VOTE_LIMIT = 2;
const BIG_VOTE_POINTS = 1.5;
const ANNE_VOTE_POINTS = 0.5;

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
const moviesListByPoints = document.querySelector('#movies-list-by-points');
const moviesListByRecent = document.querySelector('#movies-list-by-recent');
const refreshMoviesButton = document.querySelector('#refresh-movies');
const dailyVoteCounter = document.querySelector('#daily-vote-count');

const resultTemplate = document.querySelector('#result-item-template');
const movieTemplate = document.querySelector('#movie-item-template');

const STORAGE_KEY = 'movies-local-display-name';

let latestMovies = [];

function resolveApiBase() {
  const candidate =
    window.API_BASE_URL ||
    getStoredApiBase() ||
    getUrlOverride() ||
    inferFromLocation() ||
    'http://localhost:8080';

  console.info('[movies-local] API base:', candidate);
  return candidate.replace(/\/+$/, '');
}

function getStoredApiBase() {
  try {
    return localStorage.getItem(API_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredApiBase(value) {
  try {
    if (value) {
      localStorage.setItem(API_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(API_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors (private browsing, etc)
  }
}

function getUrlOverride() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const override = searchParams.get('api') || hashParams.get('api');
  if (!override) return null;
  setStoredApiBase(override);
  return override;
}

function inferFromLocation() {
  const { protocol, hostname } = window.location;

  if (!hostname || hostname === '0.0.0.0') {
    return null;
  }

  const url = new URL('http://placeholder');
  url.protocol = protocol === 'https:' ? 'https:' : 'http:';
  url.hostname = hostname;
  url.port = '8080';
  return url.origin;
}

window.moviesLocal = window.moviesLocal || {};
window.moviesLocal.setApiBase = function setApiBase(nextBase) {
  if (!nextBase) return;
  try {
    const url = new URL(nextBase);
    setStoredApiBase(url.origin);
  } catch {
    console.warn('[movies-local] Invalid API base provided:', nextBase);
    return;
  }
  window.location.reload();
};

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
  const moviesByPoints = [...movies].sort((a, b) => {
    const pointsDiff = (getPoints(b) - getPoints(a));
    if (pointsDiff !== 0) return pointsDiff;
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

  renderMovieList(moviesListByPoints, moviesByPoints);
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
  const runtime = formatRuntime(movie.runtime_minutes);
  if (runtime) metaParts.push(runtime);
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

  const watchedLabel = element.querySelector('.movie-watched');
  const lastWatched = formatLastWatched(movie.last_watched_at);
  if (lastWatched) {
    watchedLabel.textContent = lastWatched;
    watchedLabel.hidden = false;
  } else {
    watchedLabel.textContent = '';
    watchedLabel.hidden = true;
  }

  const voteButton = element.querySelector('.vote-button');
  const pointsLabel = element.querySelector('.movie-points');
  const pointsIndicator = element.querySelector('.points-indicator');
  updatePointsDisplay(pointsLabel, pointsIndicator, getPoints(movie));

  const voter = displayNameInput.value.trim();
  const votesToday = voter ? countVotesForToday(latestMovies, voter) : 0;
  const { label, disabled, tooltip } = describeNextVote(votesToday);
  voteButton.textContent = label;
  voteButton.disabled = disabled;
  voteButton.title = tooltip;

  voteButton.addEventListener('click', () =>
    voteForMovie(movie.id, voteButton, pointsLabel, pointsIndicator),
  );

  const watchedButton = element.querySelector('.watched-button');
  if (watchedButton) {
    watchedButton.addEventListener('click', () =>
      markMovieWatched(movie.id, watchedButton),
    );
  }

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

  const existingIds = new Set(
    (latestMovies || [])
      .map((movie) => (movie?.imdb_id || '').toLowerCase())
      .filter(Boolean),
  );

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
    const imdbId = (result?.imdb_id || '').toLowerCase();
    const alreadyAdded = imdbId && existingIds.has(imdbId);

    if (alreadyAdded) {
      addButton.textContent = 'Added';
      addButton.disabled = true;
      addButton.setAttribute('aria-disabled', 'true');
    } else {
      addButton.textContent = 'Add';
      addButton.disabled = false;
      addButton.removeAttribute('aria-disabled');
      addButton.addEventListener('click', () => addMovie(result, addButton));
    }

    fragment.appendChild(element);
  }

  searchResultsList.appendChild(fragment);
}

async function addMovie(result, button) {
  const addedBy = requireDisplayName('Save your name before adding a movie.');
  if (!addedBy) {
    if (button) {
      button.disabled = false;
      button.textContent = 'Add';
      button.removeAttribute('aria-disabled');
    }
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Adding…';
    button.setAttribute('aria-disabled', 'true');
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
    if (button) {
      button.textContent = 'Added';
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    }
    await fetchMovies({ showLoading: false });
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Unable to add the movie.');
    if (button) {
      button.disabled = false;
      button.textContent = 'Add';
      button.removeAttribute('aria-disabled');
    }
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

function getPoints(movie = {}) {
  if (!movie || typeof movie !== 'object') return 0;
  if (typeof movie.points === 'number') return movie.points;
  if (typeof movie.votes === 'number') return movie.votes;
  return 0;
}

function getVoteHistory(movie = {}) {
  if (!movie || typeof movie !== 'object') return [];
  if (Array.isArray(movie.vote_history)) return movie.vote_history;
  if (Array.isArray(movie.voters)) return movie.voters;
  return [];
}

function formatPoints(points = 0) {
  const numeric = normalisePoints(points);
  const unit = Math.abs(numeric) === 1 ? 'point' : 'points';
  return `${formatPointsValue(numeric)} ${unit}`;
}

function formatPointsValue(points = 0) {
  const numeric = normalisePoints(points);
  if (Number.isInteger(numeric)) {
    return String(numeric);
  }
  return numeric.toFixed(1).replace(/\.0$/, '');
}

function normalisePoints(points = 0) {
  const numeric = Number(points);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.round(numeric * 2) / 2;
}

function updatePointsDisplay(pointsLabel, pointsIndicator, points) {
  const numeric = normalisePoints(points);
  if (pointsLabel) {
    pointsLabel.textContent = formatPoints(numeric);
  }
  renderPointsIndicator(pointsIndicator, numeric);
}

function renderPointsIndicator(container, points = 0) {
  if (!container) return;

  const numeric = normalisePoints(points);
  const halfSteps = Math.round(numeric * 2);
  container.innerHTML = '';
  if (halfSteps <= 0) return;

  const fragment = document.createDocumentFragment();
  const fullCircles = Math.floor(halfSteps / 2);
  const hasHalf = halfSteps % 2 === 1;

  for (let index = 0; index < fullCircles; index += 1) {
    fragment.append(createPointCircle('point-circle point-circle--full'));
  }

  if (hasHalf) {
    fragment.append(createPointCircle('point-circle point-circle--half'));
  }

  container.append(fragment);
}

function createPointCircle(className) {
  const circle = document.createElement('span');
  circle.className = className;
  circle.setAttribute('aria-hidden', 'true');
  return circle;
}

function formatRuntime(value) {
  if (value == null) return '';
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours > 0 && remaining > 0) return `${hours}h ${remaining}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatLastWatched(value) {
  if (!value) return '';
  const formatted = formatTimestamp(value);
  return formatted ? `Last watched: ${formatted}` : '';
}

function updateDailyVoteCount(movies = []) {
  if (!dailyVoteCounter) return;

  const voter = displayNameInput.value.trim();
  if (!voter) {
    dailyVoteCounter.textContent = 'Save your name to track your votes today.';
    return;
  }

  const votesToday = countVotesForToday(movies, voter);
  const remaining = Math.max(DAILY_VOTE_LIMIT - votesToday, 0);
  const baseMessage = `You have used ${votesToday} of ${DAILY_VOTE_LIMIT} votes today.`;
  dailyVoteCounter.textContent =
    votesToday >= DAILY_VOTE_LIMIT && remaining === 0
      ? `${baseMessage} Limit reached.`
      : baseMessage;
}

function countVotesForToday(movies = [], voter) {
  const normalisedVoter = voter.trim().toLowerCase();
  if (!normalisedVoter) return 0;

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const date = today.getDate();

  return movies.reduce((total, movie) => {
    const history = getVoteHistory(movie);
    if (!Array.isArray(history) || !history.length) return total;

    const votes = history.filter((record) => {
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

async function voteForMovie(movieId, button, pointsLabel, pointsIndicator) {
  if (!movieId) return;

  const voter = requireDisplayName('Save your name before voting.');
  if (!voter) {
    button.disabled = false;
    button.title = '';
    return;
  }

  const votesToday = countVotesForToday(latestMovies, voter);
  if (votesToday >= DAILY_VOTE_LIMIT) {
    setFeedback(`You have used your ${DAILY_VOTE_LIMIT} votes for today.`);
    updateDailyVoteCount(latestMovies);
    const { label, tooltip } = describeNextVote(votesToday);
    button.disabled = true;
    button.textContent = label;
    button.title = tooltip;
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
    const points = getPoints(updated);
    updatePointsDisplay(pointsLabel, pointsIndicator, points);
    setFeedback('Thanks for voting!');
    await fetchMovies({ showLoading: false });
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Unable to register your vote.');
  } finally {
    const updatedVotesToday = countVotesForToday(latestMovies, voter);
    const { label, disabled, tooltip } = describeNextVote(updatedVotesToday);
    button.disabled = disabled;
    button.textContent = label;
    button.title = tooltip;
  }
}

async function markMovieWatched(movieId, button) {
  if (!movieId || !button) return;

  button.disabled = true;
  button.textContent = 'Updating…';
  button.title = '';
  button.setAttribute('aria-disabled', 'true');
  setFeedback('Resetting points…');

  try {
    const response = await fetch(`${API_BASE}/movies/${movieId}/watch`, {
      method: 'POST',
    });

    if (!response.ok) {
      const problem = await safeJson(response);
      throw new Error(problem?.message || `Watch failed with ${response.status}`);
    }

    setFeedback('Marked as watched!');
    await fetchMovies({ showLoading: false });
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Unable to mark as watched.');
    button.disabled = false;
    button.textContent = 'Watched';
    button.removeAttribute('aria-disabled');
  }
}

function describeNextVote(votesToday) {
  if (votesToday <= 0) {
    return {
      label: `Big vote (+${formatPoints(BIG_VOTE_POINTS)})`,
      disabled: false,
      tooltip: '',
    };
  }

  if (votesToday === 1) {
    return {
      label: `Anne vote (+${formatPoints(ANNE_VOTE_POINTS)})`,
      disabled: false,
      tooltip: '',
    };
  }

  return {
    label: 'No votes left today',
    disabled: true,
    tooltip: `Daily limit reached (${DAILY_VOTE_LIMIT} votes)`,
  };
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
