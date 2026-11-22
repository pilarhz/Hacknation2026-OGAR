import { useEffect, useState } from 'react';
import { api, fmtDate, fmtSchedule, INVESTIGATIONS_CHANGED, type InvestigationListItem } from '../api.ts';
import { go } from '../App.tsx';

const bandOf = (s: number) => (s >= 80 ? 'VERY_HIGH' : s >= 60 ? 'PROBABLE' : s >= 40 ? 'MEDIUM' : s > 0 ? 'LOW' : 'NOT_ATTRIBUTED');

export function ListPage() {
  const [items, setItems] = useState<InvestigationListItem[] | null>(null);
  const load = () => api.list().then(setItems);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    window.addEventListener(INVESTIGATIONS_CHANGED, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(INVESTIGATIONS_CHANGED, load);
    };
  }, []);
  if (!items) return <div className="empty"><div className="spinner" style={{ margin: '0 auto 10px' }} />Ładowanie…</div>;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analizy</h1>
          <p className="lead">Sprawy OSINT – identyfikatory wejściowe, kolejne przebiegi i najważniejsze wyniki. Kliknij wiersz, aby otworzyć analizę.</p>
        </div>
        <button className="cta" onClick={() => go('/new')}>
          Nowa analiza
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      {items.length === 0 ? (
        <div className="panel empty">
          <b>Nie ma jeszcze żadnej analizy</b>
          Zacznij od scenariusza demonstracyjnego na danych syntetycznych – zajmie to kilka sekund.
          <div style={{ marginTop: 16 }}>
            <button className="primary" onClick={() => go('/new')}>Utwórz pierwszą analizę</button>
          </div>
        </div>
      ) : (
        <div className="panel flush table-wrap">
          <table>
            <thead>
              <tr>
                <th>Analiza</th>
                <th>Dane wejściowe</th>
                <th className="right">Najwyższy wynik</th>
                <th>Ostatni przebieg</th>
                <th>Harmonogram</th>
                <th>Aktualizacja</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => go(`/inv/${i.id}`)}>
                  <td>
                    <b>{i.name}</b>
                    <div className="muted small">
                      {i.caseRef ? `${i.caseRef} · ` : ''}
                      {i.runCount} {i.runCount === 1 ? 'przebieg' : 'przebiegi'}
                    </div>
                  </td>
                  <td>
                    {i.seeds.map((s, k) => (
                      <span key={k} className="tag" title={s.value}>
                        {s.kind}: <b>{s.value.length > 24 ? s.value.slice(0, 22) + '…' : s.value}</b>
                      </span>
                    ))}
                  </td>
                  <td className="right">
                    {i.topScore !== null ? <span className={`score b-${bandOf(i.topScore)}`}>{i.topScore}%</span> : <span className="muted">—</span>}
                  </td>
                  <td className="small">
                    {i.lastStatus === 'running' ? (
                      <span className="status"><span className="dot run" />trwa analiza…</span>
                    ) : i.lastStatus === 'error' ? (
                      <span className="status" style={{ color: 'var(--danger)' }}><span className="dot err" />błąd</span>
                    ) : i.lastStats ? (
                      <>
                        <b>{i.lastStats.attributed}</b> przypisanych · {i.lastStats.excluded} wykluczonych
                        {i.lastStats.cashOutSignals > 0 && (
                          <div><span className="tag cash">{i.lastStats.cashOutSignals} sygnałów cash-out</span></div>
                        )}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="small">{i.scheduleMinutes ? <span className="tag blue">⏱ {fmtSchedule(i.scheduleMinutes)}</span> : <span className="muted">ręcznie</span>}</td>
                  <td className="small muted nowrap">{fmtDate(i.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
