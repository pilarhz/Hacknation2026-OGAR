import { useEffect, useState } from 'react';
import { api, ApiError, type Meta } from './api.ts';

function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="panel" style={{ maxWidth: 420, margin: '40px auto' }}>
      <h2>Logowanie</h2>
      <div className="small muted" style={{ marginBottom: 10 }}>Serwer wymaga tokenu dostępu (API_TOKEN). Token zostanie zapisany w ciasteczku HttpOnly tej przeglądarki.</div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.login(token);
            onDone();
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : String(ex));
          }
        }}
        className="row"
      >
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="token" style={{ flex: 1 }} autoFocus />
        <button className="primary" disabled={!token}>Zaloguj</button>
      </form>
      {err && <div className="callout red small">{err}</div>}
    </div>
  );
}
import { ListPage } from './pages/ListPage.tsx';
import { NewPage } from './pages/NewPage.tsx';
import { InvestigationPage } from './pages/InvestigationPage.tsx';
import { ExtractorPage } from './pages/ExtractorPage.tsx';
import { LabelsPage } from './pages/LabelsPage.tsx';
import { MethodPage } from './pages/MethodPage.tsx';

export function useHash() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export const go = (path: string) => {
  window.location.hash = path;
};

export function App() {
  const hash = useHash();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const loadMeta = () =>
    api
      .meta()
      .then((m) => {
        setMeta(m);
        setNeedLogin(false);
      })
      .catch((e) => (e instanceof ApiError && e.status === 401 ? setNeedLogin(true) : setErr(String(e.message ?? e))));
  useEffect(() => {
    loadMeta();
  }, []);

  const [path] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  let page: React.ReactNode;
  if (needLogin) page = <Login onDone={loadMeta} />;
  else if (!meta) page = err ? <div className="panel callout red">Brak połączenia z API ({err}). Uruchom backend: <code>npm run dev</code>.</div> : <div className="empty">Ładowanie…</div>;
  else if (parts[0] === 'new') page = <NewPage meta={meta} />;
  else if (parts[0] === 'inv' && parts[1]) page = <InvestigationPage id={parts[1]} meta={meta} />;
  else if (parts[0] === 'extract') page = <ExtractorPage />;
  else if (parts[0] === 'labels') page = <LabelsPage meta={meta} />;
  else if (parts[0] === 'method') page = <MethodPage meta={meta} />;
  else page = <ListPage />;

  const nav = [
    ['/', 'Analizy'],
    ['/new', 'Nowa analiza'],
    ['/extract', 'Ekstraktor adresów'],
    ['/labels', 'Etykiety adresów'],
    ['/method', 'Metodyka'],
  ];
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span style={{ fontSize: 26 }}>🦉</span>
          <div>
            OŁCyŚ<br />
            <small>Osintowy Łapacz Cyfrowych Śladów</small>
          </div>
        </div>
        <nav className="nav">
          {nav.map(([href, label]) => (
            <a key={href} href={`#${href}`} className={(href === '/' ? parts.length === 0 || parts[0] === 'inv' : path.startsWith(href)) ? 'active' : ''}>
              {label}
            </a>
          ))}
        </nav>
        <div className="spacer" />
        {meta && (
          <div className="row small">
            <span className="pill">on-chain: {meta.config.chainLive ? 'publiczne API' : 'wyłączone'}</span>
            <span className="pill">AI: {meta.config.ai === 'none' ? 'wyłączone' : meta.config.aiModel}</span>
          </div>
        )}
      </header>
      <main className="container">{page}</main>
    </>
  );
}
