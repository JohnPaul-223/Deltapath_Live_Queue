import { useState } from 'react';
import LiveCallView from './LiveCallView.jsx';

function ConnectModal({ onConnect, connecting, error }) {
  const [form, setForm] = useState({ server: '', username: '', password: '', allowInvalidTLS: true });
  const [showPw, setShowPw] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-brand">
          <div className="modal-mark">D</div>
          <div>
            <strong>Deltapath UC</strong>
            <span>Live Agent &amp; Queue Monitor</span>
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); onConnect(form); }} noValidate>
          <div className="modal-field">
            <label>Server Address</label>
            <div className="modal-input">
              <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/><path d="M8 1.5C8 1.5 5.5 4 5.5 8s2.5 6.5 2.5 6.5M8 1.5C8 1.5 10.5 4 10.5 8S8 14.5 8 14.5M1.5 8h13" stroke="currentColor" strokeWidth="1.2"/></svg>
              <input value={form.server} onChange={set('server')} placeholder="https://uc-server.local" autoComplete="url" required />
            </div>
          </div>
          <div className="modal-field">
            <label>ACL Username</label>
            <div className="modal-input">
              <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.2"/><path d="M2.5 13c0-2.485 2.462-4.5 5.5-4.5s5.5 2.015 5.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              <input value={form.username} onChange={set('username')} placeholder="administrator" autoComplete="username" required />
            </div>
          </div>
          <div className="modal-field">
            <label>Password</label>
            <div className="modal-input">
              <svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="7" width="11" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.2"/><path d="M5 7V5.5a3 3 0 1 1 6 0V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              <input type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')} placeholder="••••••••" autoComplete="current-password" required />
              <button type="button" className="eye-btn" onClick={() => setShowPw((v) => !v)}>{showPw ? 'Hide' : 'Show'}</button>
            </div>
          </div>
          <label className="modal-tls">
            <input type="checkbox" checked={form.allowInvalidTLS} onChange={(e) => setForm((f) => ({ ...f, allowInvalidTLS: e.target.checked }))} />
            Allow private / self-signed TLS certificate
          </label>
          {error && <div className="modal-error" role="alert">{error}</div>}
          <button type="submit" className="connect-btn" disabled={connecting}>
            {connecting ? <><span className="spinner" /> Connecting…</> : <>Connect &amp; Monitor</>}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [credentials, setCredentials] = useState(null);
  const [connecting, setConnecting]   = useState(false);
  const [error, setError]             = useState('');

  const handleConnect = (form) => {
    if (!form.server || !form.username || !form.password) {
      setError('Server address, username, and password are all required.');
      return;
    }
    setError('');
    setConnecting(true);
    setCredentials(form);
  };

  if (!credentials) {
    return <ConnectModal onConnect={handleConnect} connecting={connecting} error={error} />;
  }

  return (
    <LiveCallView
      credentials={credentials}
      onAuthError={(msg) => { setConnecting(false); setCredentials(null); setError(msg); }}
      onConnected={() => setConnecting(false)}
      onDisconnect={() => { setCredentials(null); setConnecting(false); setError(''); }}
    />
  );
}
