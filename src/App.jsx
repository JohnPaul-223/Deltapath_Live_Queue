import { useState } from 'react';
import LiveCallView from './LiveCallView.jsx';

/* ─── Connect modal ───────────────────────────────────────────────── */
function ConnectModal({ onConnect, connecting, error }) {
  const [form, setForm] = useState({ server: '', username: '', password: '', allowInvalidTLS: true });
  const [showPw, setShowPw] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    onConnect(form);
  };

  return (
    <div className="modalBackdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Connect to Deltapath server">
        <div className="modalBrand">
          <div className="modalMark">D</div>
          <div>
            <strong>Deltapath Live Queue Monitor</strong>
            <span>Enter your server credentials to start monitoring</span>
          </div>
        </div>

        <form onSubmit={submit} noValidate>
          <div className="modalField">
            <label htmlFor="ms">Server address</label>
            <div className="modalInput">
              <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/><path d="M8 1.5C8 1.5 5.5 4 5.5 8s2.5 6.5 2.5 6.5M8 1.5C8 1.5 10.5 4 10.5 8S8 14.5 8 14.5M1.5 8h13" stroke="currentColor" strokeWidth="1.2"/></svg>
              <input id="ms" value={form.server} onChange={set('server')} placeholder="https://uc-server.local" autoComplete="url" required />
            </div>
          </div>
          <div className="modalField">
            <label htmlFor="mu">ACL username</label>
            <div className="modalInput">
              <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.2"/><path d="M2.5 13c0-2.485 2.462-4.5 5.5-4.5s5.5 2.015 5.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              <input id="mu" value={form.username} onChange={set('username')} placeholder="administrator" autoComplete="username" required />
            </div>
          </div>
          <div className="modalField">
            <label htmlFor="mp">Password</label>
            <div className="modalInput">
              <svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="7" width="11" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.2"/><path d="M5 7V5.5a3 3 0 1 1 6 0V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              <input id="mp" type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')} placeholder="••••••••" autoComplete="current-password" required />
              <button type="button" className="eyeBtn" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <label className="modalTls">
            <input type="checkbox" checked={form.allowInvalidTLS} onChange={(e) => setForm((f) => ({ ...f, allowInvalidTLS: e.target.checked }))} />
            Allow private / self-signed TLS certificate
          </label>

          {error && <div className="modalError" role="alert">{error}</div>}

          <button type="submit" className="connectBtn" disabled={connecting}>
            {connecting
              ? <><span className="btnSpinner" /> Connecting…</>
              : <>Connect &amp; monitor</>}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Root app ────────────────────────────────────────────────────── */
export default function App() {
  const [credentials, setCredentials] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  /* Called by the modal; real auth happens inside LiveCallView on mount */
  const handleConnect = (form) => {
    if (!form.server || !form.username || !form.password) {
      setConnectError('Server address, username, and password are all required.');
      return;
    }
    setConnectError('');
    setConnecting(true);
    setCredentials(form);
  };

  /* Called by LiveCallView when the first auth attempt fails */
  const handleAuthError = (message) => {
    setConnecting(false);
    setCredentials(null);
    setConnectError(message);
  };

  /* Called once LiveCallView reports it is live */
  const handleConnected = () => setConnecting(false);

  /* Called when user clicks "Disconnect" inside the monitor */
  const handleDisconnect = () => {
    setCredentials(null);
    setConnecting(false);
    setConnectError('');
  };

  if (!credentials) {
    return <ConnectModal onConnect={handleConnect} connecting={connecting} error={connectError} />;
  }

  return (
    <LiveCallView
      credentials={credentials}
      onAuthError={handleAuthError}
      onConnected={handleConnected}
      onDisconnect={handleDisconnect}
    />
  );
}
