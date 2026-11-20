import https from 'https';

async function deltafetch(base, path, { method = 'GET', headers = {}, allowInvalidTLS = true } = {}) {
  const agent = new https.Agent({ rejectUnauthorized: !allowInvalidTLS });
  const r = await fetch(`${base}${path}`, { method, headers, agent });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}

function summarizeResponse(data) {
  if (typeof data === 'string') {
    const countMatch = data.match(/["']count["']\s*:\s*(\d+)/i);
    return { preview: data.slice(0, 500), count: countMatch ? Number(countMatch[1]) : undefined };
  }
  if (data && typeof data === 'object') {
    const count = data.count ?? data.total ?? (Array.isArray(data.list) ? data.list.length : undefined);
    return { preview: JSON.stringify(data).slice(0, 500), count };
  }
  return { preview: '', count: undefined };
}

function parsePayload(data) {
  if (data && typeof data === 'object') return data;
  if (typeof data !== 'string') return {};
  const trimmed = data.trim();
  try { return JSON.parse(trimmed); } catch {}
  return { parsedText: trimmed.slice(0, 2000) };
}

function normalizeQueuePayload(data) {
  const payload = parsePayload(data);
  const candidates =
    payload.data   && typeof payload.data   === 'object' ? payload.data   :
    payload.list   && typeof payload.list   === 'object' ? payload.list   :
    payload.queues && typeof payload.queues === 'object' ? payload.queues :
    payload;
  return candidates && typeof candidates === 'object' ? candidates : {};
}

function normalizeActiveCalls(data) {
  const payload = parsePayload(data);
  if (Array.isArray(payload))       return payload;
  if (Array.isArray(payload.data))  return payload.data;
  if (Array.isArray(payload.list))  return payload.list;
  return [];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed.' });

  const { token, server, allowInvalidTLS = true } = req.body || {};
  if (!token || !server)
    return res.status(400).json({ success: false, error: 'token and server are required.' });

  const headers = { 'X-frSIP-API-Token': token, Accept: 'application/json, application/xml, text/xml' };

  try {
    const [queuesRes, activeRes, logsRes] = await Promise.all([
      deltafetch(server, '/RESTful/index.php/v1/get/callcentre/queue/status',                              { headers, allowInvalidTLS }),
      deltafetch(server, '/RESTful/index.php/v1/get/systemstatus/activecall/view/list',                   { headers, allowInvalidTLS }),
      deltafetch(server, '/RESTful/index.php/v1/get/reporting/queuecall/view/list/?start=0&limit=100',    { headers, allowInvalidTLS }),
    ]);

    const queuePayload  = normalizeQueuePayload(queuesRes.data);
    const activeCalls   = normalizeActiveCalls(activeRes.data);
    const queueEntries  = Object.entries(queuePayload).filter(([, v]) => v && typeof v === 'object');

    const liveCalls  = [];
    const liveAgents = [];
    const liveStats  = { calls: 0, completed: 0, abandoned: 0, holdTime: 0, talkTime: 0, serviceLevel: 0, serviceLevelPerf: 0 };

    for (const [queueId, queue] of queueEntries) {
      const callers = Array.isArray(queue.Caller) ? queue.Caller
        : (queue.Caller && typeof queue.Caller === 'object' ? [queue.Caller] : []);
      const members = Array.isArray(queue.Member) ? queue.Member
        : (queue.Member && typeof queue.Member === 'object' ? [queue.Member] : []);

      callers.forEach((caller, idx) => {
        const callerChannel = caller.Channel || caller.channel || '';
        const activeMatch = activeCalls.find((call) => {
          const callerVal  = call.caller || call.Caller || call.CallerIDNum || '';
          const channelVal = call.callerChannel || call.callerChannelName || call.callerchannel || '';
          return callerVal === caller.CallerIDNum || (callerChannel && String(channelVal).includes(callerChannel));
        });
        const assignedMember = activeMatch
          ? members.find((m) => {
              const loc  = m.Location || m.location || '';
              const name = m.Name || m.name || '';
              const dest = activeMatch.destination || activeMatch.Destination || activeMatch.destinationChannel || '';
              return dest && (dest.includes(loc) || dest.includes(name));
            })
          : null;
        const availableMember = assignedMember
          || members.find((m) => ['1', '2', '0'].includes(String(m.Status ?? m.status)))
          || members[0]
          || null;

        liveCalls.push({
          caller:   caller.CallerIDNum || caller.CallerIDName || caller.Channel || 'Unknown caller',
          did:      caller.DialedNumber || caller.Queue || queueId,
          queue:    `Queue ${queueId}`,
          position: caller.Position || caller.position || String(idx + 1),
          agent:    assignedMember?.Name || assignedMember?.name || availableMember?.Name || availableMember?.name || 'Pending assignment',
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

      members.forEach((member) => {
        liveAgents.push({
          queueId,
          name:       member.Name     || member.name     || 'Unknown agent',
          location:   member.Location || member.location || '-',
          statusCode: String(member.Status ?? member.status ?? '5'),
          paused:     String(member.Paused  ?? member.paused  ?? '0') !== '0',
          callsTaken: Number(member.CallsTaken || 0),
          lastCall:   member.LastCall || '0',
        });
      });
    }

    // Merge in any active calls not already in the queue list
    for (const activeCall of activeCalls) {
      const caller = activeCall.caller || activeCall.Caller || activeCall.CallerIDNum || activeCall.CallerIDName || activeCall.Channel || 'Unknown caller';
      if (liveCalls.some((c) => String(c.caller) === String(caller))) continue;
      liveCalls.push({
        caller,
        did:      activeCall.dialedNumber || activeCall.DialedNumber || activeCall.did || '-',
        queue:    activeCall.queue        || activeCall.Queue        || 'Active queue',
        position: '-',
        agent:    activeCall.agent || activeCall.Agent || activeCall.destination || 'Agent assigned',
        agentExt: activeCall.agentExt || activeCall.location || activeCall.Location || '-',
        wait:     activeCall.wait ? `${activeCall.wait}s` : '0s',
        status:   'Connected',
      });
    }

    return res.json({
      success:    true,
      timestamp:  new Date().toISOString(),
      liveCall:   liveCalls[0] || null,
      liveCalls,
      queues:     summarizeResponse(queuesRes.data),
      activeCalls: summarizeResponse(activeRes.data),
      queueLogs:  summarizeResponse(logsRes.data),
      statuses:   { queues: queuesRes.status, activeCalls: activeRes.status, queueLogs: logsRes.status },
      diagnostics: { queuePayloadKeys: Object.keys(queuePayload).slice(0, 30), activeCallCount: activeCalls.length },
      liveAgents,
      liveStats,
    });
  } catch (err) {
    return res.status(502).json({ success: false, error: err.code || err.message });
  }
}
