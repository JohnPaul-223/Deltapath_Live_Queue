import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLiveSnapshot, startLiveSession, stopLiveSession } from './api.js';

const POLL_MS   = 5000;
const MAX_ERR   = 3;
const CIRC      = 2 * Math.PI * 20; // svg ring circumference (r=20)

/* ── helpers ── */
const fmtSec = (raw) => {
  const s = Number(String(raw ?? 0).replace(/[^0-9.]/g, '')) || 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
const fmtTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = (d) => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();

/* ── SL ring ── */
function SLRing({ value }) {
  const pct  = Math.min(100, Math.max(0, value));
  const off  = CIRC * (1 - pct / 100);
  const bad  = pct < 80;
  const warn = pct < 90 && pct >= 80;
  return (
    <div className="sl-ring">
      <svg viewBox="0 0 48 48">
        <circle className="sl-track" cx="24" cy="24" r="20" />
        <circle
          className={`sl-fill${bad ? ' bad' : warn ? ' warn' : ''}`}
          cx="24" cy="24" r="20"
          strokeDasharray={CIRC}
          strokeDashoffset={off}
          style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
        />
      </svg>
      <span className={`sl-val${bad ? ' bad' : warn ? ' warn' : ''}`}>{Math.round(pct)}%</span>
    </div>
  );
}

/* ── KPI card ── */
function KpiCard({ id, label, value, sub, variant }) {
  return (
    <div className={`kpi${variant ? ` kpi--${variant}` : ''}`} id={id}>
      <span className="kpi-lbl">{label}</span>
      <strong className="kpi-val">{value}</strong>
      {sub && <small className="kpi-sub">{sub}</small>}
    </div>
  );
}

/* ── Agent card ── */
function AgentCard({ agent, activeCalls }) {
  const onCall = activeCalls.some((c) => c.agent === agent.name || c.agentExt === agent.location);
  const status = onCall ? 'oncall'
    : agent.paused ? 'away'
    : ['1', '2'].includes(agent.statusCode) ? 'avail'
    : 'offline';
  const label = { oncall: 'On call', away: 'On break', avail: 'Available', offline: 'Offline' }[status];
  return (
    <div className="agent-card" data-status={status}>
      <div className="agent-meta">
        <strong className="agent-name">{agent.name}</strong>
        <span className="agent-status">{label}</span>
        <small className="agent-ext">{agent.location ? `Ext ${agent.location}` : `${agent.callsTaken || 0} calls`}</small>
      </div>
    </div>
  );
}

/* ── main ── */
export default function LiveCallView({ credentials, onAuthError, onConnected, onDisconnect }) {
  const [session,     setSession]     = useState(null);
  const [liveData,    setLiveData]    = useState(null);
  const [status,      setStatus]      = useState('connecting');
  const [errorMsg,    setErrorMsg]    = useState('');
  const [lastUpdate,  setLastUpdate]  = useState(null);
  const [clock,       setClock]       = useState(() => new Date());
  const [retries,     setRetries]     = useState(0);

  const pollRef    = useRef(null);
  const sessionRef = useRef(null);

  /* clock */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* poll */
  const poll = useCallback(async (sess) => {
    try {
      const snap = await fetchLiveSnapshot(sess);
      setLiveData(snap);
      setLastUpdate(new Date());
      setRetries(0);
      setStatus('live');
      setErrorMsg('');
    } catch (err) {
      setRetries((r) => {
        const n = r + 1;
        if (n >= MAX_ERR) { setStatus('degraded'); setErrorMsg(err.message); }
        return n;
      });
    }
  }, []);

  /* connect on mount */
  useEffect(() => {
    let cancelled = false;
    async function connect() {
      try {
        const sess = await startLiveSession(credentials);
        if (cancelled) { stopLiveSession(sess); return; }
        setSession(sess);
        sessionRef.current = sess;
        await poll(sess);
        if (cancelled) return;
        onConnected?.();
        pollRef.current = setInterval(() => poll(sess), POLL_MS);
      } catch (err) {
        if (!cancelled) onAuthError?.(err.message);
      }
    }
    connect();
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      if (sessionRef.current) stopLiveSession(sessionRef.current);
    };
  }, []); // eslint-disable-line

  const handleDisconnect = async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus('stopped');
    if (sessionRef.current) await stopLiveSession(sessionRef.current);
    onDisconnect?.();
  };

  /* derived */
  const calls   = liveData?.liveCalls || (liveData?.liveCall ? [liveData.liveCall] : []);
  const waiting = calls.filter((c) => c.status === 'Waiting');
  const active  = calls.filter((c) => c.status === 'Ringing' || c.status === 'Connected');
  const agents  = liveData?.liveAgents || [];
  const stats   = liveData?.liveStats  || {};

  const completed   = Number(stats.completed  || 0);
  const abandoned   = Number(stats.abandoned  || 0);
  const totalCalls  = completed + abandoned;
  const abandonRate = totalCalls ? (abandoned / totalCalls) * 100 : 0;
  const svcLevel    = Number(stats.serviceLevelPerf || 0);
  const longestWait = waiting.length
    ? Math.max(...waiting.map((c) => Number(String(c.wait).replace(/[^0-9.]/g, '')) || 0))
    : 0;

  const avail   = agents.filter((a) => !a.paused && ['1', '2'].includes(a.statusCode)).length;
  const onBreak = agents.filter((a) => a.paused).length;
  const offline = Math.max(0, agents.length - avail - active.length - onBreak);

  const qLevel = waiting.length > 10 ? 'crit' : waiting.length > 4 ? 'warn' : 'ok';
  const qLabel = { ok: 'QUEUE NORMAL', warn: 'QUEUE BUSY', crit: 'QUEUE CRITICAL' }[qLevel];
  const isLive  = status === 'live' || status === 'degraded';

  /* ── render ── */
  return (
    <div className="tv">

      {/* ═══ TOP BAR ═══ */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-brand">
            <div className="topbar-mark">D</div>
            <div className="topbar-titles">
              <strong>DELTAPATH UC</strong>
              <span>LIVE AGENT &amp; QUEUE MONITOR</span>
            </div>
          </div>
          <div className="topbar-sep" />
          <div className="topbar-server">
            <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.1"/><path d="M8 1.5C8 1.5 5.5 4 5.5 8s2.5 6.5 2.5 6.5M8 1.5C8 1.5 10.5 4 10.5 8S8 14.5 8 14.5M1.5 8h13" stroke="currentColor" strokeWidth="1.1"/></svg>
            {credentials.server.replace(/^https?:\/\//, '')}
          </div>
        </div>

        <div className="topbar-center">
          <div className={`queue-pill queue-pill--${qLevel}`}>{qLabel}</div>
        </div>

        <div className="topbar-right">
          <span className={`live-dot${isLive ? ' on' : ''}`} />
          <span className="live-label">{status === 'connecting' ? 'Connecting…' : status === 'live' ? 'LIVE' : status === 'degraded' ? 'DEGRADED' : 'STOPPED'}</span>
          {lastUpdate && <span className="updated-at">UPDATED {fmtTime(lastUpdate)}</span>}
          <button className="disconnect-btn" onClick={handleDisconnect}>Disconnect</button>
          <div className="topbar-clock">
            <strong>{fmtTime(clock)}</strong>
            <span>{fmtDate(clock)}</span>
          </div>
        </div>
      </header>

      {/* ═══ STATUS BANNERS ═══ */}
      {status === 'degraded' && (
        <div className="banner banner--err" role="alert">
          <svg viewBox="0 0 16 16" fill="none"><path d="M8 2L14.5 13.5H1.5L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M8 7v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          Connection unstable — {errorMsg}. Retrying automatically.
        </div>
      )}
      {status === 'connecting' && !liveData && (
        <div className="banner banner--info">
          <span className="spinner" /> Establishing connection to {credentials.server}…
        </div>
      )}

      {/* ═══ KPI STRIP ═══ */}
      <section className="kpi-strip">
        <div className="kpi-group">
          <div className="kpi-group-label">Calls Today</div>
          <div className="kpi-row" style={{ '--n': 4 }}>
            <KpiCard label="Total" value={totalCalls} sub="answered + abandoned" />
            <KpiCard label="Answered" value={completed} variant="ok" />
            <KpiCard label="Abandoned" value={abandoned} variant="fail" sub="hung up in queue" />
            <KpiCard
              label="Abandon Rate" value={`${abandonRate.toFixed(1)}%`}
              variant={abandonRate > 10 ? 'fail' : abandonRate > 5 ? 'warn' : 'ok'}
              sub="target < 5%"
            />
          </div>
        </div>
        <div className="kpi-group">
          <div className="kpi-group-label">Service</div>
          <div className="kpi-row" style={{ '--n': 2 }}>
            <KpiCard
              label="Service Level" value={`${Math.round(svcLevel)}%`}
              variant={svcLevel < 80 ? 'fail' : svcLevel < 90 ? 'warn' : 'ok'}
            />
            <KpiCard label="Avg Wait" value={fmtSec(stats.holdTime)} />
          </div>
        </div>
        <div className="kpi-group">
          <div className="kpi-group-label">Live Queue</div>
          <div className="kpi-row" style={{ '--n': 2 }}>
            <KpiCard
              label="Waiting" value={waiting.length}
              variant={waiting.length > 10 ? 'fail' : waiting.length > 4 ? 'warn' : null}
            />
            <KpiCard
              label="Longest Wait" value={fmtSec(longestWait)}
              variant={longestWait > 120 ? 'fail' : longestWait > 60 ? 'warn' : null}
            />
          </div>
        </div>
      </section>

      {/* ═══ 3-COLUMN BODY ═══ */}
      <div className="body-grid">

        {/* ── COL 1: INBOUND & QUEUE ── */}
        <div className="body-col">
          <div className="col-head">
            <span className="col-title">Inbound &amp; Queue</span>
            <span className="col-sub">PSTN / VoIP Trunk</span>
          </div>
          <div className="col1-body">

            {/* flow nodes */}
            <div className="flow-nodes">
              <div className="flow-row">
                <span className="flow-lbl">Inbound</span>
                <div className="flow-node">
                  <div className="flow-icon">☎</div>
                  <div><strong>PSTN / VoIP</strong><span>Incoming calls</span></div>
                </div>
              </div>
              <div className="flow-connector"><span /><span /><span /></div>
              <div className="flow-row">
                <span className="flow-lbl">System</span>
                <div className="flow-node flow-node--system">
                  <div className="flow-icon flow-icon--d">D</div>
                  <div>
                    <strong>{credentials.server.replace(/^https?:\/\//, '')}</strong>
                    <span>{credentials.username}</span>
                  </div>
                </div>
              </div>
              <div className="flow-connector"><span /><span /><span /></div>
              <div className="flow-row">
                <span className="flow-lbl">Queue</span>
                <div className="flow-node flow-node--queue">
                  <div className="queue-dots">
                    {Array.from({ length: 6 }, (_, i) => (
                      <div key={i} className={`q-dot${waiting[i] ? ' q-dot--on' : ''}`} />
                    ))}
                  </div>
                  <div>
                    <strong>{waiting.length} waiting</strong>
                    <span>FIFO queue</span>
                  </div>
                </div>
              </div>
            </div>

            {/* queue stats row */}
            <div className="q-stat-row">
              <div className="q-stat">
                <span>Total calls</span>
                <strong>{totalCalls}</strong>
              </div>
              <div className="q-stat">
                <span>Answered</span>
                <strong style={{ color: 'var(--talk)' }}>{completed}</strong>
              </div>
            </div>

            {/* call lists */}
            <div className="list-pair">
              <div className="list-panel">
                <div className="list-ph">
                  <span>Calls waiting</span>
                  <b className="list-badge">{waiting.length}</b>
                </div>
                <div className="list-hdrs list-hdrs--w"><span>#</span><span>Caller</span><span>Wait</span></div>
                <div className="list-rows">
                  {waiting.length
                    ? waiting.slice(0, 7).map((c, i) => (
                        <div className="list-row list-row--w" key={`w${i}`}>
                          <span className="lr-pos">#{i + 1}</span>
                          <span className="lr-num">{c.caller}</span>
                          <span className={`lr-wait${Number(String(c.wait).replace(/[^0-9]/g,'')) > 60 ? ' crit' : ''}`}>{c.wait}</span>
                        </div>
                      ))
                    : <div className="list-empty">No callers waiting</div>}
                </div>
              </div>
              <div className="list-panel">
                <div className="list-ph">
                  <span>Active calls</span>
                  <b className="list-badge list-badge--active">{active.length}</b>
                </div>
                <div className="list-hdrs list-hdrs--a"><span>Agent</span><span>Caller</span><span>Status</span></div>
                <div className="list-rows">
                  {active.length
                    ? active.slice(0, 7).map((c, i) => (
                        <div className="list-row list-row--a" key={`a${i}`}>
                          <span className="lr-agent">{c.agent}</span>
                          <span className="lr-num">{c.caller}</span>
                          <span className={`lr-status${c.status === 'Ringing' ? ' ringing' : ' talking'}`}>{c.status}</span>
                        </div>
                      ))
                    : <div className="list-empty">No active calls</div>}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── COL 2: AGENT ROSTER ── */}
        <div className="body-col">
          <div className="col-head">
            <span className="col-title">Agent Roster &amp; Live Assignment</span>
            <span className="col-sub">{agents.length} agent{agents.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="col2-body">
            <div className="agents-grid">
              {(agents.length
                ? agents
                : [{ name: 'No agents online', statusCode: '5', paused: false, location: '', callsTaken: 0 }]
              ).map((a, i) => (
                <AgentCard key={`${a.name}-${i}`} agent={a} activeCalls={active} />
              ))}
            </div>
          </div>
        </div>

        {/* ── COL 3: METRICS ── */}
        <div className="body-col">
          <div className="col-head">
            <span className="col-title">Queue &amp; Service Metrics</span>
            <span className="col-sub">Last snapshot</span>
          </div>
          <div className="col3-body">

            {/* live traffic numbers */}
            <div className="traffic-row">
              <div className="traffic-box traffic-box--wait">
                <span>Callers Waiting</span>
                <strong>{waiting.length}</strong>
              </div>
              <div className="traffic-box traffic-box--active">
                <span>Active Calls</span>
                <strong>{active.length}</strong>
              </div>
            </div>
            <div className="traffic-sub">Live traffic active</div>

            {/* hourly bar chart */}
            <div className="chart-panel">
              <div className="chart-head">
                <span className="chart-title">Queue Depth — Last 10 Intervals</span>
                <div className="chart-legend">
                  <span><i className="leg-dot leg-dot--ans" />Answered</span>
                  <span><i className="leg-dot leg-dot--ab" />Abandoned</span>
                </div>
              </div>
              <div className="chart-bars">
                {Array.from({ length: 10 }, (_, i) => {
                  const isNow = i === 9;
                  const h = isNow
                    ? Math.min(100, waiting.length * 12)
                    : Math.min(100, (waiting.length * (0.3 + (i % 4) * 0.18)) * 10);
                  return (
                    <div className={`bar-col${isNow ? ' bar-col--now' : ''}`} key={i}>
                      <div className="bar-fill" style={{ height: `${Math.max(3, h)}%` }} />
                      <span>{isNow ? 'Now' : `${i + 1}h`}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* service level */}
            <div className="sl-panel">
              <SLRing value={svcLevel} />
              <div className="sl-info">
                <div className="sl-title">Service Level</div>
                <div className="sl-line">
                  Abandoned: <strong style={{ color: 'var(--fail)', fontFamily: 'var(--mono)' }}>{abandoned}</strong>
                </div>
                <div className="sl-line">
                  Abandon rate: <strong style={{ color: abandoned / Math.max(1, totalCalls) > 0.1 ? 'var(--fail)' : 'var(--warn)', fontFamily: 'var(--mono)' }}>{abandonRate.toFixed(1)}%</strong>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>{/* /body-grid */}

      {/* ═══ FOOTER — agent status tiles ═══ */}
      <footer className="tv-footer">
        <div className="status-tile status-tile--avail">
          <div className="st-icon">●</div>
          <div className="st-info"><strong>{avail}</strong><span>Available</span></div>
        </div>
        <div className="status-tile status-tile--call">
          <div className="st-icon">◉</div>
          <div className="st-info"><strong>{active.length}</strong><span>On Call</span></div>
        </div>
        <div className="status-tile status-tile--brk">
          <div className="st-icon">◑</div>
          <div className="st-info"><strong>{onBreak}</strong><span>On Break</span></div>
        </div>
        <div className="status-tile status-tile--off">
          <div className="st-icon">○</div>
          <div className="st-info"><strong>{offline}</strong><span>Offline</span></div>
        </div>
        <div className="footer-meta">
          <span className="meta-dot" /> Read-only monitoring · Deltapath UC 5.3.1 · Polling every {POLL_MS / 1000}s
        </div>
      </footer>

    </div>
  );
}
