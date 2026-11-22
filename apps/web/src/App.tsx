import { useEffect, useState } from 'react';
import { api, ApiError, INVESTIGATIONS_CHANGED, type InvestigationListItem, type Meta } from './api.ts';
import { useTheme } from './theme.ts';
import { ListPage } from './pages/ListPage.tsx';
import { NewPage } from './pages/NewPage.tsx';
import { InvestigationPage } from './pages/InvestigationPage.tsx';
import { ExtractorPage } from './pages/ExtractorPage.tsx';
import { LabelsPage } from './pages/LabelsPage.tsx';
import { MethodPage } from './pages/MethodPage.tsx';
import { AboutPage } from './pages/AboutPage.tsx';
import { TrashPage } from './pages/TrashPage.tsx';

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

function useHash() {
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
  else if (parts[0] === 'trash') page = <TrashPage />;
  else page = <ListPage />;

  const isActive = (href: string) => (href === '/' ? parts.length === 0 || parts[0] === 'inv' : path.startsWith(href));
  const link = (href: string, label: string, icon: React.ReactNode, cls = '', extra: React.ReactNode = null) => (
    <a key={href} href={`#${href}`} className={`${cls} ${isActive(href) ? 'active' : ''}`} aria-current={isActive(href) ? 'page' : undefined}>
      {icon}
      {label}
      {extra}
    </a>
  );
  return (
    <div className="shell">
      {/* przyklejony górny pasek – znak OGAR zawsze widoczny */}
      <header className="topbar">
        <a className="brand" href="#/" aria-label="OGAR – lista analiz">
          <img className="brand-logo" src="/ogar.svg" alt="" aria-hidden />
          <b>OGAR</b>
        </a>
        <span className="topbar-sep" aria-hidden />
        <span className="topbar-tag">
          Narzędzie analityczne
          <br />
          administracji
        </span>
        <div className="topbar-right">
          {/* przełącznik motywu: suwak słońce / księżyc */}
          <button
            type="button"
            role="switch"
            aria-checked={theme === 'dark'}
            aria-label="Motyw ciemny"
            title={theme === 'dark' ? 'Przełącz na motyw jasny' : 'Przełącz na motyw ciemny'}
            className={`theme-switch ${theme}`}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <span className="ts-icon ts-sun"><Icon d={SUN} /></span>
            <span className="ts-icon ts-moon"><Icon d={MOON} /></span>
            <span className="ts-knob" aria-hidden>
              <Icon d={theme === 'dark' ? MOON : SUN} />
            </span>
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidenav">
          <SidenavPattern />
          <nav className="nav" aria-label="Główna nawigacja">
            {link('/', 'Analizy', <Icon d="M3 7h18M3 12h18M3 17h12" />)}
            {link('/extract', 'Ekstraktor adresów', <Icon d="M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3" />)}
            {link('/labels', 'Etykiety adresów', <Icon d="M3 12V4h8l10 10-8 8L3 12zM7.5 7.5h.01" />)}
            {link('/method', 'Metodyka', <Icon d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 17v.01M12 14a2.5 2.5 0 10-2.5-2.5" />)}
            {link('/trash', 'Kosz', <Icon d="M3 6h18M8 6V4h8v2M6 6l1 14a1 1 0 001 1h8a1 1 0 001-1l1-14M10 11v6M14 11v6" />, '', meta ? <TrashCount /> : null)}
          </nav>
          {meta && <RecentCases current={parts[0] === 'inv' ? parts[1] : undefined} />}
          <div className="side-bottom">
            {meta && (
              <div className="side-status">
                <span className="status">
                  <span className={`dot ${meta.config.ai === 'none' ? '' : 'on'}`} />
                  AI: {meta.config.ai === 'none' ? 'wyłączone' : meta.config.aiModel}
                </span>
                <span className="status">
                  <span className={`dot ${meta.config.chainLive ? 'on' : ''}`} />
                  on-chain: {meta.config.chainLive ? 'publiczne API' : 'wyłączone'}
                </span>
              </div>
            )}
            <nav className="nav side-about" aria-label="Informacje">
              {link('/about', 'O programie', <Icon d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 8v.01" />)}
            </nav>
          </div>
        </aside>
        <main className="main">
          <div className="container">{page}</div>
        </main>
      </div>
    </div>
  );
}

// „Ostatnie sprawy" w menu bocznym – 5 ostatnio zmienianych analiz z najwyższym Wskaźnikiem Pewności.
function RecentCases({ current }: { current?: string }) {
  const [items, setItems] = useState<InvestigationListItem[]>([]);
  useEffect(() => {
    const load = () => api.list().then(setItems).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    window.addEventListener(INVESTIGATIONS_CHANGED, load); // usunięcie / przywrócenie / nowa analiza – od razu
    return () => {
      clearInterval(t);
      window.removeEventListener(INVESTIGATIONS_CHANGED, load);
    };
  }, []);
  if (!items.length) return null;
  const recent = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  return (
    <div className="recent">
      <div className="nav-group">Ostatnie sprawy</div>
      {recent.map((i) => (
        <a key={i.id} href={`#/inv/${i.id}`} className={i.id === current ? 'active' : ''} aria-current={i.id === current ? 'page' : undefined} title={i.name}>
          <span className="recent-name">{i.name}</span>
          <span className="recent-score">{i.topScore != null ? `${i.topScore}%` : '—'}</span>
        </a>
      ))}
    </div>
  );
}

const SUN = 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4';
const MOON = 'M21 13A9 9 0 1111 3a7 7 0 0010 10z';

// Tło menu: „sieć powiązań” zanikająca ku górze (maska w CSS); stałe ziarno = ten sam wzór przy każdym odświeżeniu.
const NET = (() => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pts = Array.from({ length: 46 }, () => ({ x: 12 + rnd() * 208, y: 552 - Math.pow(rnd(), 1.4) * 540 }));
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  pts.forEach((p, i) => {
    pts
      .map((q, j) => ({ j, d: (p.x - q.x) ** 2 + (p.y - q.y) ** 2 }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .forEach(({ j }) => {
        const k = `${Math.min(i, j)}-${Math.max(i, j)}`;
        if (!seen.has(k)) {
          seen.add(k);
          edges.push([i, j]);
        }
      });
  });
  return { pts, edges, hot: new Set([3, 11, 19, 31]) };
})();

function SidenavPattern() {
  return (
    <div className="sidenav-pattern" aria-hidden>
      <svg viewBox="0 0 232 560" preserveAspectRatio="xMidYMax slice">
        {NET.edges.map(([i, j]) => (
          <line key={`${i}-${j}`} x1={NET.pts[i].x} y1={NET.pts[i].y} x2={NET.pts[j].x} y2={NET.pts[j].y} />
        ))}
        {NET.pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={NET.hot.has(i) ? 4 : i % 3 === 0 ? 3 : 2.2} className={NET.hot.has(i) ? 'hot' : undefined} />
        ))}
      </svg>
    </div>
  );
}

// Liczba analiz w koszu – plakietka przy „Kosz" w menu (ukryta, gdy kosz jest pusty).
function TrashCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const load = () => api.trash().then((t) => setN(t.items.length)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    window.addEventListener(INVESTIGATIONS_CHANGED, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(INVESTIGATIONS_CHANGED, load);
    };
  }, []);
  return n > 0 ? <span className="nav-count" aria-label={`${n} w koszu`}>{n}</span> : null;
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
