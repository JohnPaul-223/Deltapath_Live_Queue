const H = { 'Content-Type': 'application/json' };

export async function startLiveSession(creds) {
  const r = await fetch('/api/live/start', { method: 'POST', headers: H, body: JSON.stringify(creds) });
  const d = await r.json();
  if (!r.ok || !d.success) throw new Error(d.error || 'Could not connect.');
  return { token: d.token, server: d.server, username: d.username, allowInvalidTLS: creds.allowInvalidTLS ?? true };
}

export async function fetchLiveSnapshot(session) {
  const r = await fetch('/api/live/poll', {
    method: 'POST', headers: H,
    body: JSON.stringify({ token: session.token, server: session.server, allowInvalidTLS: session.allowInvalidTLS }),
  });
  const d = await r.json();
  if (!r.ok || !d.success) throw new Error(d.error || 'Queue status unavailable.');
  return d;
}

export async function stopLiveSession(session) {
  if (!session?.token) return;
  try {
    await fetch('/api/live/stop', {
      method: 'POST', headers: H,
      body: JSON.stringify({ token: session.token, server: session.server, username: session.username, allowInvalidTLS: session.allowInvalidTLS }),
    });
  } catch { /* best effort */ }
}
