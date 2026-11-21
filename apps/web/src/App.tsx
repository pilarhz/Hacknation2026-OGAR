import { useEffect, useState } from 'react';
import { api, ApiError, type Meta } from './api.ts';
import { useTheme, type Theme } from './theme.ts';

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
import { AboutPage } from './pages/AboutPage.tsx';

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
  const { theme, setTheme } = useTheme();
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
  else if (parts[0] === 'inv' && parts[1]) page = <InvestigationPage key={parts[1]} id={parts[1]} meta={meta} />;
  else if (parts[0] === 'extract') page = <ExtractorPage />;
  else if (parts[0] === 'labels') page = <LabelsPage meta={meta} />;
  else if (parts[0] === 'method') page = <MethodPage meta={meta} />;
  else if (parts[0] === 'about') page = <AboutPage meta={meta} />;
  else page = <ListPage />;

  const isActive = (href: string) => (href === '/' ? parts.length === 0 || parts[0] === 'inv' : path.startsWith(href));
  const link = (href: string, label: string, icon: React.ReactNode, cls = '') => (
    <a key={href} href={`#${href}`} className={`${cls} ${isActive(href) ? 'active' : ''}`} aria-current={isActive(href) ? 'page' : undefined}>
      {icon}
      {label}
    </a>
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/">
          <img className="brand-logo" src="/ogar.svg" alt="" aria-hidden />
          <b>OGAR</b>
        </a>
        <nav className="nav" aria-label="Główna nawigacja">
          {link('/new', 'Nowa analiza', <Icon d="M12 5v14M5 12h14" />, 'cta')}
          <div className="nav-group">Sprawy</div>
          {link('/', 'Analizy', <Icon d="M3 7h18M3 12h18M3 17h12" />)}
          <div className="nav-group">Narzędzia</div>
          {link('/extract', 'Ekstraktor adresów', <Icon d="M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3" />)}
          {link('/labels', 'Etykiety adresów', <Icon d="M3 12V4h8l10 10-8 8L3 12zM7.5 7.5h.01" />)}
          <div className="nav-group">Pomoc</div>
          {link('/method', 'Metodyka', <Icon d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 17v.01M12 14a2.5 2.5 0 10-2.5-2.5" />)}
        </nav>
        <div className="side-foot">
          {meta && (
            <>
              <div className="status"><span className={`dot ${meta.config.chainLive ? 'on' : ''}`} />on-chain: {meta.config.chainLive ? 'publiczne API' : 'wyłączone'}</div>
              <div className="status"><span className={`dot ${meta.config.ai === 'none' ? '' : 'on'}`} />AI: {meta.config.ai === 'none' ? 'wyłączone' : meta.config.aiModel}</div>
            </>
          )}
          <nav className="nav" aria-label="Informacje" style={{ margin: '6px -8px 2px' }}>
            {link('/about', 'O programie', <Icon d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 8v.01" />)}
          </nav>
          <span>Motyw</span>
          <div className="seg" role="radiogroup" aria-label="Motyw interfejsu">
            {(
              [
                ['light', 'Jasny'],
                ['dark', 'Ciemny'],
              ] as [Theme, string][]
            ).map(([v, l]) => (
              <button key={v} role="radio" aria-checked={theme === v} className={theme === v ? 'active' : ''} onClick={() => setTheme(v)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="container">{page}</div>
      </main>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
