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

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

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
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }
  return data;
}

// Plain <a href> links can't carry the Authorization header, so downloading
// a protected file means fetching it as a blob ourselves and triggering the
// save via a temporary object URL.
async function downloadFile(path, filename) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`/api${path}`, { headers });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
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
