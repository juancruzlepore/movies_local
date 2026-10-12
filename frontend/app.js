const API_STORAGE_KEY = 'movies-local-api-base';
const DEBUG_STORAGE_KEY = 'movies-local-debug';
let debugPanel = null;
let debugEnabled = resolveDebugFlag();
const API_BASE = resolveApiBase();
const DEFAULT_DAILY_VOTE_LIMIT = 2;
const ANNE_DAILY_VOTE_LIMIT = 3;
const ANNE_NAME = 'anne';
const BIG_VOTE_POINTS = 1.5;
const SMALL_VOTE_POINTS = 1;
const ANNE_BONUS_VOTE_POINTS = 0.5;
const DELETE_HOLD_MS = 1000;
const LOCAL_PREVIEW_POSTERS = {
  tt6710474: 'assets/poster-multiverse.png',
  tt9362722: 'assets/poster-animated-city.png',
  tt7605052: 'assets/poster-holiday-baking.png',
};

const displayNameInput = document.querySelector('#display-name'); // Optional legacy input
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
const watchedMoviesList = document.querySelector('#watched-movies-list');
const watchedCount = document.querySelector('#watched-count');
const refreshMoviesButton = document.querySelector('#refresh-movies');
const moviesFilterInput = document.querySelector('#movies-filter');
const dailyVoteCounter = document.querySelector('#daily-vote-count');
const votingDayBalance = document.querySelector('#voting-day-balance');
const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

const resultTemplate = document.querySelector('#result-item-template');
const movieTemplate = document.querySelector('#movie-item-template');
const watchedMovieTemplate = document.querySelector('#watched-movie-item-template');

const householdScreen = document.querySelector('#household-screen');
const householdList = document.querySelector('#household-list');
const createHouseholdForm = document.querySelector('#create-household-form');
const newHouseholdNameInput = document.querySelector('#new-household-name');

const userList = document.querySelector('#user-list');
const addUserForm = document.querySelector('#add-user-form');
const newUserNameInput = document.querySelector('#new-user-name');
const backToHouseholdsButton = document.querySelector('#back-to-households');
const selectedHouseholdName = document.querySelector('#selected-household-name');
const activeUserLabel = document.querySelector('#active-user-label');
const activeHouseholdLabel = document.querySelector('#active-household-label');

const STORAGE_KEY = 'movies-local-display-name';
const HOUSEHOLD_STORAGE_KEY = 'movies-local-household-id';
const SESSION_STORAGE_KEY = 'movies-local-selection';

const VIEW_HASHES = {
  households: '#households',
  people: '#people',
  app: '#watchlist',
};

let latestMovies = [];
let activeMovieFilter = '';
let currentHouseholdId = null;
let allHouseholds = [];

function resolveDebugFlag() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const override = searchParams.get('debug') || hashParams.get('debug');

  if (override) {
    const enabled = override === '1' || override.toLowerCase() === 'true';
    setStoredDebugFlag(enabled);
    return enabled;
  }

  try {
    return localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setStoredDebugFlag(enabled) {
  try {
    if (enabled) {
      localStorage.setItem(DEBUG_STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(DEBUG_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors (private browsing, etc)
  }
}

function ensureDebugPanel() {
  if (!debugEnabled || debugPanel) return;

  debugPanel = document.createElement('aside');
  debugPanel.id = 'movies-local-debug';
  debugPanel.style.position = 'fixed';
  debugPanel.style.bottom = '0';
  debugPanel.style.right = '0';
  debugPanel.style.maxWidth = '360px';
  debugPanel.style.maxHeight = '40vh';
  debugPanel.style.overflow = 'auto';
  debugPanel.style.fontSize = '12px';
  debugPanel.style.lineHeight = '1.4';
  debugPanel.style.background = 'rgba(15, 23, 42, 0.85)';
  debugPanel.style.color = '#e2e8f0';
  debugPanel.style.padding = '0.75rem';
  debugPanel.style.borderTopLeftRadius = '10px';
  debugPanel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
  debugPanel.style.zIndex = '9999';

  const title = document.createElement('div');
  title.textContent = 'movies-local debug';
  title.style.fontWeight = '700';
  title.style.marginBottom = '0.35rem';
  debugPanel.appendChild(title);

  document.body.appendChild(debugPanel);
}

function logDebug(message, extra) {
  if (!debugEnabled) return;
  console.info('[movies-local][debug]', message, extra || '');
  ensureDebugPanel();
  if (!debugPanel) return;
  const entry = document.createElement('div');
  entry.style.marginBottom = '0.35rem';
  entry.textContent = `${new Date().toISOString()} ${message}${extra ? ` ${JSON.stringify(extra)}` : ''
    }`;
  debugPanel.appendChild(entry);
  debugPanel.scrollTop = debugPanel.scrollHeight;
}

function logError(message, extra) {
  console.error('[movies-local][error]', message, extra || '');
  if (!debugEnabled) return;
  ensureDebugPanel();
  if (!debugPanel) return;
  const entry = document.createElement('div');
  entry.style.marginBottom = '0.35rem';
  entry.style.color = '#f87171';
  entry.textContent = `${new Date().toISOString()} ${message}${extra ? ` ${JSON.stringify(extra)}` : ''
    }`;
  debugPanel.appendChild(entry);
  debugPanel.scrollTop = debugPanel.scrollHeight;
}

function resolveApiBase() {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  const override =
    window.API_BASE_URL || getStoredApiBase() || getUrlOverride();
  const defaultCloudApi = 'https://zf23h8tk44.execute-api.eu-west-2.amazonaws.com';

  const candidate =
    override ||
    (isLocalHost(hostname)
      ? `${protocol}://${normaliseHostname(hostname)}:8080`
      : defaultCloudApi);

  console.info('[movies-local] API base:', candidate);
  logDebug('API base resolved', { candidate, hostname, protocol, override });
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
  const { protocol, hostname, port } = window.location;

  if (!hostname || hostname === '0.0.0.0') {
    return null;
  }

  const url = new URL('http://placeholder');
  url.protocol = protocol === 'https:' ? 'https:' : 'http:';
  url.hostname = hostname;
  if (port) {
    url.port = port;
  } else {
    url.port = '';
  }
  return url.origin;
}

function isLocalHost(hostname) {
  if (!hostname || hostname === '0.0.0.0') return true;

  const privateRange =
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    hostname.endsWith('.local');

  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    privateRange
  );
}

function normaliseHostname(hostname) {
  if (!hostname || hostname === '0.0.0.0') return 'localhost';
  return hostname.includes(':') && !hostname.startsWith('[')
    ? `[${hostname}]`
    : hostname;
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

window.moviesLocal.enableDebug = function enableDebug() {
  debugEnabled = true;
  setStoredDebugFlag(true);
  ensureDebugPanel();
  logDebug('Debug enabled via moviesLocal.enableDebug()');
};

window.moviesLocal.disableDebug = function disableDebug() {
  debugEnabled = false;
  setStoredDebugFlag(false);
  if (debugPanel && debugPanel.parentNode) {
    debugPanel.parentNode.removeChild(debugPanel);
  }
  debugPanel = null;
  console.info('[movies-local] Debug disabled');
};

function getDisplayName() {
  const session = getRememberedSelection();
  if (session.householdId === currentHouseholdId) {
    return session.userName || '';
  }
  return '';
}

function setDisplayName(name) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (cleanName) {
    localStorage.setItem(STORAGE_KEY, cleanName);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  setRememberedSelection({
    householdId: currentHouseholdId,
    userName: cleanName,
  });
}

function updateChangeNameButtonLabel(name) {
  if (!changeNameButton) return;
  const displayName =
    (typeof name === 'string' && name.trim()) ||
    getDisplayName();

  if (!displayName) return;
  const household = allHouseholds.find((item) => item.id === currentHouseholdId);
  if (activeUserLabel) activeUserLabel.textContent = displayName;
  if (activeHouseholdLabel) {
    activeHouseholdLabel.textContent = household?.name || 'Switch person';
  }
}

function getRememberedSelection() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '{}');
    return {
      householdId: typeof parsed.householdId === 'string' ? parsed.householdId : '',
      userName: typeof parsed.userName === 'string' ? parsed.userName : '',
    };
  } catch {
    return { householdId: '', userName: '' };
  }
}

function setRememberedSelection(selection) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      householdId: selection.householdId || '',
      userName: selection.userName || '',
    }));
  } catch {
    // Local storage can be unavailable in private browsing modes.
  }
}

function updateSelectedHouseholdCopy() {
  const household = allHouseholds.find((item) => item.id === currentHouseholdId);
  if (selectedHouseholdName) {
    selectedHouseholdName.textContent = household?.name || 'this household';
  }
  updateChangeNameButtonLabel();
}

function syncViewHistory(view, mode = 'push') {
  if (mode === 'none') return;
  const hash = VIEW_HASHES[view];
  if (!hash) return;
  const state = { moviesLocalView: view };
  if (mode === 'replace') {
    window.history.replaceState(state, '', hash);
  } else if (window.location.hash !== hash) {
    window.history.pushState(state, '', hash);
  }
}

function hydrateDisplayName() {
  // No-op: input removed
}

function showLanding(options = {}) {
  const {
    focusInput = true,
    selectInput = false,
    prefill = true,
    historyMode = 'push',
  } = options;

  if (prefill) {
    // No-op: input removed
  }

  if (landingScreen) {
    landingScreen.hidden = false;
    landingScreen.setAttribute('aria-hidden', 'false');
  }

  if (householdScreen) {
    householdScreen.hidden = true;
    householdScreen.setAttribute('aria-hidden', 'true');
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

  updateSelectedHouseholdCopy();
  syncViewHistory('people', historyMode);

  // if (displayNameInput && focusInput) { ... } // Removed
}

function hideLanding(options = {}) {
  const { historyMode = 'push' } = options;
  if (landingScreen) {
    landingScreen.hidden = true;
    landingScreen.setAttribute('aria-hidden', 'true');
  }

  if (householdScreen) {
    householdScreen.hidden = true;
    householdScreen.setAttribute('aria-hidden', 'true');
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

  updateSelectedHouseholdCopy();
  syncViewHistory('app', historyMode);
}

function requireDisplayName(message) {
  const name = getDisplayName();
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
  fetchMovies();
}

async function fetchMovies(options = {}) {
  const { showLoading = true } = options;

  if (showLoading) {
    setFeedback('Loading shared list…');
  }

  try {
    if (!currentHouseholdId) {
      throw new Error("No household selected");
    }
    logDebug('Fetching movies', { householdId: currentHouseholdId });
    const response = await fetch(`${API_BASE}/households/${currentHouseholdId}/movies`);
    const bodyText = await response.text();
    logDebug('Movies response', { status: response.status, bodyPreview: bodyText.slice(0, 200) });
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    latestMovies = parseArrayPayload(bodyText, 'movies');
    renderMovies(latestMovies);
    updateDailyVoteCount(latestMovies);
    updateVotingDayBalance(latestMovies);
    if (showLoading) {
      setFeedback('');
    }
  } catch (error) {
    logError('fetch movies failed', { message: error.message });
    setFeedback('Unable to load shared list. Check the server.');
    if (dailyVoteCounter) {
      dailyVoteCounter.textContent = 'Unable to load vote history right now.';
    }
    if (votingDayBalance) votingDayBalance.textContent = '';
  }
}

function renderMovies(movies = []) {
  const votingMovies = movies.filter(isMovieInVoting);
  const watchedMovies = movies.filter((movie) => !isMovieInVoting(movie));
  const filter = activeMovieFilter;
  const filteredMovies = !filter
    ? votingMovies
    : votingMovies.filter((movie) => movieMatchesFilter(movie, filter));

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
  renderWatchedMovies(watchedMovies);
}

function isMovieInVoting(movie = {}) {
  if (typeof movie.in_voting === 'boolean') return movie.in_voting;
  return !movie.last_watched_at;
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

function renderWatchedMovies(movies = []) {
  if (!watchedMoviesList || !watchedMovieTemplate) return;

  const sortedMovies = [...movies].sort((a, b) => {
    const timeA = a.last_watched_at ? new Date(a.last_watched_at).getTime() : 0;
    const timeB = b.last_watched_at ? new Date(b.last_watched_at).getTime() : 0;
    return timeB - timeA;
  });

  if (watchedCount) {
    watchedCount.textContent = String(sortedMovies.length);
    watchedCount.setAttribute(
      'aria-label',
      `${sortedMovies.length} watched ${sortedMovies.length === 1 ? 'title' : 'titles'}`,
    );
  }

  watchedMoviesList.innerHTML = '';
  if (!sortedMovies.length) {
    const empty = document.createElement('p');
    empty.className = 'movie-empty';
    empty.textContent = 'Nothing watched yet. Finished picks will move here.';
    watchedMoviesList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  sortedMovies.forEach((movie) => fragment.append(buildWatchedMovieElement(movie)));
  watchedMoviesList.append(fragment);
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
  populateMovieCard(element, movie);

  const voteButton = element.querySelector('.vote-button');
  const pointsLabel = element.querySelector('.movie-points');
  renderPoints(pointsLabel, getPoints(movie));

  const voter = getDisplayName();
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
    markWatchedButton.title = 'Move to watched and reset points';
    markWatchedButton.addEventListener('click', () =>
      markMovieWatched(movie.id, markWatchedButton),
    );
  }

  const deleteButton = element.querySelector('.delete-movie');
  if (deleteButton) {
    deleteButton.setAttribute('aria-label', `Hold to delete ${movie.title}`);
    setupLongPressDelete(deleteButton, movie);
  }

  return element;
}

function buildWatchedMovieElement(movie) {
  const element = watchedMovieTemplate.content.cloneNode(true);
  populateMovieCard(element, movie);

  const historyLabel = element.querySelector('.watch-history');
  if (historyLabel) historyLabel.textContent = describeWatchHistory(movie);

  const readdButton = element.querySelector('.readd-movie');
  if (readdButton) {
    readdButton.addEventListener('click', () =>
      readdMovieToVoting(movie, readdButton),
    );
  }

  const deleteButton = element.querySelector('.delete-movie');
  if (deleteButton) {
    deleteButton.setAttribute('aria-label', `Hold to delete ${movie.title}`);
    setupLongPressDelete(deleteButton, movie);
  }

  return element;
}

function populateMovieCard(element, movie) {
  const movieCard = element.querySelector('.movie-card');
  if (movieCard && movie.id) movieCard.dataset.movieId = movie.id;

  element.querySelector('.movie-title').textContent = movie.title;

  const metaParts = [];
  if (movie.year) metaParts.push(movie.year);
  if (movie.media_type) metaParts.push(capitalise(movie.media_type));
  const runtime = formatRuntime(movie.runtime_minutes);
  if (runtime) metaParts.push(runtime);
  element.querySelector('.movie-meta').textContent = metaParts.join(' • ');

  const posterContainer = element.querySelector('.movie-poster');
  const posterUrls = resolveMoviePosterCandidates(movie);
  if (!posterUrls.length) {
    showPosterPlaceholder(posterContainer);
    return;
  }

  posterContainer.innerHTML = '';
  const img = document.createElement('img');
  img.alt = `${movie.title} poster`;
  img.loading = 'lazy';
  img.decoding = 'async';
  let posterIndex = 0;
  img.addEventListener('error', () => {
    posterIndex += 1;
    if (posterIndex < posterUrls.length) {
      img.src = posterUrls[posterIndex];
      return;
    }
    showPosterPlaceholder(posterContainer);
  });
  img.src = posterUrls[posterIndex];
  posterContainer.appendChild(img);
  posterContainer.removeAttribute('aria-hidden');
  posterContainer.classList.remove('movie-poster--placeholder');
}

function setupLongPressDelete(button, movie) {
  let animationFrame = 0;
  let startedAt = 0;
  let deleting = false;

  const reset = () => {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    startedAt = 0;
    button.classList.remove('is-holding');
    button.style.setProperty('--delete-progress', '0deg');
  };

  const tick = (now) => {
    if (!startedAt || deleting) return;
    const elapsed = now - startedAt;
    const progress = Math.min(elapsed / DELETE_HOLD_MS, 1);
    button.style.setProperty('--delete-progress', `${progress * 360}deg`);
    if (progress >= 1) {
      deleting = true;
      removeMovie(movie, button).finally(reset);
      return;
    }
    animationFrame = requestAnimationFrame(tick);
  };

  const start = (event) => {
    if (deleting || button.disabled) return;
    if (event.type === 'pointerdown' && event.button !== 0) return;
    if (event.type === 'keydown' && event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (startedAt) return;
    startedAt = performance.now();
    button.classList.add('is-holding');
    animationFrame = requestAnimationFrame(tick);
  };

  const cancel = (event) => {
    if (event?.type === 'keyup' && event.key !== ' ' && event.key !== 'Enter') return;
    if (!deleting) reset();
  };

  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', cancel);
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('pointerleave', cancel);
  button.addEventListener('keydown', start);
  button.addEventListener('keyup', cancel);
  button.addEventListener('blur', cancel);
  button.addEventListener('contextmenu', (event) => event.preventDefault());
  button.addEventListener('click', (event) => event.preventDefault());
}

async function removeMovie(movie, button) {
  button.disabled = true;
  button.setAttribute('aria-disabled', 'true');
  setFeedback(`Deleting ${movie.title}…`);

  try {
    if (!currentHouseholdId) throw new Error('No household selected');
    const response = await fetch(
      `${API_BASE}/households/${currentHouseholdId}/movies/${movie.id}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      const problem = await safeJson(response);
      throw new Error(problem?.message || `Delete failed with ${response.status}`);
    }
    setFeedback(`${movie.title} was deleted.`);
    await fetchMovies({ showLoading: false });
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Unable to delete the movie.');
    button.disabled = false;
    button.removeAttribute('aria-disabled');
  }
}

async function searchMovies(query, mediaType) {
  setFeedback('Searching…');
  try {
    const params = new URLSearchParams({ query });
    if (mediaType) params.set('media_type', mediaType);

    const url = `${API_BASE}/search?${params.toString()}`;
    logDebug('Searching movies', { url });
    const response = await fetch(url);
    const bodyText = await response.text();
    logDebug('Search response', { status: response.status, bodyPreview: bodyText.slice(0, 200) });
    if (!response.ok) {
      throw new Error(`Search failed with ${response.status}`);
    }

    const payload = parseSearchPayload(bodyText);
    const results = payload?.results || [];
    renderSearchResults(results);
    if (!results.length) {
      setFeedback('No matches found. Try a different title.');
    } else {
      setFeedback('');
    }
  } catch (error) {
    logError('search failed', { message: error.message });
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
    if (!currentHouseholdId) {
      throw new Error("No household selected");
    }
    const response = await fetch(`${API_BASE}/households/${currentHouseholdId}/movies`, {
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

function resolveMoviePoster(movie = {}) {
  const normalised = normalisePoster(movie.poster_url);
  const localFallback = LOCAL_PREVIEW_POSTERS[movie.imdb_id];
  if (!normalised || normalised.includes('example.com/posters/')) {
    return localFallback || null;
  }
  return normalised;
}

function resolveMoviePosterCandidates(movie = {}) {
  const primary = resolveMoviePoster(movie);
  const candidates = [];

  if (primary) {
    candidates.push(primary);
    if (/^https?:\/\//i.test(primary)) {
      candidates.push(`https://images.weserv.nl/?url=${encodeURIComponent(primary)}&w=600&fit=cover&output=webp`);
    }
  }

  const imdbId = String(movie.imdb_id || '').trim();
  if (/^tt\d+$/.test(imdbId)) {
    candidates.push(`${API_BASE}/posters/${encodeURIComponent(imdbId)}`);
  }

  return [...new Set(candidates)];
}

function showPosterPlaceholder(container) {
  container.replaceChildren();
  container.textContent = 'No poster yet';
  container.setAttribute('aria-hidden', 'true');
  container.classList.add('movie-poster--placeholder');
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

function describeWatchHistory(movie = {}) {
  const rawCount = Number(movie.times_watched);
  const timesWatched = Number.isFinite(rawCount) && rawCount > 0
    ? Math.floor(rawCount)
    : (movie.last_watched_at ? 1 : 0);
  const countLabel = timesWatched === 1
    ? 'Watched once'
    : `Watched ${timesWatched} times`;
  const watchedAt = new Date(movie.last_watched_at);
  if (Number.isNaN(watchedAt.getTime())) return countLabel;

  const dateLabel = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(watchedAt);
  return `${countLabel} • Last watched ${dateLabel}`;
}

function updateDailyVoteCount(movies = []) {
  if (!dailyVoteCounter) return;

  const voter = getDisplayName();
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

function updateVotingDayBalance(movies = []) {
  if (!votingDayBalance) return;

  const voter = getDisplayName();
  const household = allHouseholds.find((item) => item.id === currentHouseholdId);
  const members = Array.isArray(household?.users) ? household.users : [];
  if (!voter || members.length < 2) {
    votingDayBalance.textContent = '';
    return;
  }

  const activeName = normaliseName(voter);
  const activeMember = members.find((member) => normaliseName(member) === activeName);
  const otherMembers = members.filter((member) => normaliseName(member) !== activeName);
  if (!activeMember || !otherMembers.length) {
    votingDayBalance.textContent = '';
    return;
  }

  const daysByVoter = countDistinctVotingDaysByVoter(movies);
  const activeDays = daysByVoter.get(activeName) || 0;

  if (members.length === 2) {
    const otherName = otherMembers[0];
    const otherDays = daysByVoter.get(normaliseName(otherName)) || 0;
    votingDayBalance.textContent = describeTwoPersonVotingBalance(
      activeDays,
      otherDays,
      otherName,
    );
    return;
  }

  const highestOtherDays = Math.max(
    ...otherMembers.map((member) => daysByVoter.get(normaliseName(member)) || 0),
  );
  votingDayBalance.textContent = describeGroupVotingBalance(activeDays, highestOtherDays);
}

function countDistinctVotingDaysByVoter(movies = []) {
  const daysByVoter = new Map();

  movies.forEach((movie) => {
    getVoteHistory(movie).forEach((vote) => {
      if (!vote?.voter || !vote?.voted_at) return;
      const votedAt = new Date(vote.voted_at);
      if (Number.isNaN(votedAt.getTime())) return;

      const voter = normaliseName(vote.voter);
      if (!voter) return;
      const localDay = [
        votedAt.getFullYear(),
        String(votedAt.getMonth() + 1).padStart(2, '0'),
        String(votedAt.getDate()).padStart(2, '0'),
      ].join('-');

      if (!daysByVoter.has(voter)) daysByVoter.set(voter, new Set());
      daysByVoter.get(voter).add(localDay);
    });
  });

  return new Map(
    Array.from(daysByVoter, ([voter, days]) => [voter, days.size]),
  );
}

function describeTwoPersonVotingBalance(activeDays, otherDays, otherName) {
  const difference = activeDays - otherDays;
  if (difference === 0) return `You’ve voted on as many days as ${otherName}.`;
  const dayLabel = Math.abs(difference) === 1 ? 'day' : 'days';
  if (difference > 0) {
    return `You’ve voted on ${difference} more ${dayLabel} than ${otherName}.`;
  }
  return `You’ve voted on ${Math.abs(difference)} fewer ${dayLabel} than ${otherName}.`;
}

function describeGroupVotingBalance(activeDays, highestOtherDays) {
  const difference = activeDays - highestOtherDays;
  if (difference > 0) return 'You’ve voted on the most days.';
  if (difference === 0) return 'You’re tied for the most voting days.';
  const gap = Math.abs(difference);
  const dayLabel = gap === 1 ? 'day' : 'days';
  return `You’ve voted on ${gap} fewer ${dayLabel} than the most active voter.`;
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

  const draftName = getDisplayName();
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
    if (!currentHouseholdId) {
      throw new Error("No household selected");
    }
    const response = await fetch(`${API_BASE}/households/${currentHouseholdId}/movies/${movieId}/votes`, {
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
  setFeedback('Moving to watched…');

  try {
    if (!currentHouseholdId) {
      throw new Error("No household selected");
    }
    const response = await fetch(`${API_BASE}/households/${currentHouseholdId}/movies/${movieId}/watch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const problem = await safeJson(response);
      throw new Error(problem?.message || `Watch failed with ${response.status}`);
    }

    setFeedback('Moved to watched.');
    await fetchMovies({ showLoading: false });
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Unable to mark as watched.');
    button.disabled = false;
    button.textContent = 'Mark as watched';
    button.removeAttribute('aria-disabled');
  }
}

async function readdMovieToVoting(movie, button) {
  if (!movie?.id || !button) return;

  button.disabled = true;
  button.textContent = 'Re-adding…';
  button.setAttribute('aria-disabled', 'true');
  setFeedback(`Re-adding ${movie.title} to voting…`);

  try {
    if (!currentHouseholdId) throw new Error('No household selected');
    const response = await fetch(
      `${API_BASE}/households/${currentHouseholdId}/movies/${movie.id}/readd`,
      { method: 'POST' },
    );

    if (!response.ok) {
      const problem = await safeJson(response);
      throw new Error(problem?.message || `Re-add failed with ${response.status}`);
    }

    setFeedback(`${movie.title} is back in voting.`);
    await fetchMovies({ showLoading: false });
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Unable to re-add the movie.');
    button.disabled = false;
    button.textContent = 'Re-add to voting';
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
    logError('failed to parse JSON response', { message: error.message });
    return null;
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    logError('failed to parse JSON body', { preview: text.slice(0, 120) });
    return null;
  }
}

function parseArrayPayload(bodyText, label) {
  const parsed = safeParseJson(bodyText);
  if (Array.isArray(parsed)) return parsed;

  if (parsed && typeof parsed === 'object') {
    const nested = typeof parsed.body === 'string' ? safeParseJson(parsed.body) : parsed?.body;
    if (Array.isArray(nested)) return nested;
  }

  logError(`unexpected ${label} payload`, { preview: bodyText.slice(0, 200) });
  return [];
}

function parseSearchPayload(bodyText) {
  const parsed = safeParseJson(bodyText);
  if (parsed && Array.isArray(parsed.results)) return parsed;

  if (parsed && typeof parsed === 'object' && parsed.body) {
    const inner = typeof parsed.body === 'string' ? safeParseJson(parsed.body) : parsed.body;
    if (inner && Array.isArray(inner.results)) return inner;
  }

  logError('unexpected search payload', { preview: bodyText.slice(0, 200) });
  return { results: [] };
}

// Household Management

function getStoredHouseholdId() {
  return getRememberedSelection().householdId || localStorage.getItem(HOUSEHOLD_STORAGE_KEY);
}

function setStoredHouseholdId(id) {
  const previous = getRememberedSelection();
  if (id) {
    localStorage.setItem(HOUSEHOLD_STORAGE_KEY, id);
  } else {
    localStorage.removeItem(HOUSEHOLD_STORAGE_KEY);
  }
  setRememberedSelection({
    householdId: id || '',
    userName: previous.householdId === id ? previous.userName : '',
  });
}

async function initApp() {
  logDebug('Debug mode active', { debugEnabled });
  setupTabs();

  // if (displayNameForm) { ... } // Removed

  if (addUserForm) {
    addUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = newUserNameInput.value.trim();
      if (name) {
        await addUser(name);
      }
    });
  }

  if (backToHouseholdsButton) {
    backToHouseholdsButton.addEventListener('click', () => {
      showHouseholdSelection({ historyMode: 'push', refresh: false });
    });
  }

  if (changeNameButton) {
    changeNameButton.addEventListener('click', () => {
      showLanding({ focusInput: true, selectInput: true, prefill: true, historyMode: 'push' });
    });
  }

  if (createHouseholdForm) {
    createHouseholdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = newHouseholdNameInput.value.trim();
      if (name) {
        await createHousehold(name);
      }
    });
  }

  // Always fetch households first to populate state
  await fetchHouseholds();

  const storedId = getStoredHouseholdId();
  if (storedId) {
    const household = allHouseholds.find(h => h.id === storedId);
    if (household) {
      currentHouseholdId = storedId;
      const remembered = getRememberedSelection();
      const legacyName = localStorage.getItem(STORAGE_KEY) || '';
      if (!remembered.householdId && legacyName && household.users?.includes(legacyName)) {
        setRememberedSelection({ householdId: storedId, userName: legacyName });
      }
      renderUsers(household);

      hydrateDisplayName();
      updateChangeNameButtonLabel();

      const displayName = getDisplayName();
      const hasRememberedUser = Boolean(displayName && household.users?.includes(displayName));
      if (displayName && !hasRememberedUser) setDisplayName('');

      if (window.location.hash === VIEW_HASHES.households) {
        showHouseholdSelection({ historyMode: 'replace', refresh: false });
      } else if (window.location.hash === VIEW_HASHES.people || !hasRememberedUser) {
        showLanding({ historyMode: 'replace' });
      } else {
        hideLanding({ historyMode: 'replace' });
        fetchMovies();
      }
    } else {
      // Stored ID is invalid or household deleted
      setStoredHouseholdId(null);
      showHouseholdSelection({ historyMode: 'replace', refresh: false });
    }
  } else {
    showHouseholdSelection({ historyMode: 'replace', refresh: false });
  }

  window.addEventListener('popstate', handleHistoryNavigation);
}

function showHouseholdSelection(options = {}) {
  const { historyMode = 'push', refresh = true } = options;
  if (householdScreen) {
    householdScreen.hidden = false;
    householdScreen.setAttribute('aria-hidden', 'false');
  }
  if (landingScreen) {
    landingScreen.hidden = true;
    landingScreen.setAttribute('aria-hidden', 'true');
  }
  if (appMain) {
    appMain.hidden = true;
  }
  if (changeNameButton) {
    changeNameButton.hidden = true;
  }
  document.body?.classList.add('showing-landing');
  syncViewHistory('households', historyMode);
  if (refresh) fetchHouseholds();
}

function handleHistoryNavigation(event) {
  const stateView = event.state?.moviesLocalView;
  const hashView = Object.entries(VIEW_HASHES)
    .find(([, hash]) => hash === window.location.hash)?.[0];
  const view = stateView || hashView || 'households';

  if (view === 'app' && currentHouseholdId && getDisplayName()) {
    hideLanding({ historyMode: 'none' });
    fetchMovies({ showLoading: false });
  } else if (view === 'people' && currentHouseholdId) {
    const household = allHouseholds.find((item) => item.id === currentHouseholdId);
    if (household) renderUsers(household);
    showLanding({ historyMode: 'none' });
  } else {
    showHouseholdSelection({ historyMode: 'none', refresh: false });
  }
}

async function fetchHouseholds() {
  try {
    logDebug('Fetching households', { url: `${API_BASE}/households` });
    const response = await fetch(`${API_BASE}/households`);
    const bodyText = await response.text();
    logDebug('Households response', { status: response.status, bodyPreview: bodyText.slice(0, 200) });
    if (!response.ok) {
      throw new Error(`Failed to fetch households (${response.status})`);
    }
    const households = parseArrayPayload(bodyText, 'households');
    allHouseholds = households;
    renderHouseholds(households);
  } catch (error) {
    logError('households request failed', { message: error.message });
    if (householdList) {
      householdList.textContent = 'Unable to load households.';
    }
  }
}

function renderHouseholds(households) {
  if (!householdList) return;
  householdList.innerHTML = '';

  if (households.length === 0) {
    const p = document.createElement('p');
    p.textContent = "No households found. Create one to get started.";
    householdList.appendChild(p);
    return;
  }

  const remembered = getRememberedSelection();
  const ul = document.createElement('ul');
  ul.className = 'choice-list';

  households.forEach(h => {
    const li = document.createElement('li');
    const isRemembered = h.id === remembered.householdId;
    li.className = `household-row${isRemembered ? ' is-remembered' : ''}`;

    const avatar = document.createElement('span');
    avatar.className = 'choice-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    const householdIcon = document.createElement('img');
    householdIcon.src = 'assets/icons/popcorn.svg';
    householdIcon.alt = '';
    avatar.appendChild(householdIcon);

    const div = document.createElement('div');
    div.className = 'choice-copy';
    const h3 = document.createElement('h3');
    h3.textContent = h.name;
    if (isRemembered) {
      const rememberedLabel = document.createElement('span');
      rememberedLabel.className = 'remembered-label';
      rememberedLabel.textContent = 'Last used';
      h3.appendChild(rememberedLabel);
    }
    const meta = document.createElement('p');
    const memberCount = Array.isArray(h.users) ? h.users.length : 0;
    meta.textContent = `${memberCount} ${memberCount === 1 ? 'person' : 'people'} sharing this list`;
    div.appendChild(h3);
    div.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'choice-action';
    const buttonText = document.createElement('span');
    buttonText.textContent = isRemembered ? 'Continue' : 'Choose';
    const arrow = document.createElement('img');
    arrow.src = 'assets/icons/arrow-right.svg';
    arrow.alt = '';
    btn.append(buttonText, arrow);
    btn.addEventListener('click', () => selectHousehold(h.id));

    li.appendChild(avatar);
    li.appendChild(div);
    li.appendChild(btn);
    ul.appendChild(li);
  });

  householdList.appendChild(ul);
}

async function createHousehold(name) {
  try {
    logDebug('Creating household', { name });
    const response = await fetch(`${API_BASE}/households`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    const bodyText = await response.text();
    logDebug('Create household response', { status: response.status, bodyPreview: bodyText.slice(0, 200) });
    if (!response.ok) throw new Error('Failed to create household');

    const household = safeParseJson(bodyText);
    allHouseholds.push(household);
    selectHousehold(household.id);
  } catch (error) {
    logError('create household failed', { message: error.message });
    alert('Failed to create household');
  }
}

function selectHousehold(id) {
  currentHouseholdId = id;
  setStoredHouseholdId(id);

  const household = allHouseholds.find(h => h.id === id);
  if (household) {
    renderUsers(household);
    updateSelectedHouseholdCopy();
    showLanding({ historyMode: 'push' });
  } else {
    // Should not happen if data is consistent, but maybe fetch again?
    fetchHouseholds().then(() => {
      const h = allHouseholds.find(h => h.id === id);
      if (h) {
        renderUsers(h);
        updateSelectedHouseholdCopy();
        showLanding({ historyMode: 'push' });
      } else {
        showHouseholdSelection({ historyMode: 'push' });
      }
    });
  }
}

function renderUsers(household) {
  if (!userList) return;
  userList.innerHTML = '';
  updateSelectedHouseholdCopy();

  if (!household.users || household.users.length === 0) {
    const p = document.createElement('p');
    p.textContent = "No users yet. Add yourself!";
    userList.appendChild(p);
    return;
  }

  const rememberedUser = getRememberedSelection().householdId === household.id
    ? getRememberedSelection().userName
    : '';
  const ul = document.createElement('ul');
  ul.className = 'choice-list';

  household.users.forEach(user => {
    const li = document.createElement('li');
    const isRemembered = user === rememberedUser;
    li.className = `person-row${isRemembered ? ' is-remembered' : ''}`;

    const avatar = document.createElement('span');
    avatar.className = 'choice-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = getInitials(user);

    const div = document.createElement('div');
    div.className = 'choice-copy';
    const h3 = document.createElement('h3');
    h3.textContent = user;
    if (isRemembered) {
      const rememberedLabel = document.createElement('span');
      rememberedLabel.className = 'remembered-label';
      rememberedLabel.textContent = 'Remembered';
      h3.appendChild(rememberedLabel);
    }
    const meta = document.createElement('p');
    meta.textContent = 'Add ideas and vote on the queue';
    div.appendChild(h3);
    div.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'person-actions';

    const selectBtn = document.createElement('button');
    selectBtn.className = 'choice-action';
    const selectText = document.createElement('span');
    selectText.textContent = isRemembered ? 'Continue' : 'Choose';
    const arrow = document.createElement('img');
    arrow.src = 'assets/icons/arrow-right.svg';
    arrow.alt = '';
    selectBtn.append(selectText, arrow);
    selectBtn.addEventListener('click', () => selectUser(user));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'remove-person';
    deleteBtn.setAttribute('aria-label', `Remove ${user}`);
    const trashIcon = document.createElement('img');
    trashIcon.src = 'assets/icons/trash.svg';
    trashIcon.alt = '';
    deleteBtn.appendChild(trashIcon);
    deleteBtn.addEventListener('click', () => removeUser(household.id, user));

    actions.appendChild(selectBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(avatar);
    li.appendChild(div);
    li.appendChild(actions);
    ul.appendChild(li);
  });

  userList.appendChild(ul);
}

async function addUser(name) {
  if (!currentHouseholdId) return;
  try {
    logDebug('Adding user', { householdId: currentHouseholdId, name });
    const response = await fetch(`${API_BASE}/households/${currentHouseholdId}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voter: name })
    });
    if (!response.ok) throw new Error('Failed to add user');
    const updatedHousehold = await safeJson(response);

    // Update local state
    const index = allHouseholds.findIndex(h => h.id === updatedHousehold.id);
    if (index !== -1) allHouseholds[index] = updatedHousehold;

    renderUsers(updatedHousehold);
    newUserNameInput.value = '';
  } catch (error) {
    console.error(error);
    alert('Failed to add user');
  }
}

async function removeUser(householdId, name) {
  if (!confirm(`Remove ${name} from this household?`)) return;
  try {
    logDebug('Removing user', { householdId, name });
    const response = await fetch(`${API_BASE}/households/${householdId}/users/${name}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to remove user');
    const updatedHousehold = await safeJson(response);

    const index = allHouseholds.findIndex(h => h.id === updatedHousehold.id);
    if (index !== -1) allHouseholds[index] = updatedHousehold;

    if (householdId === currentHouseholdId && name === getDisplayName()) {
      setDisplayName('');
    }

    renderUsers(updatedHousehold);
  } catch (error) {
    console.error(error);
    alert('Failed to remove user');
  }
}

function selectUser(name) {
  setDisplayName(name);
  updateChangeNameButtonLabel(name);
  completeNameSetup({ message: `Welcome back, ${name}!` });
  logDebug('User selected', { name, householdId: currentHouseholdId });
}

function getInitials(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';
}

// Start
initApp();

if (displayNameInput) {
  displayNameInput.addEventListener('input', () => {
    updateDailyVoteCount(latestMovies);
    updateVotingDayBalance(latestMovies);
  });
}

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
