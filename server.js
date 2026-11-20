const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const probes = [
  // Read-only discovery endpoints only. No create, update, delete, restart, or configuration operations are called.
  { id: 'acl-users', group: 'ACL', label: 'ACL users', method: 'GET', path: '/RESTful/index.php/v1/get/acl/user/view/list?start=0&limit=100' },
  { id: 'acl-groups', group: 'ACL', label: 'ACL groups', method: 'GET', path: '/RESTful/index.php/v1/get/acl/group/view/list?start=0&limit=100' },
  { id: 'users', group: 'Users', label: 'System users', method: 'GET', path: '/RESTful/index.php/v1/get/user/view/list?start=0&limit=100' },
  { id: 'extensions', group: 'Extensions', label: 'Extension numbers', method: 'GET', path: '/RESTful/index.php/v1/get/numberingplan/number/view/list?start=0&limit=100' },
  { id: 'call-routing', group: 'Routing', label: 'Outbound routing', method: 'GET', path: '/RESTful/index.php/v1/get/numberingplan/outboundrouting/view/list?start=0&limit=100' },
  { id: 'ivr', group: 'IVR', label: 'IVR menus', method: 'GET', path: '/RESTful/index.php/v1/get/ivr/menu/view/list?start=0&limit=100' },
  { id: 'queues', group: 'Call Center', label: 'Queues', method: 'GET', path: '/RESTful/index.php/v1/get/queue/view/list?start=0&limit=100' },
  { id: 'agents', group: 'Call Center', label: 'Agents', method: 'GET', path: '/RESTful/index.php/v1/get/agent/view/list?start=0&limit=100' },
  { id: 'conferences', group: 'Conference', label: 'Conferences', method: 'GET', path: '/RESTful/index.php/v1/get/conference/view/list?start=0&limit=100' },
  { id: 'trunks', group: 'Gateways', label: 'SIP peers', method: 'GET', path: '/RESTful/index.php/v1/get/gateway/sippeers/view/list?start=0&limit=100' },
  { id: 'servers', group: 'System', label: 'All server info', method: 'GET', path: '/RESTful/index.php/v1/get/configuration/allserverinfo/view/list?start=0&limit=100' },
  { id: 'license', group: 'System', label: 'License data', method: 'GET', path: '/RESTful/index.php/v1/get/license/view/license' }
];

function normalizeBase(value) {
  let base = String(value || '').trim();
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, '');
  const url = new URL(base);
  return url.origin;
}

function md5(value) { return crypto.createHash('md5').update(value).digest('hex'); }

function summarizeResponse(data) {
  if (typeof data === 'string') {
    const countMatch = data.match(/["']count["']\s*:\s*(\d+)/i);
    const listMatch = data.match(/["']list["']\s*:/i);
    return { preview: data.slice(0, 500), count: countMatch ? Number(countMatch[1]) : (listMatch ? null : undefined) };
  }
  if (data && typeof data === 'object') {
    const count = data.count ?? data.total ?? (Array.isArray(data.list) ? data.list.length : undefined);
    return { preview: JSON.stringify(data).slice(0, 500), count };
  }
  return { preview: '', count: undefined };
}

app.get('/api/guide', (_req, res) => {
  res.json({ title: 'Deltapath UC 5.3.1', authPath: '/RESTful/index.php/v1/post/api/token/request', readOnly: true, mutatingRequestsBlocked: true, probeCount: probes.length });
});

app.post('/api/scan', async (req, res) => {
  const { server, username, password, allowInvalidTLS = true } = req.body;
  if (!server || !username || !password) return res.status(400).json({ success: false, error: 'Server, username, and password are required.' });

  let base;
  try { base = normalizeBase(server); } catch { return res.status(400).json({ success: false, error: 'Enter a valid Deltapath server URL.' }); }

  const httpsAgent = new https.Agent({ rejectUnauthorized: allowInvalidTLS === false });
  const client = axios.create({ baseURL: base, timeout: 15000, validateStatus: () => true, maxRedirects: 5, httpsAgent });

  try {
    const dataHash = md5(`${md5(password)}@deltapath`);
    const authUrl = '/RESTful/index.php/v1/post/api/token/request';
    const authResponse = await client.post(authUrl, { username, data: dataHash }, { headers: { 'Content-Type': 'application/json' } });

    let token;
    if (typeof authResponse.data === 'object') token = authResponse.data.token;
    else {
      const tokenMatch = String(authResponse.data).match(/["']token["']\s*:\s*["']([^"']+)/i);
      if (tokenMatch) token = tokenMatch[1];
    }

    if (!token) {
      return res.status(authResponse.status === 200 ? 401 : authResponse.status).json({
        success: false,
        error: 'Authentication failed. Check the server address, ACL username, password, and API permissions.',
        status: authResponse.status,
        response: summarizeResponse(authResponse.data)
      });
    }

    const results = [];
    for (const probe of probes) {
      if (String(probe.method).toUpperCase() !== 'GET') {
        results.push({ ...probe, status: 0, ok: false, error: 'Blocked: non-GET probe', preview: '' });
        continue;
      }
      try {
        const response = await client.request({
          method: probe.method,
          url: probe.path,
          headers: { 'X-frSIP-API-Token': token, 'Accept': 'application/json, application/xml, text/xml' }
        });
        const ok = response.status >= 200 && response.status < 300;
        results.push({ ...probe, status: response.status, ok, ...summarizeResponse(response.data) });
      } catch (error) {
        results.push({ ...probe, status: 0, ok: false, error: error.code || error.message, preview: '' });
      }
    }

    let tokenExpired = false;
    try {
      await client.request({
        method: 'DELETE',
        url: '/RESTful/index.php/v1/delete/api/token/expire',
        headers: { 'X-frSIP-API-Token': token, 'Content-Type': 'application/json' },
        data: { username }
      });
      tokenExpired = true;
    } catch {
      tokenExpired = false;
    }

    const accessible = results.filter(r => r.ok).length;
    res.json({ success: true, server: base, username, readOnly: true, tokenExpired, accessible, total: results.length, results });
  } catch (error) {
    res.status(502).json({ success: false, error: `Could not reach the Deltapath server: ${error.code || error.message}` });
  }
});

const liveSessions = new Map();

app.post('/api/live/start', async (req, res) => {
  const { server, username, password, allowInvalidTLS = true } = req.body;
  if (!server || !username || !password) return res.status(400).json({ success: false, error: 'Server, username, and password are required.' });

  let base;
  try { base = normalizeBase(server); } catch { return res.status(400).json({ success: false, error: 'Enter a valid Deltapath server URL.' }); }

  const httpsAgent = new https.Agent({ rejectUnauthorized: allowInvalidTLS === false });
  const client = axios.create({ baseURL: base, timeout: 15000, validateStatus: () => true, httpsAgent });
  try {
    const dataHash = md5(`${md5(password)}@deltapath`);
    const authResponse = await client.post('/RESTful/index.php/v1/post/api/token/request', { username, data: dataHash }, { headers: { 'Content-Type': 'application/json' } });
    const token = typeof authResponse.data === 'object' ? authResponse.data.token : String(authResponse.data).match(/["']token["']\s*:\s*["']([^"']+)/i)?.[1];
    if (!token) return res.status(authResponse.status === 200 ? 401 : authResponse.status).json({ success: false, error: 'Live monitoring authentication failed.' });

    const id = crypto.randomBytes(16).toString('hex');
    liveSessions.set(id, { client, token, username, base, createdAt: Date.now() });
    res.json({ success: true, sessionId: id, server: base });
  } catch (error) {
    res.status(502).json({ success: false, error: `Could not reach the Deltapath server: ${error.code || error.message}` });
  }
});

app.get('/api/live/:id', async (req, res) => {
  const session = liveSessions.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Live monitoring session is not active.' });

  const headers = { 'X-frSIP-API-Token': session.token, Accept: 'application/json, application/xml, text/xml' };
  try {
    const [queuesResponse, activeResponse, logsResponse] = await Promise.all([
      session.client.get('/RESTful/index.php/v1/get/callcentre/queue/status', { headers }),
      session.client.get('/RESTful/index.php/v1/get/systemstatus/activecall/view/list', { headers }),
      session.client.get('/RESTful/index.php/v1/get/reporting/queuecall/view/list/?start=0&limit=100', { headers })
    ]);

    const queuePayload = normalizeQueuePayload(queuesResponse.data);
    const activeCalls = normalizeActiveCalls(activeResponse.data);
    const queueEntries = Object.entries(queuePayload).filter(([, value]) => value && typeof value === 'object');
    let liveCall = null;
    const liveCalls = [];
    const liveAgents = [];
    const liveStats = { calls: 0, completed: 0, abandoned: 0, holdTime: 0, talkTime: 0, serviceLevel: 0, serviceLevelPerf: 0 };
    for (const [queueId, queue] of queueEntries) {
      const callers = Array.isArray(queue.Caller) ? queue.Caller : (queue.Caller && typeof queue.Caller === 'object' ? [queue.Caller] : []);
      const members = Array.isArray(queue.Member) ? queue.Member : (queue.Member && typeof queue.Member === 'object' ? [queue.Member] : []);
      callers.forEach((caller, callerIndex) => {
        const callerChannel = caller.Channel || caller.channel || '';
        const activeMatch = activeCalls.find(call => {
          const callerValue = call.caller || call.Caller || call.CallerIDNum || '';
          const channelValue = call.callerChannel || call.callerChannelName || call.callerchannel || '';
          return callerValue === caller.CallerIDNum || (callerChannel && String(channelValue).includes(callerChannel));
        });
        const assignedMember = activeMatch ? members.find(member => {
          const location = member.Location || member.location || '';
          const name = member.Name || member.name || '';
          const destination = activeMatch.destination || activeMatch.Destination || activeMatch.destinationChannel || '';
          return destination && (destination.includes(location) || destination.includes(name));
        }) : null;
        const availableMember = assignedMember || members.find(m => ['1','2','0'].includes(String(m.Status ?? m.status))) || members[0] || null;
        const item = {
          caller: caller.CallerIDNum || caller.CallerIDName || caller.Channel || 'Unknown caller',
          did: caller.DialedNumber || caller.Queue || queueId,
          queue: `Queue ${queueId}`,
          position: caller.Position || caller.position || String(callerIndex + 1),
          agent: assignedMember?.Name || assignedMember?.name || (availableMember?.Name || availableMember?.name) || 'Pending assignment',
          agentExt: assignedMember?.Location || assignedMember?.location || (availableMember?.Location || availableMember?.location) || '-',
          wait: caller.Wait ? `${caller.Wait}s` : caller.wait ? `${caller.wait}s` : '0s',
          status: assignedMember ? 'Connected' : (activeMatch ? 'Ringing' : 'Waiting')
        };
        liveCalls.push(item);
      });
      liveStats.calls += Number(queue.Calls || 0);
      liveStats.completed += Number(queue.Completed || 0);
      liveStats.abandoned += Number(queue.Abandoned || 0);
      liveStats.holdTime += Number(queue.Holdtime || 0);
      liveStats.talkTime += Number(queue.TalkTime || 0);
      liveStats.serviceLevel += Number(queue.ServiceLevel || 0);
      const perf = Number(queue.ServicelevelPerf || 0);
      if (Number.isFinite(perf)) liveStats.serviceLevelPerf = Math.max(liveStats.serviceLevelPerf, perf);
      members.forEach(member => {
        const statusCode = String(member.Status ?? member.status ?? '5');
        const paused = String(member.Paused ?? member.paused ?? '0') !== '0';
        liveAgents.push({
          queueId,
          name: member.Name || member.name || 'Unknown agent',
          location: member.Location || member.location || '-',
          statusCode,
          paused,
          callsTaken: Number(member.CallsTaken || 0),
          lastCall: member.LastCall || '0'
        });
      });
    }
    if (!liveCall && liveCalls.length) liveCall = liveCalls[0];

    for (const activeCall of activeCalls) {
      const caller = activeCall.caller || activeCall.Caller || activeCall.CallerIDNum || activeCall.CallerIDName || activeCall.Channel || 'Unknown caller';
      const alreadyListed = liveCalls.some(call => String(call.caller) === String(caller));
      if (alreadyListed) continue;
      liveCalls.push({
        caller,
        did: activeCall.dialedNumber || activeCall.DialedNumber || activeCall.did || '-',
        queue: activeCall.queue || activeCall.Queue || 'Active queue',
        position: '-',
        agent: activeCall.agent || activeCall.Agent || activeCall.destination || 'Agent assigned',
        agentExt: activeCall.agentExt || activeCall.location || activeCall.Location || '-',
        wait: activeCall.wait ? `${activeCall.wait}s` : '0s',
        status: 'Connected'
      });
    }

    if (!liveCall && liveCalls.length) liveCall = liveCalls[0];

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      liveCall,
      liveCalls,
      queues: summarizeResponse(queuesResponse.data),
      activeCalls: summarizeResponse(activeResponse.data),
      queueLogs: summarizeResponse(logsResponse.data),
      statuses: { queues: queuesResponse.status, activeCalls: activeResponse.status, queueLogs: logsResponse.status },
      diagnostics: { queuePayloadKeys: Object.keys(queuePayload).slice(0, 30), activeCallCount: activeCalls.length },
      liveAgents,
      liveStats
    });
  } catch (error) {
    res.status(502).json({ success: false, error: error.code || error.message });
  }
});

app.post('/api/live/:id/stop', async (req, res) => {
  const session = liveSessions.get(req.params.id);
  if (!session) return res.json({ success: true, stopped: true });
  try {
    await session.client.request({
      method: 'DELETE',
      url: '/RESTful/index.php/v1/delete/api/token/expire',
      headers: { 'X-frSIP-API-Token': session.token, 'Content-Type': 'application/json' },
      data: { username: session.username }
    });
  } catch {}
  liveSessions.delete(req.params.id);
  res.json({ success: true, stopped: true });
});

app.get('/hotline-call-flow.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'hotline-call-flow.html'));
});

app.use(express.static(path.join(__dirname, 'dist')));
app.use((_req, res) => {
  if (process.env.NODE_ENV === 'production') res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  else res.status(404).json({ error: 'Not found' });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`Deltapath API Mapper listening on http://127.0.0.1:${port}`));

function parsePayload(data) {
  if (data && typeof data === 'object') return data;
  if (typeof data !== 'string') return {};
  const trimmed = data.trim();
  try { return JSON.parse(trimmed); } catch {}
  const queueIdMatches = [...trimmed.matchAll(/["']?(\d+)["']?\s*[:=]\s*\{([^{}]*\{[^{}]*\}[^{}]*|[^{}]*)\}/g)];
  if (queueIdMatches.length) return { parsedText: trimmed.slice(0, 2000), queueIdMatches: queueIdMatches.length };
  return { parsedText: trimmed.slice(0, 2000) };
}

function normalizeQueuePayload(data) {
  const payload = parsePayload(data);
  const candidates = payload.data && typeof payload.data === 'object' ? payload.data
    : payload.list && typeof payload.list === 'object' ? payload.list
    : payload.queues && typeof payload.queues === 'object' ? payload.queues
    : payload;
  return candidates && typeof candidates === 'object' ? candidates : {};
}

function normalizeActiveCalls(data) {
  const payload = parsePayload(data);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.list)) return payload.list;
  return [];
}
