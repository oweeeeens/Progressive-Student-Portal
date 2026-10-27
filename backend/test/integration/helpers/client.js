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

  // Multipart POST, for the endpoints behind multer (the bulk importers).
  // `fields` become ordinary text fields, which is how multer hands them to
  // the controller — so a numeric field arrives as a string here exactly as
  // it does from the browser.
  async function upload(path, { token, buffer, fileName = 'upload.xlsx', fields = {} } = {}) {
    const form = new FormData();
    form.append(
      'file',
      new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      fileName
    );
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));

    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    // No Content-Type header: fetch sets it, with the multipart boundary.
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: form });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  return {
    get: (path, opts) => request('GET', path, opts),
    post: (path, opts) => request('POST', path, opts),
    patch: (path, opts) => request('PATCH', path, opts),
    upload,
  };
}

module.exports = { createClient };
