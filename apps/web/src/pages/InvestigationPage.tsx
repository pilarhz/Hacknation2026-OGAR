import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fmtDate, fmtNum, INVALID_REASON_LABELS, isAttributed, shortAddr, SCHEDULES, type CompareResult, type Investigation, type InvalidReason, type Meta, type RunResult, type RunRow } from '../api.ts';
import { go } from '../App.tsx';
import { ScoreBadge, ScoreBar, BAND_SHORT, Chain } from '../components/Score.tsx';
import { AddressDetail } from '../components/AddressDetail.tsx';
import { RelationMap } from '../components/RelationMap.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { InvalidReasonFields } from './NewPage.tsx';

const LEVEL_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

type Tab = 'summary' | 'addresses' | 'map' | 'timeline' | 'sources' | 'compare' | 'log';

export function InvestigationPage({ id, meta }: { id: string; meta: Meta }) {
  const [inv, setInv] = useState<Investigation | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [selected, setSelected] = useState<string | null>(null);
  const [doc, setDoc] = useState<Awaited<ReturnType<typeof api.document>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const closeConfirm = useCallback(() => setConfirmDel(false), []);
  const [invOpen, setInvOpen] = useState(false);
  const [invReason, setInvReason] = useState<InvalidReason>('wrong-identifier');
  const [invNote, setInvNote] = useState('');
  const [invBusy, setInvBusy] = useState(false);
  const [invErr, setInvErr] = useState<string | null>(null);
  const closeInvalidate = useCallback(() => setInvOpen(false), []);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get(id);
      setInv(r.investigation);
      setRuns(r.runs);
      setRunId((cur) => {
        const latestDone = r.runs.find((x) => x.status === 'done' && !x.invalidated) ?? r.runs.find((x) => x.status === 'done');
        if (!cur) return latestDone?.id ?? r.runs[0]?.id ?? null;
        // automatycznie przełącz na nowy przebieg, gdy poprzedni wybrany był najnowszym
        const curIdx = r.runs.findIndex((x) => x.id === cur);
        if (curIdx > 0 && latestDone && r.runs[curIdx - 1]?.id === latestDone.id && r.runs.slice(0, curIdx).every((x) => x.status !== 'running')) return latestDone.id;
        return cur;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  const anyRunning = runs.some((r) => r.status === 'running');
  useEffect(() => {
    const t = setInterval(load, anyRunning ? 1200 : 10000);
    return () => clearInterval(t);
  }, [anyRunning, load]);

  const currentRun = runs.find((r) => r.id === runId);
  useEffect(() => {
    if (!runId || currentRun?.status !== 'done') {
      setResult(null);
      return;
    }
    api.run(runId).then((r) => setResult(r.result)).catch((e) => setActionErr(`Nie udało się wczytać wyników: ${e instanceof Error ? e.message : String(e)}`));
  }, [runId, currentRun?.status]);

  const openDoc = useCallback(
    async (docId: string) => {
      if (!runId) return;
      setDoc(await api.document(runId, docId));
    },
    [runId],
  );

  if (err) return <div className="callout red">{err}</div>;
  if (!inv) return <div className="empty">Ładowanie…</div>;

  const rerun = async () => {
    try {
      const r = await api.rerun(inv.id);
      setRunId(r.runId);
      setActionErr(null);
      load();
    } catch (e) {
      setActionErr(`Nie udało się uruchomić analizy: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const revalidate = async (r: RunRow) => {
    try {
      await api.revalidateRun(r.id);
      setActionErr(null);
      load();
    } catch (e) {
      setActionErr(`Nie udało się cofnąć unieważnienia: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const latestSeq = runs[0]?.seq;
  return (
    <>
      <div className="page-head" style={{ marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <a href="#/" className="crumb">
            ← Wszystkie analizy
          </a>
          <h1>{inv.name}</h1>
          <div className="row small" style={{ gap: 6 }}>
            <span className="muted">Dane wejściowe:</span>
            {inv.seeds.map((s, i) => (
              <span key={i} className="tag">
                {meta.identifierKinds.find((k) => k.id === s.kind)?.label}: <b>{s.value}</b>
              </span>
            ))}
          </div>
        </div>
        <div className="actions">
          {result && runId && (
            <a className="btn" href={`/api/runs/${runId}/report.html`} target="_blank" rel="noreferrer">
              Raport OSINT ↗
            </a>
          )}
          <button className="primary" onClick={rerun} disabled={anyRunning}>
            {anyRunning ? 'Trwa analiza…' : '↻ Uruchom ponownie'}
          </button>
          <details className="menu">
            <summary className="btn" aria-label="Więcej akcji">⋯</summary>
            <div className="menu-list">
              {result && runId && (
                <>
                  <a href={`/api/runs/${runId}/export.json`}>Eksport JSON</a>
                  <a href={`/api/runs/${runId}/export.csv`}>Eksport CSV</a>
                  <hr />
                </>
              )}
              <a href={`#/inv/${inv.id}/edit`}>Popraw parametry i uruchom ponownie…</a>
              {currentRun && currentRun.status !== 'running' && !currentRun.invalidated && (
                <button
                  onClick={(e) => {
                    e.currentTarget.closest('details')?.removeAttribute('open');
                    setInvReason('wrong-identifier');
                    setInvNote('');
                    setInvErr(null);
                    setInvOpen(true);
                  }}
                >
                  Oznacz przebieg #{currentRun.seq} jako błędny…
                </button>
              )}
              <hr />
              <button
                className="danger"
                onClick={(e) => {
                  e.currentTarget.closest('details')?.removeAttribute('open');
                  setDelErr(null);
                  setConfirmDel(true);
                }}
              >
                Usuń analizę…
              </button>
            </div>
          </details>
        </div>
      </div>

      <div className="panel row" style={{ padding: '10px 16px', gap: 20 }}>
        <label className="row small" style={{ gap: 8 }}>
          <span className="muted">Przebieg</span>
          <select value={runId ?? ''} onChange={(e) => setRunId(e.target.value)}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.seq} · {fmtDate(r.startedAt).slice(0, 17)}
                {r.trigger === 'schedule' ? ' · cykliczny' : ''}
                {r.status === 'running' ? ' · trwa…' : r.status === 'error' ? ' · błąd' : ''}
                {r.invalidated ? ' · UNIEWAŻNIONY' : ''}
                {r.seq === latestSeq ? ' (najnowszy)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="row small" style={{ gap: 8 }}>
          <span className="muted">Analiza cykliczna</span>
          <select
            value={inv.scheduleMinutes ?? 0}
            onChange={async (e) => {
              await api.schedule(inv.id, Number(e.target.value) || null);
              load();
            }}
          >
            {SCHEDULES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        {inv.scheduleMinutes ? <span className="small muted">następny przebieg: {fmtDate(inv.nextRunAt)}</span> : null}
        <span className="small muted" style={{ marginLeft: 'auto' }}>
          źródła: {inv.options.sources.join(', ')} · głębokość pivotu {inv.options.maxDepth}
        </span>
      </div>

      {currentRun?.status === 'running' && (
        <div className="panel progress">
          <div className="spinner" />
          <div>
            <b>Trwa analiza…</b>
            <div className="muted small">{currentRun.progress}</div>
          </div>
        </div>
      )}
      {currentRun?.status === 'error' && <div className="callout red">Przebieg zakończony błędem: {currentRun.error}</div>}
      {actionErr && <div className="callout red">{actionErr}</div>}
      {currentRun?.invalidated && (
        <div className="callout red run-invalid" role="status">
          <div>
            <b>Przebieg #{currentRun.seq} unieważniony</b> · {INVALID_REASON_LABELS[currentRun.invalidated.reason] ?? currentRun.invalidated.reason}
            {currentRun.invalidated.note ? <>: {currentRun.invalidated.note}</> : null}
            <div className="small">
              Oznaczony {fmtDate(currentRun.invalidated.at)}.
            </div>
          </div>
          <button className="sm" onClick={() => revalidate(currentRun)}>Cofnij unieważnienie</button>
        </div>
      )}

      {result && (
        <>
          <div className="tabs" role="tablist">
            {(
              [
                ['summary', 'Podsumowanie', null],
                ['addresses', 'Adresy', result.addresses.length],
                ['map', 'Mapa powiązań', null],
                ['timeline', 'Przepływ środków', result.timeline.length],
                ['sources', 'Źródła i tożsamość', result.documents.length],
                ['compare', 'Zmiany w czasie', null],
                ['log', 'Rejestr zapytań', result.requestLog.length],
              ] as [Tab, string, number | null][]
            ).map(([t, l, c]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {l}
                {c !== null && <span className="count">{c}</span>}
              </button>
            ))}
          </div>
          {tab === 'summary' && (
            <Summary
              r={result}
              approved={inv.options.approvedHosts ?? []}
              onApprove={async (host) => {
                await api.approveHost(inv.id, host);
                load();
              }}
              onPick={(k) => {
                setSelected(k);
                setTab('addresses');
              }}
            />
          )}
          {tab === 'addresses' && <Addresses r={result} meta={meta} selected={selected} setSelected={setSelected} openDoc={openDoc} />}
          {tab === 'map' && (
            <RelationMap
              r={result}
              meta={meta}
              onOpenAddress={(k) => {
                setSelected(k);
                setTab('addresses');
              }}
            />
          )}
          {tab === 'timeline' && <Timeline r={result} meta={meta} />}
          {tab === 'sources' && <Sources r={result} openDoc={openDoc} />}
          {tab === 'compare' && <Compare runs={runs.filter((r) => r.status === 'done' && (!r.invalidated || r.id === runId))} current={runId!} />}
          {tab === 'log' && <Log r={result} />}
        </>
      )}

      {doc && (
        <div className="modal-bg" onClick={() => setDoc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>{doc.title}</h3>
              <button onClick={() => setDoc(null)}>Zamknij</button>
            </div>
            <div className="small muted">
              <a href={doc.url} target="_blank" rel="noreferrer">
                {doc.url}
              </a>
              <br />
              pobrano {fmtDate(doc.fetched_at)} · SHA-256 <span className="mono">{doc.sha256}</span>
            </div>
            <pre>{doc.content}</pre>
          </div>
        </div>
      )}

      {invOpen && currentRun && (
        <ConfirmDialog
          title={`Oznaczyć przebieg #${currentRun.seq} jako błędny?`}
          confirmLabel="Oznacz jako błędny"
          busyLabel="Zapisywanie…"
          busy={invBusy}
          error={invErr}
          onCancel={closeInvalidate}
          onConfirm={async () => {
            if (invReason === 'other' && !invNote.trim()) {
              setInvErr('Przy powodzie „Inny powód” opisz, co było nie tak.');
              return;
            }
            setInvBusy(true);
            setInvErr(null);
            try {
              await api.invalidateRun(currentRun.id, invReason, invNote.trim() || undefined);
              setInvOpen(false);
              load();
            } catch (e) {
              setInvErr(`Nie udało się zapisać: ${e instanceof Error ? e.message : String(e)}`);
            } finally {
              setInvBusy(false);
            }
          }}
        >
          <p>
            Przebieg <b>nie zostanie usunięty</b>: zostaje w historii sprawy i w dzienniku audytu. Przestanie liczyć się jako aktualny wynik, a porównania w czasie będą go pomijać. Oznaczenie można cofnąć.
          </p>
          <InvalidReasonFields reason={invReason} setReason={setInvReason} note={invNote} setNote={setInvNote} />
        </ConfirmDialog>
      )}

      {confirmDel && (
        <ConfirmDialog
          title="Przenieść analizę do kosza?"
          confirmLabel="Przenieś do kosza"
          busyLabel="Przenoszenie…"
          danger
          busy={deleting}
          error={delErr}
          onCancel={closeConfirm}
          onConfirm={async () => {
            setDeleting(true);
            setDelErr(null);
            try {
              await api.remove(inv.id);
              go('/');
            } catch (e) {
              setDelErr(`Nie udało się usunąć analizy: ${e instanceof Error ? e.message : String(e)}`);
              setDeleting(false);
            }
          }}
        >
          <p>
            Analiza <b>{inv.name}</b> razem z przebiegami ({runs.length}) i zapisanymi dokumentami trafi do kosza
            {inv.scheduleMinutes ? ', a analiza cykliczna zostanie wstrzymana' : ''}.
          </p>
          <p className="muted small">
            Przez 30 dni możesz ją przywrócić z <a href="#/trash">kosza</a>. Potem zostanie usunięta na stałe.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

function Summary({ r, onPick, approved, onApprove }: { r: RunResult; onPick: (key: string) => void; approved: string[]; onApprove: (host: string) => void }) {
  const s = r.stats;
  const top = r.addresses.filter(isAttributed); // silnik sortuje malejąco po wyniku
  const skipped = r.skippedUrls ?? [];
  const best = top[0] ?? null;
  return (
    <>
      {skipped.length > 0 && (
        <div className="panel callout warn">
          <b>Strony ujawnione w trakcie analizy, których nie pobrano</b>
          <table style={{ marginTop: 6 }}>
            <tbody>
              {skipped.map((u) => (
                <tr key={u.url}>
                  <td className="mono small">{u.url}</td>
                  <td className="small muted">znaleziono w: {u.foundIn || '—'}</td>
                  <td>
                    {approved.includes(u.host) ? (
                      <span className="tag ok">zatwierdzono {u.host}</span>
                    ) : (
                      <button style={{ padding: '2px 10px' }} onClick={() => onApprove(u.host)}>
                        Zatwierdź host {u.host}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.documents.some((d) => d.synthetic) && (
        <div className="callout warn small">
          <b>Dane testowe.</b> Przebieg zawiera dane z piaskownicy (fikcyjne osoby, adresy i transakcje).
        </div>
      )}

      <div className="doc-h"><span className="n">1.</span> Wniosek główny</div>
      {best ? (
        <div className="verdict">
          <div className="big">{best.score.score}%</div>
          <div>
            <div className="label">Wskaźnik Pewności · {BAND_SHORT[best.score.band]}</div>
            <p className="sentence">
              Adres <Chain chain={best.chain} />
              <span className="mono nowrap" style={{ fontSize: 15 }} title={best.address}>{shortAddr(best.address)}</span> należy do badanego z pewnością{' '}
              <b className={`t-${best.score.band}`}>{best.score.score}%</b>, potwierdzoną w {best.score.independentSites.length} niezależnych źródłach.
              {s.cashOutSignals > 0 ? (
                <>
                  {' '}Wykryto <b style={{ color: 'var(--danger)' }}>{s.cashOutSignals} sygnałów wyjścia do walut tradycyjnych</b>.
                </>
              ) : (
                ' Nie wykryto sygnałów wyjścia do walut tradycyjnych.'
              )}
            </p>
            <button className="sm" style={{ marginTop: 12 }} onClick={() => onPick(best.key)}>Zobacz dowody i wyliczenie →</button>
          </div>
        </div>
      ) : (
        <div className="verdict neutral">
          <div className="big">—</div>
          <div>
            <div className="label">Brak przypisania</div>
            <p className="sentence">Żaden adres nie osiągnął Wskaźnika Pewności ≥ 40%.</p>
          </div>
        </div>
      )}

      <div className="doc-h"><span className="n">2.</span> Kluczowe liczby</div>
      <div className="kpis">
        <div className="kpi good"><b>{s.attributed}</b><span>adresów przypisanych badanemu (≥40%)</span></div>
        <div className={`kpi ${s.cashOutSignals > 0 ? 'alert' : ''}`}><b>{s.cashOutSignals}</b><span>sygnałów wyjścia do fiat</span></div>
        <div className="kpi"><b>{s.excluded}</b><span>wykluczonych (giełdy, kontrakty…)</span></div>
        <div className="kpi"><b>{s.addresses}</b><span>poprawnych adresów znalezionych</span></div>
      </div>
      <div className="meta-line">
        <span><b>{s.identifiers}</b> identyfikatorów (wejście + pivot)</span>
        <span><b>{s.documents}</b> przeanalizowanych dokumentów</span>
        <span><b>{s.requests}</b> zapytań sieciowych</span>
        <span>czas analizy <b>{(s.durationMs / 1000).toFixed(1)} s</b></span>
      </div>

      <div className="doc-h">
        <span className="n">3.</span> Adresy powiązane z badanym
      </div>
      <div className="panel flush">
        {top.length === 0 ? (
          <div className="empty">Brak adresów z wynikiem ≥ 40%.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th style={{ width: 80 }}>Pewność</th><th>Adres</th><th>Przedział</th><th>Źródła</th><th>Sygnały on-chain</th></tr>
              </thead>
              <tbody>
                {top.map((a) => (
                  <tr key={a.key} className="clickable" onClick={() => onPick(a.key)}>
                    <td><ScoreBadge score={a.score.score} band={a.score.band} /></td>
                    <td className="addr-cell"><Chain chain={a.chain} /><span className="mono" title={a.address}>{shortAddr(a.address)}</span></td>
                    <td><span className={`band-label t-${a.score.band}`}>{BAND_SHORT[a.score.band]}</span></td>
                    <td className="small">{a.score.independentSites.length} niezależne</td>
                    <td>
                      {a.indicators.filter((i) => i.cashOut).map((i) => <span key={i.code} className="tag cash">{i.code}</span>)}
                      {a.indicators.some((i) => i.code === 'MIXER') && <span className="tag cash">mikser</span>}
                      {!a.indicators.some((i) => i.cashOut || i.code === 'MIXER') && <span className="muted small">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="doc-h">
        <span className="n">4.</span> Wnioski wymagające weryfikacji <span className="aside">{r.conclusions.length} pozycji · od najważniejszych</span>
      </div>
      <div className="panel flush">
        {r.conclusions.length === 0 && <div className="empty">Brak wniosków.</div>}
        {[...r.conclusions]
          .sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level])
          .map((c, i) => (
            <div key={i} className={`conclusion ${c.level}`}>
              <span className={`lvl ${c.level}`}>{c.level === 'high' ? 'istotne' : c.level === 'medium' ? 'średnie' : 'info'}</span>
              {c.text}
              <div className="verify"><b>Do weryfikacji:</b> {c.verify}</div>
            </div>
          ))}
      </div>
      {r.swaps.length > 0 && (
        <div className="panel callout warn">
          <b>Wykryto zmianę adresów na tej samej stronie w czasie</b>
          {r.swaps.map((s, i) => (
            <div key={i} className="small mono">{s.url}: {s.before.join(', ')} → {s.after.join(', ')}</div>
          ))}
        </div>
      )}
      {r.notes.length > 0 && (
        <div className="panel small">
          <b>Uwagi techniczne:</b>
          <ul>{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
    </>
  );
}

function Addresses({ r, meta, selected, setSelected, openDoc }: { r: RunResult; meta: Meta; selected: string | null; setSelected: (k: string | null) => void; openDoc: (d: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'attributed' | 'excluded'>('all');
  const list = r.addresses.filter((a) => (filter === 'all' ? true : filter === 'excluded' ? a.score.excluded : isAttributed(a)));
  const sel = r.addresses.find((a) => a.key === selected) ?? list[0];
  const counts = {
    all: r.addresses.length,
    attributed: r.addresses.filter(isAttributed).length,
    excluded: r.addresses.filter((a) => a.score.excluded).length,
  };
  return (
    <div className="addr-layout">
      <div className="panel flush table-wrap">
        <div className="panel-head">
          <div className="seg" role="group" aria-label="Filtr adresów">
            {(['all', 'attributed', 'excluded'] as const).map((f) => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? 'Wszystkie' : f === 'attributed' ? 'Przypisane' : 'Wykluczone'} {counts[f]}
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 && <div className="empty">Brak adresów w tej kategorii.</div>}
        <table>
          <tbody>
            {list.map((a) => (
              <tr key={a.key} className={`clickable ${a.key === sel?.key ? 'selected' : ''}`} onClick={() => setSelected(a.key)}>
                <td style={{ width: 70 }}><ScoreBadge score={a.score.score} band={a.score.band} /></td>
                <td className="addr-cell">
                  <div><Chain chain={a.chain} /><span className="mono" title={a.address}>{shortAddr(a.address)}</span></div>
                  <ScoreBar score={a.score.score} band={a.score.band} />
                  <div className="small muted">
                    {a.label ? <b style={{ color: 'var(--ink-2)' }}>{a.label.name}</b> : BAND_SHORT[a.score.band]} · {a.evidence.length} wystąp.
                    {a.indicators.some((i) => i.cashOut) && <> <span className="tag cash">cash-out</span></>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel detail">{sel ? <AddressDetail a={sel} meta={meta} onOpenDoc={openDoc} /> : <div className="empty">Wybierz adres z listy.</div>}</div>
    </div>
  );
}

function Timeline({ r, meta }: { r: RunResult; meta: Meta }) {
  return (
    <div className="panel flush table-wrap">
      <table>
        <thead>
          <tr><th>Czas</th><th>Adres</th><th>Kierunek</th><th>Kwota</th><th>Kontrahent</th><th>Tx</th></tr>
        </thead>
        <tbody>
          {r.timeline.map((t, i) => (
            <tr key={i} className={t.cashOut ? 'cashout' : undefined}>
              <td className="small nowrap">{fmtDate(t.time)}</td>
              <td className="addr-cell small"><Chain chain={t.chain} /><span className="mono">{shortAddr(t.address)}</span></td>
              <td>{t.direction === 'in' ? '⬅ wpływ' : t.direction === 'out' ? '➡ wypływ' : '↺'}</td>
              <td><b>{fmtNum(t.amount)}</b> {t.asset}</td>
              <td className="small">
                {t.counterpartyLabel ? <><b>{t.counterpartyLabel}</b> <span className="tag">{meta.categories[t.counterpartyCategory ?? ''] ?? t.counterpartyCategory}</span></> : <span className="mono">{t.counterparty ? shortAddr(t.counterparty) : '—'}</span>}
                {t.cashOut && <span className="tag cash">cash-out</span>}
              </td>
              <td className="mono small muted">{t.hash.slice(0, 16)} {t.synthetic && <span className="tag syn">syn.</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.timeline.length === 0 && <div className="empty">Brak transakcji dla adresów przypisanych.</div>}
    </div>
  );
}

function Sources({ r, openDoc }: { r: RunResult; openDoc: (d: string) => void }) {
  return (
    <>
      <div className="panel flush table-wrap">
        <table>
          <thead>
            <tr><th>Dok.</th><th>Źródło / tytuł</th><th>Typ</th><th>Autor</th><th>Należy do badanego</th><th>Adresy</th><th>Pobrano / SHA-256</th></tr>
          </thead>
          <tbody>
            {r.documents.map((d) => (
              <tr key={d.id}>
                <td><button style={{ padding: '2px 8px' }} onClick={() => openDoc(d.id)}>{d.id}</button></td>
                <td className="small">
                  <b>{d.site}</b> <span className="muted">({d.source})</span> {d.synthetic && <span className="tag syn">syn.</span>}
                  <br /><a href={d.url} target="_blank" rel="noreferrer">{d.title}</a>
                  <div className="muted">znaleziono przez: {d.viaIdentifier} · {d.query}</div>
                </td>
                <td className="small">{d.kind}</td>
                <td className="small">{d.author ?? '—'}</td>
                <td className="small">{d.ownedBySubject ? <span className="tag ok">tak</span> : <span className="tag">nie</span>}<div className="muted">{d.ownershipRule}</div></td>
                <td>{d.addressCount}</td>
                <td className="small muted">{fmtDate(d.fetchedAt)}<br /><span className="mono">{d.sha256.slice(0, 16)}…</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h3>Konta i potwierdzenie tożsamości</h3>
        {(r.identity ?? []).map((c) => (
          <div key={c.id} className={`callout ${c.confirmed ? '' : 'warn'}`} style={{ marginBottom: 6 }}>
            <b>{c.confirmed ? '✔ Potwierdzona grupa kont badanego' : 'Konto/grupa niepotwierdzona'}</b> <span className="small muted">– {c.reason}</span>
            <div>
              {c.accounts.map((a) => (
                <span key={a.site + a.handle} className="tag">
                  {a.site} / <b>{a.handle}</b>
                </span>
              ))}
            </div>
            {c.links.length > 0 && (
              <details className="small">
                <summary>powiązania ({c.links.length})</summary>
                {c.links.map((l, i) => (
                  <div key={i} className="mono">{l}</div>
                ))}
              </details>
            )}
          </div>
        ))}
        <h3>Ścieżka identyfikatorów (pivot)</h3>
        <table>
          <tbody>
            {r.identifiers.map((i, k) => (
              <tr key={k}>
                <td style={{ width: 280 }}><span className="tag blue">{i.kind}</span> <b>{i.value}</b></td>
                <td className="small">{i.origin === 'input' ? 'dane wejściowe' : <>{i.via?.rule} – <a href={i.via?.url} target="_blank" rel="noreferrer">{i.via?.url}</a></>}</td>
                <td className="small muted">krok {i.depth}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.rejected.length > 0 && (
          <>
            <h3>Odrzuceni kandydaci na adresy</h3>
            <table><tbody>{r.rejected.map((x, k) => <tr key={k}><td className="mono small">{x.candidate}</td><td className="small">{x.reason}</td><td className="small muted">{x.docId}</td></tr>)}</tbody></table>
          </>
        )}
      </div>
    </>
  );
}

function Compare({ runs, current }: { runs: RunRow[]; current: string }) {
  const [a, setA] = useState<string>(runs[1]?.id ?? runs[0]?.id ?? '');
  const [b, setB] = useState<string>(current);
  const [res, setRes] = useState<CompareResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!a || !b || a === b) {
      setRes(null);
      return;
    }
    setErr(null);
    api.compare(a, b).then(setRes).catch((e) => setErr(String(e.message ?? e)));
  }, [a, b]);
  const opts = useMemo(() => runs.map((r) => <option key={r.id} value={r.id}>#{r.seq} · {fmtDate(r.startedAt)}{r.invalidated ? ' · UNIEWAŻNIONY' : ''}</option>), [runs]);
  if (runs.length < 2) return <div className="panel empty">Do porównania potrzebne są co najmniej dwa zakończone przebiegi.</div>;
  const Empty = () => <span className="muted small">brak</span>;
  return (
    <div className="panel">
      <div className="row">
        Porównaj przebieg <select value={a} onChange={(e) => setA(e.target.value)}>{opts}</select> z <select value={b} onChange={(e) => setB(e.target.value)}>{opts}</select>
      </div>
      {err && <div className="callout red">{err}</div>}
      {res && (
        <>
          {res.pageChanges.length > 0 && (
            <div className="callout red" style={{ marginTop: 12 }}>
              <b>Zmiana adresów opublikowanych na tych samych stronach (możliwa podmiana portfela)</b>
              {res.pageChanges.map((p, i) => (
                <div key={i} className="small">
                  <a href={p.url} target="_blank" rel="noreferrer">{p.url}</a>:{' '}
                  {p.removed.map((k) => <span key={k} className="mono diff-del">− {k} </span>)}
                  {p.added.map((k) => <span key={k} className="mono diff-add">+ {k} </span>)}
                </div>
              ))}
            </div>
          )}
          <div className="grid2" style={{ marginTop: 12 }}>
            <div>
              <h3>Nowe adresy</h3>
              {res.newAddresses.length ? res.newAddresses.map((x) => <div key={x.key} className="mono small diff-add">+ {x.chain} {x.address} ({x.score}%)</div>) : <Empty />}
              <h3>Adresy, które zniknęły</h3>
              {res.removedAddresses.length ? res.removedAddresses.map((x) => <div key={x.key} className="mono small diff-del">− {x.chain} {x.address} ({x.score}%)</div>) : <Empty />}
              <h3>Zmiany Wskaźnika Pewności</h3>
              {res.scoreChanges.length ? res.scoreChanges.map((x) => <div key={x.key} className="mono small">{x.chain} {shortAddr(x.address)}: {x.before}% → {x.after}%</div>) : <Empty />}
              <h3>Nowe sygnały wyjścia do fiat</h3>
              {res.newCashOut.length ? res.newCashOut.map((x, i) => <div key={i} className="small">💶 {shortAddr(x.address)} – {x.title}</div>) : <Empty />}
            </div>
            <div>
              <h3>Zmienione dokumenty (inna treść / hash)</h3>
              {res.changedDocs.length ? res.changedDocs.map((d) => <div key={d.url} className="small">✎ <a href={d.url} target="_blank" rel="noreferrer">{d.title}</a></div>) : <Empty />}
              <h3>Nowe dokumenty</h3>
              {res.newDocs.length ? res.newDocs.map((d) => <div key={d.url} className="small diff-add">+ {d.title}</div>) : <Empty />}
              <h3>Dokumenty niedostępne</h3>
              {res.goneDocs.length ? res.goneDocs.map((d) => <div key={d.url} className="small diff-del">− {d.title}</div>) : <Empty />}
              <h3>Nowe identyfikatory</h3>
              {res.newIdentifiers.length ? res.newIdentifiers.map((d, i) => <span key={i} className="tag">{d.kind}: {d.value}</span>) : <Empty />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Log({ r }: { r: RunResult }) {
  return (
    <div className="panel flush table-wrap">
      <div style={{ padding: '10px 14px' }} className="small muted">
        Wszystkie zapytania sieciowe przebiegu (biała lista hostów: {(r.configSnapshot.allowedHosts as string[] | undefined)?.length ?? 0} pozycji). Silnik v{r.engineVersion}, {fmtDate(r.startedAt)} – {fmtDate(r.finishedAt)}.
      </div>
      <table>
        <thead><tr><th>Czas</th><th>URL</th><th>Status</th><th>Cache</th><th>ms</th></tr></thead>
        <tbody>
          {r.requestLog.map((l, i) => (
            <tr key={i}>
              <td className="small muted">{fmtDate(l.ts)}</td>
              <td className="mono small">{l.url}</td>
              <td className="small">{String(l.status)}</td>
              <td className="small">{l.cache ? 'tak' : ''}</td>
              <td className="small">{l.ms}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
