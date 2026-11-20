import { useMemo, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';
import FlowCanvas from './FlowCanvas.jsx';
import LiveCallView from './LiveCallView.jsx';
import { scanServer } from './api.js';
import { buildGraph } from './graph.js';
import './app.css';

function CredentialsForm({ form, setForm, onSubmit, loading, disabled, error }) {
  const [showPassword, setShowPassword] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <form onSubmit={onSubmit}>
      <label>
        Server address
        <div className="inputWrap"><span>◎</span><input value={form.server} onChange={set('server')} placeholder="https://uc-server.local" autoComplete="url" /></div>
      </label>
      <label>
        ACL username
        <div className="inputWrap"><span>♙</span><input value={form.username} onChange={set('username')} placeholder="Enter username" autoComplete="username" /></div>
      </label>
      <label>
        Password
        <div className="inputWrap">
          <span>◈</span>
          <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={set('password')} placeholder="Enter password" autoComplete="current-password" />
          <button type="button" className="eye" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button>
        </div>
      </label>
      <label className="tlsOption">
        <input type="checkbox" checked={form.allowInvalidTLS} onChange={(e) => setForm({ ...form, allowInvalidTLS: e.target.checked })} />
        Allow private / self-signed certificate
      </label>
      {error && <div className="errorBox" role="alert">{error}</div>}
      <button className="scanButton" disabled={loading || disabled} type="submit">
        {loading ? <><span className="spinner" /> Mapping server…</> : <>↗ Scan server</>}
      </button>
    </form>
  );
}

function Topbar({ title, view, setView, canExport, onExport }) {
  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">DISCOVERY CANVAS</span>
        <h1>{title}</h1>
      </div>
      <div className="actions">
        <div className="viewSwitch">
          <button className={view === 'live' ? 'active' : ''} onClick={() => setView('live')}>Live call</button>
          <button className={view === 'discovery' ? 'active' : ''} onClick={() => setView('discovery')}>Discovery</button>
        </div>
        <button onClick={onExport} className="exportButton" disabled={!canExport} title={canExport ? 'Export discovery results as JSON' : 'Run a scan first'}>⇩ Export map</button>
      </div>
    </header>
  );
}

function DiscoveryToolbar({ search, setSearch, accessible, total }) {
  return (
    <div className="toolbar">
      <div className="search">
        <span>⌕</span>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resources…" />
      </div>
      <div className="stats">
        <span><b>{accessible}</b> accessible</span>
        <span><b>{total}</b> probes</span>
      </div>
    </div>
  );
}

export default function App() {
  const [form, setForm] = useState({ server: '', username: '', password: '', allowInvalidTLS: true });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scan, setScan] = useState(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('live');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const results = scan?.results || [];

  const filtered = useMemo(
    () => results.filter((r) => !search || `${r.group} ${r.label} ${r.method}`.toLowerCase().includes(search.toLowerCase())),
    [results, search],
  );
  const graph = useMemo(() => buildGraph(filtered), [filtered]);
  const accessible = results.filter((r) => r.ok).length;

  const runScan = async (e) => {
    e?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await scanServer(form);
      setScan(data);
      setView('discovery');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const exportJson = () => {
    if (!scan) return;
    const blob = new Blob([JSON.stringify(scan, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'deltapath-map.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <main className={`shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <button className="menuButton" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title="Toggle credentials panel">☰</button>
          <div className="brandMark">D</div>
          <div className="brandText"><strong>Deltapath</strong><span>API Mapper</span></div>
        </div>
        <CredentialsForm form={form} setForm={setForm} onSubmit={runScan} loading={loading} disabled={loading} error={error} />
        <div className="guideInfo">
          <div><span className="pulse" /> Read-only scan</div>
          <strong>DG-100011 · 5.3.1 · GET probes only</strong>
        </div>
      </aside>

      <section className={view === 'discovery' && scan ? 'workspace hasToolbar' : 'workspace'}>
        <Topbar
          title={scan ? scan.server : 'Deltapath call architecture'}
          view={view}
          setView={setView}
          canExport={!!scan}
          onExport={exportJson}
        />
        {view === 'discovery' && scan && (
          <DiscoveryToolbar search={search} setSearch={setSearch} accessible={accessible} total={results.length} />
        )}
        <div className={`canvas ${view === 'live' ? 'liveCanvas' : ''}`}>
          <div key={view} className="viewFade">
            {view === 'live'
              ? <LiveCallView form={form} />
              : scan
                ? <ReactFlowProvider><FlowCanvas graph={graph} /></ReactFlowProvider>
                : <div className="emptyState"><strong>No discovery data yet</strong><span>Enter your server credentials and run a scan to map the API surface.</span></div>}
          </div>
        </div>
      </section>
    </main>
  );
}
