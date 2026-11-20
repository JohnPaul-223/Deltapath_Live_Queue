import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLiveSnapshot, startLiveSession, stopLiveSession } from './api.js';

/* ─── Helpers ─────────────────────────────────────────────────────── */
function fmtSeconds(raw) {
  const s = Number(String(raw ?? 0).replace(/[^0-9.]/g, '')) || 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function fmtTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(date) {
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

const POLL_INTERVAL = 5000;   // ms between polls
const MAX_RETRIES   = 3;      // consecutive errors before showing degraded banner

/* ─── Sub-components ──────────────────────────────────────────────── */
function KpiCard({ label, value, sub, variant }) {
  return (
    <div className={`kpiCard${variant ? ` kpiCard--${variant}` : ''}`}>
      <span className="kpiLabel">{label}</span>
      <strong className="kpiValue">{value}</strong>
      {sub && <small className="kpiSub">{sub}</small>}
    </div>
  );
}

function AgentCard({ agent, activeCalls }) {
  const isOnCall = activeCalls.some(
    (c) => c.agent === agent.name || c.agentExt === agent.location,
  );
  const status = isOnCall
    ? 'oncall'
    : agent.paused
    ? 'away'
    : ['1', '2'].includes(agent.statusCode)
    ? 'avail'
    : 'offline';

  const statusLabel = { oncall: 'On call', away: 'On break', avail: 'Available', offline: 'Offline' }[status];

  return (
    <div className="agentCard" data-status={status}>
      <div className="agentMeta">
        <strong className="agentName">{agent.name}</strong>
        <span className="agentStatus">{statusLabel}</span>
      </div>
      <small className="agentExt">
        {agent.location ? `Ext ${agent.location}` : `${agent.callsTaken || 0} calls`}
      </small>
    </div>
  );
}

/* ─── Main component ──────────────────────────────────────────────── */
export default function LiveCallView({ credentials, onAuthError, onConnected, onDisconnect }) {
  const [session, setSession]       = useState(null);
  const [liveData, setLiveData]     = useState(null);
  const [status, setStatus]         = useState('connecting'); // connecting | live | degraded | stopped
  const [errorMsg, setErrorMsg]     = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [clock, setClock]           = useState(() => new Date());
  const [retries, setRetries]       = useState(0);

  const pollRef    = useRef(null);
  const sessionRef = useRef(null); // kept in sync so stop() can read it without stale closure

  /* Live clock */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ── Poll ── */
  const poll = useCallback(async (sess) => {
    try {
      const snapshot = await fetchLiveSnapshot(sess);
      setLiveData(snapshot);
      setLastUpdate(new Date());
      setRetries(0);
      setStatus('live');
      setErrorMsg('');
    } catch (err) {
      setRetries((r) => {
        const next = r + 1;
        if (next >= MAX_RETRIES) {
          setStatus('degraded');
          setErrorMsg(err.message);
        }
        return next;
      });
    }
  }, []);

  /* ── Connect on mount ── */
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
        pollRef.current = setInterval(() => poll(sess), POLL_INTERVAL);
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally once per mount

  /* ── Disconnect ── */
  const handleDisconnect = async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus('stopped');
    if (sessionRef.current) await stopLiveSession(sessionRef.current);
    onDisconnect?.();
  };

  /* ── Derived data ── */
  const calls    = liveData?.liveCalls || (liveData?.liveCall ? [liveData.liveCall] : []);
  const waiting  = calls.filter((c) => c.status === 'Waiting');
  const active   = calls.filter((c) => c.status === 'Ringing' || c.status === 'Connected');
  const agents   = liveData?.liveAgents || [];
  const stats    = liveData?.liveStats  || {};

  const completed    = Number(stats.completed  || 0);
  const abandoned    = Number(stats.abandoned  || 0);
  const totalCalls   = completed + abandoned;
  const abandonRate  = totalCalls ? (abandoned / totalCalls) * 100 : 0;
  const svcLevel     = Number(stats.serviceLevelPerf || 0);
  const longestWait  = waiting.length
    ? Math.max(...waiting.map((c) => Number(String(c.wait).replace(/[^0-9.]/g, '')) || 0))
    : 0;

  const available = agents.filter((a) => !a.paused && ['1', '2'].includes(a.statusCode)).length;
  const onBreak   = agents.filter((a) => a.paused).length;
  const offline   = Math.max(0, agents.length - available - active.length - onBreak);

  const queueLevel = waiting.length > 10 ? 'crit' : waiting.length > 4 ? 'warn' : 'ok';
  const queueLabel = { ok: 'Queue Normal', warn: 'Queue Busy', crit: 'Queue Critical' }[queueLevel];

  const isLive = status === 'live' || status === 'degraded';

  return (
    <div className="monitor">

      {/* ── Top bar ── */}
      <header className="monitorTopbar">
        <div className="topbarLeft">
          <div className="topbarBrand">
            <div className="topbarMark">D</div>
            <div className="topbarTitle">
              <strong>Deltapath</strong>
              <span>Live Queue Monitor</span>
            </div>
          </div>
          <div className="topbarServer" title={credentials.server}>
            <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.1"/><path d="M8 1.5C8 1.5 5.5 4 5.5 8s2.5 6.5 2.5 6.5M8 1.5C8 1.5 10.5 4 10.5 8S8 14.5 8 14.5M1.5 8h13" stroke="currentColor" strokeWidth="1.1"/></svg>
            {credentials.server}
          </div>
        </div>

        <div className="topbarCenter">
          <div className={`statusPill statusPill--${queueLevel}`}>{queueLabel}</div>
        </div>

        <div className="topbarRight">
          <div className="topbarStatusRow">
            <span className={`liveDot${isLive ? ' liveDot--on' : ''}`} />
            <span className="liveLabel">{status === 'connecting' ? 'Connecting…' : status === 'live' ? 'Live' : status === 'degraded' ? 'Degraded' : 'Stopped'}</span>
            {lastUpdate && <span className="lastUpdate">Updated {fmtTime(lastUpdate)}</span>}
          </div>
          <button className="disconnectBtn" onClick={handleDisconnect}>Disconnect</button>
          <div className="topbarClock">
            <strong>{fmtTime(clock)}</strong>
            <span>{fmtDate(clock)}</span>
          </div>
        </div>
      </header>

      {/* ── Error banner ── */}
      {status === 'degraded' && (
        <div className="errorBanner" role="alert">
          <svg viewBox="0 0 16 16" fill="none"><path d="M8 2L14.5 13.5H1.5L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M8 7v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          Connection unstable — {errorMsg}. Retrying automatically.
        </div>
      )}

      {status === 'connecting' && !liveData && (
        <div className="connectingBanner">
          <span className="btnSpinner" /> Establishing connection to {credentials.server}…
        </div>
      )}

      {/* ── KPI strip ── */}
      <section className="kpiStrip" aria-label="Key metrics">
        <div className="kpiGroup">
          <div className="kpiGroupLabel">Calls today</div>
          <div className="kpiGroupCards">
            <KpiCard label="Total" value={totalCalls} sub="answered + abandoned" />
            <KpiCard label="Answered" value={completed} variant="ok" />
            <KpiCard label="Abandoned" value={abandoned} variant="fail" sub="hung up in queue" />
            <KpiCard label="Abandon rate" value={`${abandonRate.toFixed(1)}%`} variant={abandonRate > 10 ? 'fail' : abandonRate > 5 ? 'warn' : 'ok'} sub="target < 5%" />
          </div>
        </div>
        <div className="kpiGroup">
          <div className="kpiGroupLabel">Service</div>
          <div className="kpiGroupCards">
            <KpiCard label="Service level" value={`${Math.round(svcLevel)}%`} variant={svcLevel < 80 ? 'fail' : svcLevel < 90 ? 'warn' : 'ok'} />
            <KpiCard label="Avg wait" value={fmtSeconds(stats.holdTime)} />
          </div>
        </div>
        <div className="kpiGroup">
          <div className="kpiGroupLabel">Live queue</div>
          <div className="kpiGroupCards">
            <KpiCard label="Waiting" value={waiting.length} variant={waiting.length > 10 ? 'fail' : waiting.length > 4 ? 'warn' : null} />
            <KpiCard label="Longest wait" value={fmtSeconds(longestWait)} variant={longestWait > 120 ? 'fail' : longestWait > 60 ? 'warn' : null} />
          </div>
        </div>
      </section>

      {/* ── Main grid ── */}
      <div className="mainGrid">

        {/* Call flow diagram */}
        <section className="flowPanel" aria-label="Call flow">
          <div className="flowHeader">
            <span className="panelTitle">Call flow</span>
            <span className="panelSub">Real-time path</span>
          </div>
          <div className="flowDiagram">
            {/* Stage: Caller */}
            <div className="flowStage">
              <div className="stageLabelRow"><span className="stageLabel">Caller</span><small>Dials in</small></div>
              <div className="flowNode flowNode--caller">
                <div className="flowNodeIcon">☎</div>
                <div><strong>Inbound</strong><span>PSTN / VoIP</span></div>
              </div>
            </div>

            <div className="flowArrow">
              {waiting.slice(0, 3).map((c, i) => (
                <div key={i} className="flowToken flowToken--waiting" style={{ '--ti': i }}>
                  …{String(c.caller).slice(-4)}
                </div>
              ))}
            </div>

            {/* Stage: System */}
            <div className="flowStage">
              <div className="stageLabelRow"><span className="stageLabel">System</span><small>Deltapath UC</small></div>
              <div className="flowNode flowNode--system">
                <div className="flowNodeIcon flowNodeIcon--system">D</div>
                <div>
                  <strong>{credentials.server.replace(/^https?:\/\//, '')}</strong>
                  <span>{credentials.username}</span>
                </div>
              </div>
            </div>

            <div className="flowArrow">
              {active.slice(0, 2).map((c, i) => (
                <div key={i} className={`flowToken flowToken--${c.status === 'Ringing' ? 'ringing' : 'talking'}`}>
                  …{String(c.caller).slice(-4)}
                </div>
              ))}
            </div>

            {/* Stage: Queue */}
            <div className="flowStage">
              <div className="stageLabelRow"><span className="stageLabel">Queue</span><small>Callers hold</small></div>
              <div className="flowNode flowNode--queue">
                <div className="flowQueueSlots">
                  {Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className={`queueDot${waiting[i] ? ' queueDot--full' : ''}`} />
                  ))}
                </div>
                <div>
                  <strong>{waiting.length} waiting</strong>
                  <span>FIFO queue</span>
                </div>
              </div>
            </div>

            <div className="flowArrow flowArrow--long" />

            {/* Stage: Agents */}
            <div className="flowStage flowStage--agents">
              <div className="stageLabelRow"><span className="stageLabel">Agents</span><small>Longest-idle answers</small></div>
              <div className="agentsGrid">
                {(agents.length
                  ? agents.slice(0, 8)
                  : [{ name: 'No agents online', statusCode: '5', paused: false }]
                ).map((agent, i) => (
                  <AgentCard key={`${agent.name}-${i}`} agent={agent} activeCalls={active} />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Side panels */}
        <aside className="sideStack">
          {/* Calls waiting */}
          <div className="listPanel">
            <div className="listPanelHeader">
              <span>Calls waiting</span>
              <span className="listBadge">{waiting.length}</span>
            </div>
            <div className="listPanelLabels">
              <span>#</span><span>Caller</span><span>Wait</span>
            </div>
            <div className="listPanelRows">
              {waiting.length ? waiting.slice(0, 8).map((c, i) => (
                <div className="listPanelRow" key={`w-${c.caller}-${i}`}>
                  <span className="rowPos">#{i + 1}</span>
                  <span className="rowCaller">{c.caller}</span>
                  <span className="rowWait">{fmtSeconds(c.wait)}</span>
                </div>
              )) : <div className="listEmpty">No callers waiting</div>}
            </div>
          </div>

          {/* Active calls */}
          <div className="listPanel">
            <div className="listPanelHeader">
              <span>Active calls</span>
              <span className="listBadge listBadge--active">{active.length}</span>
            </div>
            <div className="listPanelLabels activeLabels">
              <span>Agent</span><span>Caller</span><span>Status</span>
            </div>
            <div className="listPanelRows">
              {active.length ? active.slice(0, 8).map((c, i) => (
                <div className="listPanelRow" key={`a-${c.caller}-${i}`}>
                  <span className="rowAgent">{c.agent}</span>
                  <span className="rowCaller">{c.caller}</span>
                  <span className={`rowStatus rowStatus--${c.status === 'Ringing' ? 'ring' : 'talk'}`}>{c.status}</span>
                </div>
              )) : <div className="listEmpty">No active calls</div>}
            </div>
          </div>
        </aside>
      </div>

      {/* ── Footer ── */}
      <footer className="monitorFooter">
        {/* Agent status summary */}
        <div className="footerPanel">
          <div className="footerPanelHeader">
            <span className="panelTitle">Agent status</span>
            <span className="panelSub">{agents.length} agents</span>
          </div>
          <div className="agentStatusGrid">
            <div className="agentStatusTile" data-variant="avail">
              <strong>{available}</strong><span>Available</span>
            </div>
            <div className="agentStatusTile" data-variant="oncall">
              <strong>{active.length}</strong><span>On call</span>
            </div>
            <div className="agentStatusTile" data-variant="away">
              <strong>{onBreak}</strong><span>On break</span>
            </div>
            <div className="agentStatusTile" data-variant="offline">
              <strong>{offline}</strong><span>Offline</span>
            </div>
          </div>
        </div>

        {/* Queue depth history (animated bars from live waiting count) */}
        <div className="footerPanel footerPanel--wide">
          <div className="footerPanelHeader">
            <span className="panelTitle">Queue depth</span>
            <span className="panelSub">Last snapshot</span>
          </div>
          <div className="depthBars">
            {Array.from({ length: 10 }, (_, i) => {
              const h = i === 9
                ? Math.min(100, waiting.length * 10)
                : Math.min(100, (waiting.length * (0.4 + (i % 3) * 0.2)) * 10);
              return (
                <div className="depthBar" key={i}>
                  <div className="depthBarFill" style={{ height: `${Math.max(4, h)}%` }} />
                  <span>{i === 9 ? 'Now' : `${i + 1}h`}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="footerMeta">
          <div className="footerMetaRow">
            <span className="metaDot" />
            <span>Read-only monitoring</span>
          </div>
          <div className="footerMetaRow">
            <span>Deltapath UC 5.3.1 · DG-100011</span>
          </div>
          <div className="footerMetaRow">
            Polling every {POLL_INTERVAL / 1000}s
          </div>
        </div>
      </footer>

    </div>
  );
}
