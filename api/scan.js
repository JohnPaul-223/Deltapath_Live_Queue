import https from 'https';
import crypto from 'crypto';

const probes = [
  { id: 'acl-users',    group: 'ACL',          label: 'ACL users',         method: 'GET', path: '/RESTful/index.php/v1/get/acl/user/view/list?start=0&limit=100' },
  { id: 'acl-groups',   group: 'ACL',          label: 'ACL groups',        method: 'GET', path: '/RESTful/index.php/v1/get/acl/group/view/list?start=0&limit=100' },
  { id: 'users',        group: 'Users',        label: 'System users',      method: 'GET', path: '/RESTful/index.php/v1/get/user/view/list?start=0&limit=100' },
  { id: 'extensions',   group: 'Extensions',   label: 'Extension numbers', method: 'GET', path: '/RESTful/index.php/v1/get/numberingplan/number/view/list?start=0&limit=100' },
  { id: 'call-routing', group: 'Routing',      label: 'Outbound routing',  method: 'GET', path: '/RESTful/index.php/v1/get/numberingplan/outboundrouting/view/list?start=0&limit=100' },
  { id: 'ivr',          group: 'IVR',          label: 'IVR menus',         method: 'GET', path: '/RESTful/index.php/v1/get/ivr/menu/view/list?start=0&limit=100' },
  { id: 'queues',       group: 'Call Center',  label: 'Queues',            method: 'GET', path: '/RESTful/index.php/v1/get/queue/view/list?start=0&limit=100' },
  { id: 'agents',       group: 'Call Center',  label: 'Agents',            method: 'GET', path: '/RESTful/index.php/v1/get/agent/view/list?start=0&limit=100' },
  { id: 'conferences',  group: 'Conference',   label: 'Conferences',       method: 'GET', path: '/RESTful/index.php/v1/get/conference/view/list?start=0&limit=100' },
  { id: 'trunks',       group: 'Gateways',     label: 'SIP peers',         method: 'GET', path: '/RESTful/index.php/v1/get/gateway/sippeers/view/list?start=0&limit=100' },
  { id: 'servers',      group: 'System',       label: 'All server info',   method: 'GET', path: '/RESTful/index.php/v1/get/configuration/allserverinfo/view/list?start=0&limit=100' },
  { id: 'license',      group: 'System',       label: 'License data',      method: 'GET', path: '/RESTful/index.php/v1/get/license/view/license' },
];

function normalizeBase(value) {
  let base = String(value || '').trim();
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, '');
  return new URL(base).origin;
}

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function summarizeResponse(data) {
  if (typeof data === 'string') {
    const countMatch = data.match(/["']count["']\s*:\s*(\d+)/i);
    const listMatch  = data.match(/["']list["']\s*:/i);
    return { preview: data.slice(0, 500), count: countMatch ? Number(countMatch[1]) : (listMatch ? null : undefined) };
  }
  if (data && typeof data === 'object') {
    const count = data.count ?? data.total ?? (Array.isArray(data.list) ? data.list.length : undefined);
    return { preview: JSON.stringify(data).slice(0, 500), count };
  }
  return { preview: '', count: undefined };
}

/** Minimal fetch wrapper that handles self-signed TLS and parses JSON/text. */
async function deltafetch(base, path, { method = 'GET', headers = {}, body, allowInvalidTLS = true } = {}) {
  const agent = new https.Agent({ rejectUnauthorized: !allowInvalidTLS });
  const url = `${base}${path}`;
  const opts = { method, headers, agent };
  if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body);

  const r = await fetch(url, opts);
  let data;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('json') || ct.includes('xml') || ct.includes('text')) {
    const text = await r.text();
    try { data = JSON.parse(text); } catch { data = text; }
  } else {
    data = await r.text();
  }
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
        error: 'Authentication failed. Check the server address, ACL username, password, and API permissions.',
        status: authRes.status,
        response: summarizeResponse(authRes.data),
      });
    }

    const apiHeaders = { 'X-frSIP-API-Token': token, Accept: 'application/json, application/xml, text/xml' };
    const results = [];
    for (const probe of probes) {
      if (String(probe.method).toUpperCase() !== 'GET') {
        results.push({ ...probe, status: 0, ok: false, error: 'Blocked: non-GET probe', preview: '' });
        continue;
      }
      try {
        const r = await deltafetch(base, probe.path, { method: probe.method, headers: apiHeaders, allowInvalidTLS });
        const ok = r.status >= 200 && r.status < 300;
        results.push({ ...probe, status: r.status, ok, ...summarizeResponse(r.data) });
      } catch (err) {
        results.push({ ...probe, status: 0, ok: false, error: err.code || err.message, preview: '' });
      }
    }

    let tokenExpired = false;
    try {
      await deltafetch(base, '/RESTful/index.php/v1/delete/api/token/expire', {
        method: 'DELETE',
        headers: { 'X-frSIP-API-Token': token, 'Content-Type': 'application/json' },
        body: { username },
        allowInvalidTLS,
      });
      tokenExpired = true;
    } catch { /* best effort */ }

    const accessible = results.filter((r) => r.ok).length;
    return res.json({ success: true, server: base, username, readOnly: true, tokenExpired, accessible, total: results.length, results });
  } catch (err) {
    return res.status(502).json({ success: false, error: `Could not reach the Deltapath server: ${err.code || err.message}` });
  }
}
