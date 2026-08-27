/**
 * A tiny HTTP client that talks to the Worker in-process and keeps its cookie,
 * so a test reads like a session: sign up, add a car, log a call.
 */
import worker from '../../src/worker.js';

export function client(env, { origin = 'https://forecourt.test' } = {}) {
  let cookie = null;

  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
    if (cookie) init.headers.cookie = cookie;
    // Browsers send an Origin on writes. A test that passes its own is testing
    // what happens when it comes from somewhere else, so it wins.
    if (method !== 'GET' && !init.headers.origin) init.headers.origin = origin;

    const res = await worker.fetch(new Request(`${origin}${path}`, init), env, {});
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const value = setCookie.split(';')[0];
      cookie = value.endsWith('=') ? null : value;
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  }

  const api = (path, options) => request(`/api${path}`, options);

  return {
    request,
    api,
    get: (path) => api(path),
    post: (path, body) => api(path, { method: 'POST', body }),
    patch: (path, body) => api(path, { method: 'PATCH', body }),
    del: (path) => api(path, { method: 'DELETE' }),
    get cookie() { return cookie; },
    set cookie(value) { cookie = value; },
  };
}

/** The shortest path to a signed-in dealership. */
export async function signUp(env, overrides = {}) {
  const c = client(env);
  const res = await c.post('/auth/signup', {
    name: 'Sam Read',
    dealership: 'Ridgeway Motors',
    email: 'sam@ridgeway.test',
    password: 'a-long-enough-password',
    country: 'GB',
    ...overrides,
  });
  return { client: c, res };
}
