import https from 'https';

async function deltafetch(base, path, { headers = {}, allowInvalidTLS = true } = {}) {
  const agent = new https.Agent({ rejectUnauthorized: !allowInvalidTLS });
  const r = await fetch(`${base}${path}`, { headers, agent });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}

function parsePayload(data) {
  if (data && typeof data === 'object') return data;
  if (typeof data !== 'string') return {};
  try { return JSON.parse(data.trim()); } catch { return { parsedText: data.slice(0, 2000) }; }
}

function normalizeQueuePayload(data) {
  const p = parsePayload(data);
  const c = p.data && typeof p.data === 'object' ? p.data
    : p.list && typeof p.list === 'object' ? p.list
    : p.queues && typeof p.queues === 'object' ? p.queues
    : p;
  return c && typeof c === 'object' ? c : {};
}

function normalizeActiveCalls(data) {
  const p = parsePayload(data);
  if (Array.isArray(p)) return p;
  if (Array.isArray(p.data)) return p.data;
  if (Array.isArray(p.list)) return p.list;
  return [];
}

function summarize(data) {
  if (typeof data === 'string') return { preview: data.slice(0, 500) };
  if (data && typeof data === 'object') return { preview: JSON.stringify(data).slice(0, 500) };
  return { preview: '' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed.' });
  const { token, server, allowInvalidTLS = true } = req.body || {};
  if (!token || !server) return res.status(400).json({ success: false, error: 'token and server are required.' });
  const headers = { 'X-frSIP-API-Token': token, Accept: 'application/json, application/xml, text/xml' };
  try {
    const [queuesRes, activeRes, logsRes] = await Promise.all([
      deltafetch(server, '/RESTful/index.php/v1/get/callcentre/queue/status', { headers, allowInvalidTLS }),
      deltafetch(server, '/RESTful/index.php/v1/get/systemstatus/activecall/view/list', { headers, allowInvalidTLS }),
      deltafetch(server, '/RESTful/index.php/v1/get/reporting/queuecall/view/list/?start=0&limit=100', { headers, allowInvalidTLS }),
    ]);
    const queuePayload = normalizeQueuePayload(queuesRes.data);
    const activeCalls  = normalizeActiveCalls(activeRes.data);
    const queueEntries = Object.entries(queuePayload).filter(([, v]) => v && typeof v === 'object');
    const liveCalls = [], liveAgents = [];
    const liveStats = { calls: 0, completed: 0, abandoned: 0, holdTime: 0, talkTime: 0, serviceLevel: 0, serviceLevelPerf: 0 };
    for (const [queueId, queue] of queueEntries) {
      const callers = Array.isArray(queue.Caller) ? queue.Caller : (queue.Caller && typeof queue.Caller === 'object' ? [queue.Caller] : []);
      const members = Array.isArray(queue.Member) ? queue.Member : (queue.Member && typeof queue.Member === 'object' ? [queue.Member] : []);
      callers.forEach((caller, idx) => {
        const callerChannel = caller.Channel || caller.channel || '';
        const activeMatch = activeCalls.find(call => {
          const cv = call.caller || call.Caller || call.CallerIDNum || '';
          const chv = call.callerChannel || call.callerChannelName || call.callerchannel || '';
          return cv === caller.CallerIDNum || (callerChannel && String(chv).includes(callerChannel));
        });
        const assignedMember = activeMatch ? members.find(m => {
          const loc = m.Location || m.location || '', name = m.Name || m.name || '';
          const dest = activeMatch.destination || activeMatch.Destination || activeMatch.destinationChannel || '';
          return dest && (dest.includes(loc) || dest.includes(name));
        }) : null;
        const availableMember = assignedMember || members.find(m => ['1','2','0'].includes(String(m.Status ?? m.status))) || members[0] || null;
        liveCalls.push({
          caller:   caller.CallerIDNum || caller.CallerIDName || caller.Channel || 'Unknown',
          did:      caller.DialedNumber || caller.Queue || queueId,
          queue:    `Queue ${queueId}`,
          position: caller.Position || caller.position || String(idx + 1),
          agent:    assignedMember?.Name || assignedMember?.name || availableMember?.Name || availableMember?.name || 'Pending',
          agentExt: assignedMember?.Location || assignedMember?.location || availableMember?.Location || availableMember?.location || '-',
          wait:     caller.Wait ? `${caller.Wait}s` : caller.wait ? `${caller.wait}s` : '0s',
          status:   assignedMember ? 'Connected' : (activeMatch ? 'Ringing' : 'Waiting'),
        });
      });
      liveStats.calls        += Number(queue.Calls        || 0);
      liveStats.completed    += Number(queue.Completed    || 0);
      liveStats.abandoned    += Number(queue.Abandoned    || 0);
      liveStats.holdTime     += Number(queue.Holdtime     || 0);
      liveStats.talkTime     += Number(queue.TalkTime     || 0);
      liveStats.serviceLevel += Number(queue.ServiceLevel || 0);
      const perf = Number(queue.ServicelevelPerf || 0);
      if (Number.isFinite(perf)) liveStats.serviceLevelPerf = Math.max(liveStats.serviceLevelPerf, perf);
      members.forEach(member => {
        liveAgents.push({
          queueId,
          name:       member.Name     || member.name     || 'Unknown',
          location:   member.Location || member.location || '-',
          statusCode: String(member.Status ?? member.status ?? '5'),
          paused:     String(member.Paused  ?? member.paused  ?? '0') !== '0',
          callsTaken: Number(member.CallsTaken || 0),
          lastCall:   member.LastCall || '0',
        });
      });
    }
    for (const ac of activeCalls) {
      const caller = ac.caller || ac.Caller || ac.CallerIDNum || ac.CallerIDName || ac.Channel || 'Unknown';
      if (liveCalls.some(c => String(c.caller) === String(caller))) continue;
      liveCalls.push({
        caller, did: ac.dialedNumber || ac.DialedNumber || '-', queue: ac.queue || ac.Queue || 'Active',
        position: '-', agent: ac.agent || ac.Agent || ac.destination || 'Assigned',
        agentExt: ac.agentExt || ac.location || ac.Location || '-',
        wait: ac.wait ? `${ac.wait}s` : '0s', status: 'Connected',
      });
    }
    return res.json({
      success: true, timestamp: new Date().toISOString(),
      liveCall: liveCalls[0] || null, liveCalls,
      queues: summarize(queuesRes.data), activeCalls: summarize(activeRes.data), queueLogs: summarize(logsRes.data),
      statuses: { queues: queuesRes.status, activeCalls: activeRes.status, queueLogs: logsRes.status },
      liveAgents, liveStats,
    });
  } catch (err) {
    return res.status(502).json({ success: false, error: err.code || err.message });
  }
}
