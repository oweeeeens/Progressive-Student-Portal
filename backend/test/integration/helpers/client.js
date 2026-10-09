// Thin fetch wrapper for calling the test server — mirrors the shape of
// frontend/src/api/client.js (bearer token, JSON body) but returns
// {status, body} instead of throwing, since tests need to assert on error
// responses (403s, 400s) just as often as success ones.
function createClient(baseUrl) {
  async function request(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const status = response.status;
    const text = await response.text();
    const parsedBody = text ? JSON.parse(text) : null;
    return { status, body: parsedBody };
  }

  return {
    get: (path, opts) => request('GET', path, opts),
    post: (path, opts) => request('POST', path, opts),
    patch: (path, opts) => request('PATCH', path, opts),
  };
}

module.exports = { createClient };
