// API helpers — calls go to Vercel serverless functions in /api/.
// The live session token is returned to and held in component state,
// then sent back on every poll and stop request. No server-side session.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Authenticate with the Deltapath server and return a live session object:
 * { token, server, username, allowInvalidTLS }
 */
export async function startLiveSession(credentials) {
  const response = await fetch('/api/live/start', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(credentials),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Could not connect to Deltapath server.');
  return {
    token:           data.token,
    server:          data.server,
    username:        data.username,
    allowInvalidTLS: credentials.allowInvalidTLS ?? true,
  };
}

/**
 * Fetch a live queue snapshot. Pass the session object from startLiveSession.
 */
export async function fetchLiveSnapshot(session) {
  const response = await fetch('/api/live/poll', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      token:           session.token,
      server:          session.server,
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
        token:           session.token,
        server:          session.server,
        username:        session.username,
        allowInvalidTLS: session.allowInvalidTLS,
      }),
    });
  } catch { /* best effort */ }
}
