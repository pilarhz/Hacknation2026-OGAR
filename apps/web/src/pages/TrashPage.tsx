import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, INVESTIGATIONS_CHANGED, type TrashItem } from '../api.ts';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';

// Kosz: usunięte analizy leżą tu przez `days` dni (domyślnie 30), potem serwer kasuje je na stałe.
const daysLeft = (purgeAt: string) => Math.max(0, Math.ceil((Date.parse(purgeAt) - Date.now()) / 86_400_000));
const dniLabel = (n: number) => (n === 1 ? 'dzień' : 'dni');

export function TrashPage() {
  const [data, setData] = useState<{ days: number; items: TrashItem[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restored, setRestored] = useState<{ id: string; name: string } | null>(null);
  const [purge, setPurge] = useState<TrashItem | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeErr, setPurgeErr] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api
        .trash()
        .then((d) => {
          setData(d);
          setErr(null);
        })
        .catch((e) => setErr(e instanceof Error ? e.message : String(e))),
    [],
  );
  useEffect(() => {
    load();
    window.addEventListener(INVESTIGATIONS_CHANGED, load);
    return () => window.removeEventListener(INVESTIGATIONS_CHANGED, load);
  }, [load]);
  const closePurge = useCallback(() => setPurge(null), []);

  const restore = async (it: TrashItem) => {
    setBusyId(it.id);
    try {
      await api.restore(it.id);
      setRestored({ id: it.id, name: it.name });
    } catch (e) {
      setErr(`Nie udało się przywrócić analizy: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  const days = data?.days ?? 30;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Kosz</h1>
          <p className="lead">
            Usunięte analizy są tu przechowywane przez {days} dni razem z przebiegami i dokumentami. Możesz je w tym czasie przywrócić. Po {days} dniach są usuwane na stałe.
          </p>
        </div>
      </div>

      {restored && (
        <div className="callout trash-done" role="status">
          <span>
            Przywrócono analizę <b>{restored.name}</b>.
          </span>
          <a className="btn sm" href={`#/inv/${restored.id}`}>Otwórz analizę →</a>
          <button className="ghost sm" aria-label="Zamknij komunikat" onClick={() => setRestored(null)}>✕</button>
        </div>
      )}
      {err && <div className="callout red">{err}</div>}

      {!data ? (
        <div className="empty"><div className="spinner" style={{ margin: '0 auto 10px' }} />Ładowanie…</div>
      ) : data.items.length === 0 ? (
        <div className="panel empty trash-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18M8 6V4h8v2M6 6l1 14a1 1 0 001 1h8a1 1 0 001-1l1-14M10 11v6M14 11v6" />
          </svg>
          <b>Kosz jest pusty</b>
          Usunięte analizy pojawią się tutaj i będzie można je przywrócić przez {days} dni.
        </div>
      ) : (
        <div className="panel flush">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Analiza</th>
                  <th>Usunięto</th>
                  <th>Usunięcie na stałe</th>
                  <th className="right">Przebiegi</th>
                  <th className="right">Akcje</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => {
                  const left = daysLeft(it.purgeAt);
                  return (
                    <tr key={it.id}>
                      <td>
                        <b>{it.name}</b>
                        {it.caseRef && <div className="small muted">Sprawa {it.caseRef}</div>}
                      </td>
                      <td className="small">{fmtDate(it.deletedAt)}</td>
                      <td>
                        <span className={`tag ${left <= 3 ? 'cash' : left <= 7 ? 'syn' : ''}`}>
                          {left === 0 ? 'dziś' : `za ${left} ${dniLabel(left)}`}
                        </span>
                        <div className="small muted">{fmtDate(it.purgeAt)}</div>
                      </td>
                      <td className="right num">{it.runCount}</td>
                      <td className="right">
                        <div className="trash-actions">
                          <button className="primary sm" disabled={busyId === it.id} onClick={() => restore(it)}>
                            {busyId === it.id ? 'Przywracanie…' : 'Przywróć'}
                          </button>
                          <button
                            className="danger sm"
                            disabled={busyId === it.id}
                            onClick={() => {
                              setPurgeErr(null);
                              setPurge(it);
                            }}
                          >
                            Usuń na stałe
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {purge && (
        <ConfirmDialog
          title="Usunąć na stałe?"
          confirmLabel="Usuń na stałe"
          danger
          busy={purging}
          error={purgeErr}
          onCancel={closePurge}
          onConfirm={async () => {
            setPurging(true);
            setPurgeErr(null);
            try {
              await api.purge(purge.id);
              setPurge(null);
            } catch (e) {
              setPurgeErr(`Nie udało się usunąć analizy: ${e instanceof Error ? e.message : String(e)}`);
            } finally {
              setPurging(false);
            }
          }}
        >
          <p>
            Analiza <b>{purge.name}</b> zostanie usunięta na stałe razem ze wszystkimi przebiegami ({purge.runCount}) i zapisanymi dokumentami.
          </p>
          <p className="muted small">Tej operacji nie można cofnąć.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
