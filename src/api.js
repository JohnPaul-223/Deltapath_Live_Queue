// API helpers — all calls go to Vercel serverless functions in /api/.
// The live session token is returned to and held by the caller (LiveCallView),
// then passed back on every poll and stop request. No server-side session state.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function scanServer(credentials) {
  const response = await fetch('/api/scan', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(credentials),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Discovery scan failed.');
  return data;
}

/**
 * Authenticate with the Deltapath server and return a live session object.
 * The caller is responsible for holding { token, server, username, allowInvalidTLS }
 * and passing it to fetchLiveSnapshot / stopLiveSession.
 */
export async function startLiveSession(credentials) {
  const response = await fetch('/api/live/start', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(credentials),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Could not start live monitoring.');
  // Return everything the client needs to make subsequent calls
  return {
    token:          data.token,
    server:         data.server,
    username:       data.username,
    allowInvalidTLS: credentials.allowInvalidTLS ?? true,
  };
}

/**
 * Fetch a live snapshot. Accepts the session object returned by startLiveSession.
 */
export async function fetchLiveSnapshot(session) {
  const response = await fetch('/api/live/poll', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      token:          session.token,
      server:         session.server,
      allowInvalidTLS: session.allowInvalidTLS,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Queue status unavailable.');
  return data;
}

/**
 * Expire the token on the Deltapath server. Best-effort — errors are swallowed.
 */
export async function stopLiveSession(session) {
  if (!session?.token) return;
  try {
    await fetch('/api/live/stop', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        token:          session.token,
        server:         session.server,
        username:       session.username,
        allowInvalidTLS: session.allowInvalidTLS,
      }),
    });
  } catch { /* best effort */ }
}
