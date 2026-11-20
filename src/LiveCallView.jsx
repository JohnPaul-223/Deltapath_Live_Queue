import { useEffect, useRef, useState } from 'react';
import { fetchLiveSnapshot, startLiveSession, stopLiveSession } from './api.js';

function formatWait(value) {
  const seconds = Number(String(value || 0).replace(/[^0-9.]/g, '')) || 0;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export default function LiveCallView({ form }) {
  // session holds { token, server, username, allowInvalidTLS } returned by startLiveSession.
  // Keeping it in state (instead of a server-side Map) is what makes this serverless-compatible.
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [liveData, setLiveData] = useState(null);
  const [liveError, setLiveError] = useState('');
  const [clock, setClock] = useState(() => new Date());
  const pollRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => {
      clearInterval(timer);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const start = async () => {
    setStarting(true);
    setLiveError('');
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      const liveSession = await startLiveSession(form);
      setSession(liveSession);
      const poll = async () => {
        try {
          const snapshot = await fetchLiveSnapshot(liveSession);
          setLiveData(snapshot);
          setLiveError(snapshot.statuses?.queues === 200 ? '' : `Queue endpoint HTTP ${snapshot.statuses?.queues}`);
        } catch (error) {
          setLiveError(error.message);
        }
      };
      await poll();
      pollRef.current = setInterval(poll, 3000);
    } catch (error) {
      setLiveError(error.message);
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    await stopLiveSession(session);
    setSession(null);
    setLiveData(null);
  };

  const calls = liveData?.liveCalls || (liveData?.liveCall ? [liveData.liveCall] : []);
  const waiting = calls.filter((call) => call.status === 'Waiting');
  const active = calls.filter((call) => call.status === 'Ringing' || call.status === 'Connected');
  const agents = liveData?.liveAgents || [];
  const stats = liveData?.liveStats || {};
  const completed = Number(stats.completed || 0);
  const abandoned = Number(stats.abandoned || 0);
  const total = completed + abandoned;
  const abandonRate = total ? (abandoned / total) * 100 : 0;
  const serviceLevel = Number(stats.serviceLevelPerf || 0);
  const longestWait = waiting.length
    ? waiting.map((call) => Number(String(call.wait).replace(/[^0-9.]/g, '')) || 0).sort((a, b) => b - a)[0]
    : 0;
  const available = agents.filter((agent) => !agent.paused && ['1', '2'].includes(agent.statusCode)).length;
  const breaking = agents.filter((agent) => agent.paused).length;
  const offline = Math.max(0, agents.length - available - active.length - breaking);
  const queueStatus = waiting.length > 10 ? 'crit' : waiting.length > 4 ? 'warn' : 'ok';

  return (
    <div className="hotlineView">
      <header className="hotlineHeader">
        <div className="hotlineTitle">
          <strong>Hotline Monitor</strong>
          <span className={session ? 'liveBadge on' : 'liveBadge'}>{session ? 'LIVE' : 'STANDBY'}</span>
        </div>
        <div className={`queueHealth ${queueStatus}`}>
          {waiting.length > 10 ? 'QUEUE CRITICAL' : waiting.length > 4 ? 'QUEUE BUSY' : 'QUEUE NORMAL'}
        </div>
        <div className="hotlineActions">
          {session
            ? <button onClick={stop} className="monitorStop">Stop monitoring</button>
            : <button onClick={start} className="monitorStart" disabled={starting}>{starting ? 'Connecting…' : 'Start monitoring'}</button>}
        </div>
        <div className="hotlineClock">
          <strong>{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
          <span>{clock.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        </div>
      </header>

      {liveError && <div className="liveErrorBanner" role="alert">⚠ {liveError}</div>}

      <section className="hotlineKpis">
        <div className="kpiGroup callsToday">
          <h2>Calls today</h2>
          <div className="kpiRow four">
            <div className="hotKpi"><span>Total calls</span><strong>{total}</strong><small>answered + abandoned</small></div>
            <div className="hotKpi answered"><span>Answered</span><strong>{completed}</strong></div>
            <div className="hotKpi abandoned"><span>Abandoned</span><strong>{abandoned}</strong><small>hung up in queue</small></div>
            <div className="hotKpi abandoned"><span>Abandon rate</span><strong>{abandonRate.toFixed(1)}%</strong><small>target below 5%</small></div>
          </div>
        </div>
        <div className="kpiGroup">
          <h2>Service</h2>
          <div className="kpiRow two">
            <div className="hotKpi service"><span>Service level</span><strong>{Math.round(serviceLevel)}%</strong></div>
            <div className="hotKpi"><span>Avg wait</span><strong>{formatWait(stats.holdTime)}</strong></div>
          </div>
        </div>
        <div className="kpiGroup">
          <h2>Live queue</h2>
          <div className="kpiRow two">
            <div className="hotKpi waiting"><span>Callers waiting</span><strong>{waiting.length}</strong></div>
            <div className="hotKpi waiting"><span>Longest wait</span><strong>{formatWait(longestWait)}</strong></div>
          </div>
        </div>
      </section>

      <section className="hotlineMain">
        <div className="callStage">
          <div className="stageColumn callerColumn">
            <div className="stageHeading">Caller<small>Customer dials in</small></div>
            <div className="stageBody"><div className="stageNode callerNode"><span>Inbound</span></div></div>
          </div>
          <div className="stageColumn hotlineColumn">
            <div className="stageHeading">Hotline / mobile<small>Answered and greeted</small></div>
            <div className="stageBody"><div className="stageNode hotlineNode"><strong>{form.server ? 'Deltapath' : 'Hotline'}</strong><span>{form.username || 'Queue line'}</span></div></div>
          </div>
          <div className="stageColumn queueColumn">
            <div className="stageHeading">Queue<small>Callers hold in order</small></div>
            <div className="stageBody"><div className="queueSlots">
              {Array.from({ length: 5 }, (_, index) => <div key={index} className={waiting[index] ? 'queueSlot occupied' : 'queueSlot'} />)}
            </div><div className="queueCount">{waiting.length ? `${waiting.length} caller${waiting.length === 1 ? '' : 's'} waiting` : ''}</div></div>
          </div>
          <div className="stageColumn agentsColumn">
            <div className="stageHeading">Agents<small>Longest-idle available agent gets the call</small></div>
            <div className="monitorAgents">
              {(agents.length ? agents : [{ name: 'No live agents', statusCode: '5', paused: false }]).slice(0, 8).map((agent, index) => {
                const assigned = active.find((call) => call.agent === agent.name || call.agentExt === agent.location);
                const status = assigned ? 'talking' : agent.paused ? 'away' : ['1', '2'].includes(agent.statusCode) ? 'avail' : 'offline';
                return (
                  <div key={`${agent.name}-${index}`} className="monitorAgent" data-status={status}>
                    <div><strong>{agent.name}</strong><span>{assigned ? 'On call' : agent.paused ? 'On break' : status === 'avail' ? 'Available' : 'Offline'}</span></div>
                    <small>{agent.location ? `Ext ${agent.location}` : `${agent.callsTaken || 0} calls handled`}</small>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flowWires" aria-hidden="true"><i /><i /><i /></div>
          {waiting.slice(0, 5).map((call, index) => (
            <div key={`waiting-${call.caller}-${index}`} className="flowToken waitingToken" style={{ '--token-index': index }}>
              <span>☎</span><b>…{String(call.caller).slice(-4)}</b>
            </div>
          ))}
          {active.slice(0, 5).map((call, index) => (
            <div key={`active-${call.caller}-${index}`} className={`flowToken ${call.status === 'Ringing' ? 'ringingToken' : 'talkingToken'}`}>
              <span>☎</span><b>…{String(call.caller).slice(-4)}</b>
            </div>
          ))}
        </div>

        <aside className="hotlineSide">
          <div className="hotlineList">
            <div className="listHeader">Calls waiting <b>{waiting.length}</b></div>
            <div className="listLabels"><span>Position</span><span>Caller</span><span>Waiting</span></div>
            <div className="listRows">
              {waiting.length ? waiting.slice(0, 5).map((call, index) => (
                <div className="listRow" key={`${call.caller}-${index}`}><span>#{index + 1}</span><span>{call.caller}</span><span>{call.wait}</span></div>
              )) : <div className="listEmpty">No callers waiting</div>}
            </div>
          </div>
          <div className="hotlineList">
            <div className="listHeader">Active calls <b>{active.length}</b></div>
            <div className="listLabels activeLabels"><span>Agent</span><span>Caller</span><span>Status</span></div>
            <div className="listRows">
              {active.length ? active.slice(0, 5).map((call, index) => (
                <div className="listRow activeRow" key={`${call.caller}-${index}`}><span>{call.agent}</span><span>{call.caller}</span><span className="ringingText">{call.status}</span></div>
              )) : <div className="listEmpty">No active calls</div>}
            </div>
          </div>
        </aside>
      </section>

      <section className="hotlineFooter">
        <div className="queueStatusPanel">
          <div className="panelHeader">Queue status <span>Live snapshot</span></div>
          <div className="statusBars">
            {Array.from({ length: 8 }, (_, index) => {
              const height = waiting.length ? Math.min(100, 20 + waiting.length * (index % 3 + 1) * 4) : 8;
              return <div className="statusBar" key={index}><i style={{ height: `${height}%` }} /><span>{index === 7 ? 'Now' : `${index + 1}h`}</span></div>;
            })}
          </div>
        </div>
        <div className="agentStatusPanel">
          <div className="panelHeader">Agent status <span>{agents.length} live agents</span></div>
          <div className="statusTiles">
            <div className="statusTile available"><strong>{available}</strong><span>Available</span></div>
            <div className="statusTile oncall"><strong>{active.length}</strong><span>On call</span></div>
            <div className="statusTile break"><strong>{breaking}</strong><span>On break</span></div>
            <div className="statusTile offline"><strong>{offline}</strong><span>Offline</span></div>
          </div>
        </div>
      </section>
    </div>
  );
}
