const API_BASE = window.API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8080`;

const displayNameInput = document.querySelector('#display-name');
const saveDisplayNameButton = document.querySelector('#save-display-name');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-query');
const searchTypeSelect = document.querySelector('#search-type');
const searchResultsList = document.querySelector('#search-results');
const searchFeedback = document.querySelector('#search-feedback');
const moviesList = document.querySelector('#movies-list');
const refreshMoviesButton = document.querySelector('#refresh-movies');

const resultTemplate = document.querySelector('#result-item-template');
const movieTemplate = document.querySelector('#movie-item-template');

const STORAGE_KEY = 'movies-local-display-name';

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

async function fetchMovies() {
  setFeedback('Loading shared list…');
  try {
    const response = await fetch(`${API_BASE}/movies`);
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    const data = await response.json();
    renderMovies(data);
    setFeedback('');
  } catch (error) {
    console.error(error);
    setFeedback('Unable to load shared list. Check the server.');
  }
}

function renderMovies(movies) {
  moviesList.innerHTML = '';

  if (!movies.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Nothing here yet. Find something great to watch!';
    empty.className = 'movie-empty';
    moviesList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const movie of movies) {
    const element = movieTemplate.content.cloneNode(true);
    element.querySelector('.movie-title').textContent = movie.title;

    const metaParts = [];
    if (movie.year) metaParts.push(movie.year);
    if (movie.media_type) metaParts.push(capitalise(movie.media_type));
    element.querySelector('.movie-meta').textContent = metaParts.join(' • ');

    const added = movie.added_by ? `${movie.added_by}` : 'Unknown friend';
    const timestamp = movie.created_at ? formatTimestamp(movie.created_at) : '';
    element.querySelector('.movie-added').textContent = `${added}${timestamp ? ` • ${timestamp}` : ''}`;

    fragment.appendChild(element);
  }
  moviesList.appendChild(fragment);
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
  const addedBy = displayNameInput.value.trim();
  if (!addedBy) {
    searchFeedback.textContent = 'Save your name before adding a movie.';
    displayNameInput.focus();
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
    await fetchMovies();
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

saveDisplayNameButton.addEventListener('click', () => {
  const name = displayNameInput.value.trim();
  if (!name) {
    setFeedback('Enter a name to save.');
    return;
  }
  setDisplayName(name);
  setFeedback('Name saved!');
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
fetchMovies();

if (displayNameInput.value) {
  setFeedback('Ready when you are!');
} else {
  setFeedback('Save your name so friends know who added what.');
}
