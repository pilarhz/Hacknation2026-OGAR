import { useEffect, useState } from 'react';
import { api, fmtDate, type InvestigationListItem } from '../api.ts';
import { go } from '../App.tsx';

export function ListPage() {
  const [items, setItems] = useState<InvestigationListItem[] | null>(null);
  const load = () => api.list().then(setItems);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  if (!items) return <div className="empty">Ładowanie…</div>;
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h1>Analizy</h1>
          <div className="muted">Sprawy OSINT: identyfikatory wejściowe, przebiegi cykliczne i ich wyniki.</div>
        </div>
        <button className="primary" onClick={() => go('/new')}>
          + Nowa analiza
        </button>
      </div>
      {items.length === 0 ? (
        <div className="panel empty">
          Brak analiz. <a href="#/new">Utwórz pierwszą analizę</a> – np. ze scenariusza testowego na danych syntetycznych.
        </div>
      ) : (
        <div className="panel flush">
          <table>
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>Dane wejściowe</th>
                <th>Przebiegi</th>
                <th>Harmonogram</th>
                <th>Ostatni wynik</th>
                <th>Aktualizacja</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => go(`/inv/${i.id}`)}>
                  <td>
                    <b>{i.name}</b>
                    {i.caseRef && <div className="muted small">{i.caseRef}</div>}
                  </td>
                  <td>
                    {i.seeds.map((s, k) => (
                      <span key={k} className="tag">
                        {s.kind}: {s.value.length > 24 ? s.value.slice(0, 22) + '…' : s.value}
                      </span>
                    ))}
                  </td>
                  <td>
                    {i.runCount}
                    {i.lastStatus === 'running' && <span className="tag blue">trwa…</span>}
                    {i.lastStatus === 'error' && <span className="tag cash">błąd</span>}
                  </td>
                  <td>{i.scheduleMinutes ? `co ${i.scheduleMinutes} min` : <span className="muted">ręcznie</span>}</td>
                  <td>
                    {i.lastStats ? (
                      <span className="small">
                        {i.lastStats.attributed} przypisanych · {i.lastStats.excluded} wykluczonych · {i.lastStats.cashOutSignals} sygnałów cash-out
                        {i.topScore !== null && <> · max {i.topScore}%</>}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="small muted">{fmtDate(i.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
