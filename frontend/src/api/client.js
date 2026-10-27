// Thin fetch wrapper: attaches the stored auth token, parses JSON, and
// throws a plain Error with the server's message so callers can just try/catch.
const TOKEN_STORAGE_KEY = 'studentPortal.token';

// "Remember me" is which storage the token lands in, not a separate flag:
// localStorage survives closing the browser (the "remembered" case, and the
// default — matches this app's behavior before the checkbox existed, so
// anyone who doesn't touch it sees no change), sessionStorage clears the
// moment the tab/browser closes (unchecked — "don't keep me signed in on
// this device"). Checking both on read means an already-remembered session
// from before this feature existed still works.
export function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token, remember = true) {
  if (token) {
    const [store, other] = remember ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
    store.setItem(TOKEN_STORAGE_KEY, token);
    other.removeItem(TOKEN_STORAGE_KEY); // never leave a stale copy in the other store
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

// What to do when the server says the token is no longer good.
//
// Tokens last 8 hours (backend/config/auth.js), so a tab left open overnight
// comes back to an app where every request 401s. Nothing used to handle
// that: the 48 fetches that have no .catch simply never resolved, so the
// page rendered with empty dropdowns, no message, and no hint that signing
// in again was the answer.
//
// Deactivation lands here too — authMiddleware re-checks is_active on every
// request — which is the behaviour we want: access ends immediately and the
// person is told, rather than being left on a page that quietly does
// nothing.
//
// A hard assignment rather than a router navigate: this module is outside
// the React tree and has no access to the router, and a full load is right
// anyway since every piece of in-memory state belongs to the signed-out
// session.
export const SESSION_ENDED_KEY = 'studentPortal.sessionEnded';

function handleUnauthorized() {
  // Guard against a burst of parallel requests each triggering their own
  // redirect, which would cancel the first navigation partway.
  if (handleUnauthorized.redirecting) return;
  handleUnauthorized.redirecting = true;

  setToken(null);

  // A flag rather than a query string. Clearing the token also empties the
  // auth context, so ProtectedRoute's own <Navigate to="/login"> can win the
  // race and land the user on a bare /login with no query to read. A stored
  // marker survives whichever redirect gets there first; LoginPage reads it
  // once and removes it. sessionStorage, so it cannot outlive the tab and
  // greet someone with a stale explanation tomorrow.
  try {
    sessionStorage.setItem(SESSION_ENDED_KEY, '1');
  } catch {
    // Private mode or blocked storage: the redirect still happens, the
    // explanation is simply missing. Not worth failing over.
  }

  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    handleUnauthorized();
    throw new Error('Your session has expired. Please sign in again.');
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }
  return data;
}

// Separate from request() because file uploads need FormData, not JSON — and
// the Content-Type header must be left unset so the browser can add the
// multipart boundary itself. method defaults to POST (creating something
// new) but PATCH works the same way for "replace this record, optionally
// with a new file" edits.
async function upload(path, formData, method = 'POST') {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`/api${path}`, { method, headers, body: formData });
  if (response.status === 401) {
    handleUnauthorized();
    throw new Error('Your session has expired. Please sign in again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }
  return data;
}

// Pulls the filename out of a `Content-Disposition: attachment;
// filename="..."` header. Used when the SERVER is the one that knows what
// the file should be called — e.g. the Analytics export, whose filename
// encodes the filters that were applied, which the caller would otherwise
// have to reconstruct.
function filenameFromResponse(response) {
  const header = response.headers.get('Content-Disposition') || '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1]) : null;
}

// Plain <a href> links can't carry the Authorization header, so downloading
// a protected file means fetching it as a blob ourselves and triggering the
// save via a temporary object URL. `filename` is optional — omit it to use
// whatever name the server put in Content-Disposition.
async function downloadFile(path, filename) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`/api${path}`, { headers });
  if (response.status === 401) {
    handleUnauthorized();
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || filenameFromResponse(response) || 'download';
  link.click();
  URL.revokeObjectURL(url);
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
  upload,
  downloadFile,
};
