import https from 'https';
import crypto from 'crypto';

function normalizeBase(value) {
  let base = String(value || '').trim();
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, '');
  return new URL(base).origin;
}

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

async function deltafetch(base, path, { method = 'GET', headers = {}, body, allowInvalidTLS = true } = {}) {
  const agent = new https.Agent({ rejectUnauthorized: !allowInvalidTLS });
  const url = `${base}${path}`;
  const opts = { method, headers, agent };
  if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body);

  const r = await fetch(url, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed.' });

  const { server, username, password, allowInvalidTLS = true } = req.body || {};
  if (!server || !username || !password)
    return res.status(400).json({ success: false, error: 'Server, username, and password are required.' });

  let base;
  try { base = normalizeBase(server); }
  catch { return res.status(400).json({ success: false, error: 'Enter a valid Deltapath server URL.' }); }

  try {
    const dataHash = md5(`${md5(password)}@deltapath`);
    const authRes = await deltafetch(base, '/RESTful/index.php/v1/post/api/token/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username, data: dataHash },
      allowInvalidTLS,
    });

    let token;
    if (authRes.data && typeof authRes.data === 'object') token = authRes.data.token;
    else {
      const m = String(authRes.data).match(/["']token["']\s*:\s*["']([^"']+)/i);
      if (m) token = m[1];
    }

    if (!token) {
      return res.status(authRes.status === 200 ? 401 : authRes.status).json({
        success: false,
        error: 'Live monitoring authentication failed. Check credentials and API permissions.',
        status: authRes.status,
      });
    }

    // Return the token to the client. The browser holds it in component state
    // and sends it back with every poll request — no server-side session needed.
    return res.json({ success: true, token, server: base, username });
  } catch (err) {
    return res.status(502).json({ success: false, error: `Could not reach the Deltapath server: ${err.code || err.message}` });
  }
}
