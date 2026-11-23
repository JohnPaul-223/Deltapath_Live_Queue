import https from 'https';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed.' });
  const { token, server, username, allowInvalidTLS = true } = req.body || {};
  if (!token || !server) return res.json({ success: true, stopped: true });
  try {
    const agent = new https.Agent({ rejectUnauthorized: !allowInvalidTLS });
    await fetch(`${server}/RESTful/index.php/v1/delete/api/token/expire`, {
      method: 'DELETE', agent,
      headers: { 'X-frSIP-API-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username || '' }),
    });
  } catch { /* best effort */ }
  return res.json({ success: true, stopped: true });
}
