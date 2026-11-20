import https from 'https';

async function deltafetch(base, path, { method = 'GET', headers = {}, body, allowInvalidTLS = true } = {}) {
  const agent = new https.Agent({ rejectUnauthorized: !allowInvalidTLS });
  const opts = { method, headers, agent };
  if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  const r = await fetch(`${base}${path}`, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed.' });

  const { token, server, username, allowInvalidTLS = true } = req.body || {};
  if (!token || !server) return res.json({ success: true, stopped: true }); // best-effort: nothing to clean up

  try {
    await deltafetch(server, '/RESTful/index.php/v1/delete/api/token/expire', {
      method: 'DELETE',
      headers: { 'X-frSIP-API-Token': token, 'Content-Type': 'application/json' },
      body: { username: username || '' },
      allowInvalidTLS,
    });
  } catch { /* best effort — token may have already expired */ }

  return res.json({ success: true, stopped: true });
}
