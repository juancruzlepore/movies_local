const API_STORAGE_KEY = 'movies-local-api-base';
const API_BASE = resolveApiBase();
const DEFAULT_DAILY_VOTE_LIMIT = 2;
const ANNE_DAILY_VOTE_LIMIT = 3;
const ANNE_NAME = 'anne';
const BIG_VOTE_POINTS = 1.5;
const SMALL_VOTE_POINTS = 1;
const ANNE_BONUS_VOTE_POINTS = 0.5;

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
const moviesFilterInput = document.querySelector('#movies-filter');
const dailyVoteCounter = document.querySelector('#daily-vote-count');
const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

const resultTemplate = document.querySelector('#result-item-template');
const movieTemplate = document.querySelector('#movie-item-template');

const STORAGE_KEY = 'movies-local-display-name';

let latestMovies = [];
let activeMovieFilter = '';

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

function updateChangeNameButtonLabel(name) {
  if (!changeNameButton) return;
  const displayName =
    (typeof name === 'string' && name.trim()) ||
    (displayNameInput && displayNameInput.value.trim()) ||
    getDisplayName();

  if (!displayName) return;
  changeNameButton.textContent = displayName;
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

function renderMovies(movies = []) {
  const filter = activeMovieFilter;
  const filteredMovies = !filter ? movies : movies.filter((movie) => movieMatchesFilter(movie, filter));

  const moviesByPoints = [...filteredMovies].sort((a, b) => {
    const pointsDiff = (getPoints(b) - getPoints(a));
    if (pointsDiff !== 0) return pointsDiff;
    const titleA = a.title ?? '';
    const titleB = b.title ?? '';
    return titleA.localeCompare(titleB);
  });

  const moviesByRecent = [...filteredMovies].sort((a, b) => {
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (timeA === timeB) {
      const titleA = a.title ?? '';
      const titleB = b.title ?? '';
      return titleA.localeCompare(titleB);
    }
    return timeB - timeA;
  });

  const filtered = Boolean(filter);
  renderMovieList(moviesListByPoints, moviesByPoints, { filtered });
  renderMovieList(moviesListByRecent, moviesByRecent, { filtered });
}

function normaliseFilterValue(value = '') {
  return (value || '').toString().trim().toLowerCase();
}

function movieMatchesFilter(movie, filter) {
  const query = normaliseFilterValue(filter);
  if (!query) return true;

  const fields = [
    movie && movie.title,
    movie && movie.year,
    movie && movie.media_type,
    movie && movie.added_by,
  ];

  return fields.some((field) => {
    if (field == null) return false;
    return String(field).toLowerCase().includes(query);
  });
}

function renderMovieList(container, movies, options = {}) {
  const { filtered = false } = options;

  container.innerHTML = '';

  if (!movies.length) {
    const empty = document.createElement('p');
    empty.textContent = filtered
      ? 'No matches found. Try a different filter.'
      : 'Nothing here yet. Find something great to watch!';
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

function activateTab(panelId) {
  if (!panelId) return false;

  const targetPanel = tabPanels.find((panel) => panel.id === panelId);
  if (!targetPanel) return false;

  tabButtons.forEach((button) => {
    const controls = button.getAttribute('aria-controls');
    const isActive = controls === panelId;
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.tabIndex = isActive ? 0 : -1;
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.id === panelId;
    panel.hidden = !isActive;
    panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
  });

  return true;
}

function focusTabAtIndex(index) {
  if (!tabButtons.length) return;
  const total = tabButtons.length;
  const targetIndex = ((index % total) + total) % total;
  const button = tabButtons[targetIndex];
  if (button) {
    button.focus();
  }
}

function setupTabs() {
  if (!tabButtons.length || !tabPanels.length) return;

  if (!activateTab('shared-list-panel')) {
    const fallbackPanel = tabPanels[0];
    if (fallbackPanel) {
      activateTab(fallbackPanel.id);
    }
  }

  tabButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      const targetPanelId = button.getAttribute('aria-controls');
      activateTab(targetPanelId);
    });

    button.addEventListener('keydown', (event) => {
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault();
          focusTabAtIndex(index + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          focusTabAtIndex(index - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusTabAtIndex(0);
          break;
        case 'End':
          event.preventDefault();
          focusTabAtIndex(tabButtons.length - 1);
          break;
        default:
          break;
      }
    });
  });
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
    posterContainer.classList.remove('movie-poster--placeholder');
  } else {
    posterContainer.textContent = 'No poster yet';
    posterContainer.setAttribute('aria-hidden', 'true');
    posterContainer.classList.add('movie-poster--placeholder');
  }

  const voteButton = element.querySelector('.vote-button');
  const pointsLabel = element.querySelector('.movie-points');
  renderPoints(pointsLabel, getPoints(movie));

  const voter = displayNameInput.value.trim();
  const votesToday = voter ? countVotesForToday(latestMovies, voter) : 0;
  const { label, disabled, tooltip, variant } = describeNextVote(votesToday, voter);
  voteButton.textContent = label;
  voteButton.disabled = disabled;
  voteButton.title = tooltip;
  applyVoteButtonVariant(voteButton, variant);

  voteButton.addEventListener('click', () =>
    voteForMovie(movie.id, voteButton, pointsLabel),
  );

  const markWatchedButton = element.querySelector('.mark-watched');
  if (markWatchedButton) {
    const watchedToday = isWatchedToday(movie.last_watched_at);
    if (watchedToday) {
      markWatchedButton.textContent = 'Watched ✓';
      markWatchedButton.disabled = true;
      markWatchedButton.setAttribute('aria-disabled', 'true');
      markWatchedButton.title = 'Already logged for today';
    } else {
      markWatchedButton.textContent = 'Mark as watched';
      markWatchedButton.disabled = false;
      markWatchedButton.removeAttribute('aria-disabled');
      markWatchedButton.title = 'Reset points and log a rewatch';
      markWatchedButton.addEventListener('click', () =>
        markMovieWatched(movie.id, markWatchedButton),
      );
    }
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

function updateDailyVoteCount(movies = []) {
  if (!dailyVoteCounter) return;

  const voter = displayNameInput.value.trim();
  if (!voter) {
    dailyVoteCounter.textContent = 'Save your name to track your votes today.';
    return;
  }

  const votesToday = countVotesForToday(movies, voter);
  const limit = getDailyVoteLimit(voter);
  const remaining = Math.max(limit - votesToday, 0);
  const baseMessage = `You have used ${votesToday} of ${limit} votes today.`;
  dailyVoteCounter.textContent =
    votesToday >= limit && remaining === 0
      ? `${baseMessage} Limit reached.`
      : baseMessage;
}

function isWatchedToday(value) {
  if (!value) return false;
  const watchedDate = new Date(value);
  if (Number.isNaN(watchedDate.getTime())) return false;

  const today = new Date();
  return (
    watchedDate.getFullYear() === today.getFullYear() &&
    watchedDate.getMonth() === today.getMonth() &&
    watchedDate.getDate() === today.getDate()
  );
}

function countVotesForToday(movies = [], voter) {
  const normalisedVoter = normaliseName(voter);
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

function formatPointAmount(value) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const rounded = Math.round(safeValue * 10) / 10;
  const formatted = Number.isInteger(rounded)
    ? rounded.toString()
    : rounded.toFixed(1).replace(/\.0$/, '');
  const plural = Math.abs(rounded - 1) < Number.EPSILON ? '' : 's';
  return `${formatted} point${plural}`;
}

function normaliseName(name = '') {
  return (name || '').trim().toLowerCase();
}

function isAnneName(name = '') {
  return normaliseName(name) === ANNE_NAME;
}

function getDailyVoteLimit(name = '') {
  return isAnneName(name) ? ANNE_DAILY_VOTE_LIMIT : DEFAULT_DAILY_VOTE_LIMIT;
}

async function voteForMovie(movieId, button, pointsLabel) {
  if (!movieId) return;

  const draftName = displayNameInput.value.trim();
  const initialVotesToday = draftName ? countVotesForToday(latestMovies, draftName) : 0;

  const voter = requireDisplayName('Save your name before voting.');
  if (!voter) {
    button.disabled = false;
    button.title = '';
    const { variant: currentVariant } = describeNextVote(initialVotesToday, draftName);
    applyVoteButtonVariant(button, currentVariant);
    return;
  }

  const votesToday = countVotesForToday(latestMovies, voter);
  const dailyLimit = getDailyVoteLimit(voter);
  if (votesToday >= dailyLimit) {
    setFeedback(`You have used your ${dailyLimit} votes for today.`);
    updateDailyVoteCount(latestMovies);
    const { label, tooltip, variant: variantOnLimit } = describeNextVote(votesToday, voter);
    button.disabled = true;
    button.textContent = label;
    button.title = tooltip;
    applyVoteButtonVariant(button, variantOnLimit);
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
    renderPoints(pointsLabel, points);
    setFeedback('Thanks for voting!');
    await fetchMovies({ showLoading: false });
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Unable to register your vote.');
  } finally {
    const updatedVotesToday = countVotesForToday(latestMovies, voter);
    const { label, disabled, tooltip, variant: updatedVariant } = describeNextVote(
      updatedVotesToday,
      voter,
    );
    button.disabled = disabled;
    button.textContent = label;
    button.title = tooltip;
    applyVoteButtonVariant(button, updatedVariant);
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
    button.textContent = 'Mark as watched';
    button.removeAttribute('aria-disabled');
  }
}

function describeNextVote(votesToday, voterName = '') {
  const limit = getDailyVoteLimit(voterName);
  const anne = isAnneName(voterName);

  if (votesToday >= limit) {
    return {
      label: 'No votes left today',
      disabled: true,
      tooltip: `Daily limit reached (${limit} votes)`,
      variant: 'disabled',
    };
  }

  if (votesToday === 0) {
    return {
      label: `Big vote (+${formatPointAmount(BIG_VOTE_POINTS)})`,
      disabled: false,
      tooltip: '',
      variant: 'big',
    };
  }

  if (votesToday === 1) {
    return {
      label: `Small vote (+${formatPointAmount(SMALL_VOTE_POINTS)})`,
      disabled: false,
      tooltip: '',
      variant: 'small',
    };
  }

  if (anne && votesToday === 2) {
    return {
      label: `Anne bonus (+${formatPointAmount(ANNE_BONUS_VOTE_POINTS)})`,
      disabled: false,
      tooltip: '',
      variant: 'anne',
    };
  }

  return {
    label: `Small vote (+${formatPointAmount(SMALL_VOTE_POINTS)})`,
    disabled: false,
    tooltip: '',
    variant: 'small',
  };
}

function applyVoteButtonVariant(button, variant) {
  if (!button) return;

  button.classList.remove('vote-button--big', 'vote-button--small', 'vote-button--anne');

  if (variant === 'big') {
    button.classList.remove('secondary');
    button.classList.add('vote-button--big');
    return;
  }

  if (variant === 'small') {
    button.classList.remove('secondary');
    button.classList.add('vote-button--small');
    return;
  }

  if (variant === 'anne') {
    button.classList.remove('secondary');
    button.classList.add('vote-button--anne');
    return;
  }

  button.classList.remove('vote-button--big', 'vote-button--small', 'vote-button--anne');
  button.classList.add('secondary');
}

function renderPoints(container, points = 0) {
  if (!container) return;

  container.innerHTML = '';
  const clamped = Math.max(0, Math.min(points, 10));
  const halfSteps = Math.round(clamped * 2) / 2;

  container.classList.toggle('movie-points--empty', halfSteps === 0);
  container.setAttribute(
    'aria-label',
    `${formatPointAmount(halfSteps)}${points > 10 ? ' (10 shown)' : ''}`,
  );

  const createDot = (fillState) => {
    const dot = document.createElement('span');
    dot.className = 'point-dot';
    if (fillState === 'filled') {
      dot.classList.add('point-dot--filled');
    } else if (fillState === 'half') {
      dot.classList.add('point-dot--half');
    }
    return dot;
  };

  for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
    const row = document.createElement('span');
    row.className = 'points-row';

    for (let colIndex = 0; colIndex < 5; colIndex += 1) {
      const currentIndex = rowIndex * 5 + colIndex;
      const fillAmount = halfSteps - currentIndex;
      let fillState = 'empty';
      if (fillAmount >= 1) {
        fillState = 'filled';
      } else if (fillAmount >= 0.5) {
        fillState = 'half';
      }
      row.appendChild(createDot(fillState));
    }

    container.appendChild(row);
  }
}

function setFeedback(text) {
  searchFeedback.textContent = text;
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
    updateChangeNameButtonLabel(name);
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

if (moviesFilterInput) {
  activeMovieFilter = normaliseFilterValue(moviesFilterInput.value);
  moviesFilterInput.addEventListener('input', () => {
    activeMovieFilter = normaliseFilterValue(moviesFilterInput.value);
    renderMovies(latestMovies);
  });
}

setupTabs();

hydrateDisplayName();
updateChangeNameButtonLabel();

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
