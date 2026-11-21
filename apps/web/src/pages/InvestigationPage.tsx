import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fmtDate, fmtNum, shortAddr, type CompareResult, type Investigation, type Meta, type RunResult, type RunRow } from '../api.ts';
import { go } from '../App.tsx';
import { ScoreBadge, ScoreBar, BAND_SHORT } from '../components/Score.tsx';
import { AddressDetail } from '../components/AddressDetail.tsx';
import { Graph } from '../components/Graph.tsx';

type Tab = 'summary' | 'addresses' | 'graph' | 'timeline' | 'sources' | 'compare' | 'log';

export function InvestigationPage({ id, meta }: { id: string; meta: Meta }) {
  const [inv, setInv] = useState<Investigation | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [selected, setSelected] = useState<string | null>(null);
  const [doc, setDoc] = useState<{ title: string; url: string; content: string; sha256: string; fetched_at: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get(id);
      setInv(r.investigation);
      setRuns(r.runs);
      setRunId((cur) => {
        const latestDone = r.runs.find((x) => x.status === 'done');
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
    api.run(runId).then((r) => setResult(r.result));
  }, [runId, currentRun?.status]);

  const openDoc = useCallback(
    async (docId: string) => {
      if (!runId) return;
      const d = await api.document(runId, docId);
      setDoc({ title: d.title, url: d.url, content: d.content, sha256: d.sha256, fetched_at: d.fetched_at });
    },
    [runId],
  );

  if (err) return <div className="callout red">{err}</div>;
  if (!inv) return <div className="empty">Ładowanie…</div>;

  const rerun = async () => {
    try {
      const r = await api.rerun(inv.id);
      setRunId(r.runId);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <a href="#/" className="small">
            ← Analizy
          </a>
          <h1>{inv.name}</h1>
          <div className="row small">
            {inv.caseRef && <span className="tag blue">{inv.caseRef}</span>}
            {inv.seeds.map((s, i) => (
              <span key={i} className="tag">
                {meta.identifierKinds.find((k) => k.id === s.kind)?.label}: <b>{s.value}</b>
              </span>
            ))}
            <span className="muted">źródła: {inv.options.sources.join(', ')} · pivot {inv.options.maxDepth}</span>
          </div>
        </div>
        <div className="row">
          <label className="field">
            Analiza cykliczna
            <select
              value={inv.scheduleMinutes ?? 0}
              onChange={async (e) => {
                await api.schedule(inv.id, Number(e.target.value) || null);
                load();
              }}
            >
              <option value={0}>ręcznie</option>
              <option value={1}>co 1 min (demo)</option>
              <option value={60}>co godzinę</option>
              <option value={1440}>codziennie</option>
              <option value={10080}>co tydzień</option>
            </select>
          </label>
          <button className="primary" onClick={rerun} disabled={anyRunning}>
            ↻ Uruchom ponownie
          </button>
          {result && runId && (
            <>
              <a className="btn" href={`/api/runs/${runId}/report.html`} target="_blank" rel="noreferrer">
                📄 Raport
              </a>
              <a className="btn" href={`/api/runs/${runId}/export.json`}>
                JSON
              </a>
              <a className="btn" href={`/api/runs/${runId}/export.csv`}>
                CSV
              </a>
            </>
          )}
          <button
            className="danger"
            onClick={async () => {
              if (confirm('Usunąć analizę wraz z wszystkimi przebiegami i zapisanymi dokumentami?')) {
                await api.remove(inv.id);
                go('/');
              }
            }}
          >
            Usuń
          </button>
        </div>
      </div>

      <div className="panel" style={{ padding: '10px 14px', marginTop: 12 }}>
        <div className="row small">
          <b>Przebiegi:</b>
          {runs.map((r) => (
            <button key={r.id} onClick={() => setRunId(r.id)} className={r.id === runId ? 'primary' : ''} style={{ padding: '3px 10px' }}>
              #{r.seq} {r.status === 'running' ? '⏳' : r.status === 'error' ? '⚠' : ''} {fmtDate(r.startedAt).slice(0, 17)} {r.trigger === 'schedule' ? '⏱' : ''}
            </button>
          ))}
          {inv.scheduleMinutes && <span className="muted">następny: {fmtDate(inv.nextRunAt)}</span>}
        </div>
      </div>

      {currentRun?.status === 'running' && (
        <div className="panel progress">
          <div className="spinner" /> Trwa analiza… <span className="muted small">{currentRun.progress}</span>
        </div>
      )}
      {currentRun?.status === 'error' && <div className="callout red">Przebieg zakończony błędem: {currentRun.error}</div>}

      {result && (
        <>
          <div className="tabs">
            {(
              [
                ['summary', 'Podsumowanie'],
                ['addresses', `Adresy (${result.addresses.length})`],
                ['graph', 'Graf powiązań'],
                ['timeline', `Przepływ środków (${result.timeline.length})`],
                ['sources', `Źródła (${result.documents.length})`],
                ['compare', 'Zmiany w czasie'],
                ['log', 'Rejestr zapytań'],
              ] as [Tab, string][]
            ).map(([t, l]) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {l}
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
          {tab === 'graph' && (
            <div className="panel">
              <Graph graph={result.graph} onSelect={(nid) => { if (nid.startsWith('addr:')) { setSelected(nid.slice(5)); setTab('addresses'); } }} />
            </div>
          )}
          {tab === 'timeline' && <Timeline r={result} meta={meta} />}
          {tab === 'sources' && <Sources r={result} openDoc={openDoc} />}
          {tab === 'compare' && <Compare runs={runs.filter((r) => r.status === 'done')} current={runId!} />}
          {tab === 'log' && <Log r={result} />}
        </>
      )}

      {doc && (
        <div className="modal-bg" onClick={() => setDoc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
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
    </>
  );
}

function Summary({ r, onPick, approved, onApprove }: { r: RunResult; onPick: (key: string) => void; approved: string[]; onApprove: (host: string) => void }) {
  const s = r.stats;
  const top = r.addresses.filter((a) => !a.score.excluded && a.score.score >= 40);
  const skipped = r.skippedUrls ?? [];
  return (
    <>
      {skipped.length > 0 && (
        <div className="panel callout warn">
          <b>Strony ujawnione w trakcie analizy, których nie pobrano</b>
          <div className="small">Host spoza białej listy = niezaufany zasób. Zatwierdź host, jeśli strona ma zostać przeanalizowana, a potem uruchom analizę ponownie.</div>
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
      {r.documents.some((d) => d.synthetic) && <div className="callout warn small">Przebieg zawiera dane z piaskownicy testowej (fikcyjne osoby, adresy i transakcje).</div>}
      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><b>{s.identifiers}</b><span>identyfikatorów (wejście + pivot)</span></div>
        <div className="kpi"><b>{s.documents}</b><span>przeanalizowanych dokumentów</span></div>
        <div className="kpi"><b>{s.addresses}</b><span>poprawnych adresów krypto</span></div>
        <div className="kpi"><b style={{ color: 'var(--vh)' }}>{s.attributed}</b><span>przypisanych badanemu (≥40%)</span></div>
        <div className="kpi"><b>{s.excluded}</b><span>wykluczonych (giełdy, kontrakty…)</span></div>
        <div className="kpi"><b style={{ color: '#991b1b' }}>{s.cashOutSignals}</b><span>sygnałów wyjścia do fiat</span></div>
        <div className="kpi"><b>{(s.durationMs / 1000).toFixed(1)} s</b><span>czas analizy · {s.requests} zapytań</span></div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Adresy powiązane z badanym</h3>
          {top.length === 0 && <div className="muted">Brak adresów z wynikiem ≥ 40%.</div>}
          <table>
            <tbody>
              {top.map((a) => (
                <tr key={a.key} className="clickable" onClick={() => onPick(a.key)}>
                  <td style={{ width: 70 }}><ScoreBadge score={a.score.score} band={a.score.band} /></td>
                  <td>
                    <span className="mono"><b>{a.chain}</b> {shortAddr(a.address)}</span>
                    <div className="small muted">{BAND_SHORT[a.score.band]} · {a.score.independentSites.length} źr. niezależne</div>
                  </td>
                  <td>{a.indicators.filter((i) => i.cashOut).map((i) => <span key={i.code} className="tag cash">💶 {i.code}</span>)}{a.indicators.some((i) => i.code === 'MIXER') && <span className="tag cash">mikser</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Wnioski wymagające weryfikacji</h3>
          {r.conclusions.length === 0 && <div className="muted">Brak.</div>}
          {r.conclusions.map((c, i) => (
            <div key={i} className="conclusion">
              <span className={`lvl ${c.level}`}>{c.level === 'high' ? 'istotne' : c.level === 'medium' ? 'średnie' : 'info'}</span>
              {c.text}
              <div className="small muted">Do weryfikacji: {c.verify}</div>
            </div>
          ))}
        </div>
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
  const list = r.addresses.filter((a) => (filter === 'all' ? true : filter === 'excluded' ? a.score.excluded : !a.score.excluded && a.score.score >= 40));
  const sel = r.addresses.find((a) => a.key === selected);
  return (
    <div className="grid2" style={{ gridTemplateColumns: '440px 1fr' }}>
      <div className="panel" style={{ padding: 0 }}>
        <div className="row" style={{ padding: 10 }}>
          {(['all', 'attributed', 'excluded'] as const).map((f) => (
            <button key={f} className={filter === f ? 'primary' : ''} onClick={() => setFilter(f)} style={{ padding: '3px 10px' }}>
              {f === 'all' ? 'wszystkie' : f === 'attributed' ? 'przypisane' : 'wykluczone'}
            </button>
          ))}
        </div>
        <table>
          <tbody>
            {list.map((a) => (
              <tr key={a.key} className={`clickable ${a.key === selected ? 'selected' : ''}`} onClick={() => setSelected(a.key)}>
                <td style={{ width: 64 }}><ScoreBadge score={a.score.score} band={a.score.band} /></td>
                <td>
                  <div className="mono"><b>{a.chain}</b> {shortAddr(a.address)}</div>
                  <ScoreBar score={a.score.score} band={a.score.band} />
                  <div className="small muted">
                    {a.label ? a.label.name : BAND_SHORT[a.score.band]} · {a.evidence.length} wystąp.
                    {a.indicators.some((i) => i.cashOut) && <span className="tag cash">💶</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">{sel ? <AddressDetail a={sel} meta={meta} onOpenDoc={openDoc} /> : <div className="empty">Wybierz adres z listy, aby zobaczyć dowody, wyliczenie Wskaźnika Pewności i aktywność on-chain.</div>}</div>
    </div>
  );
}

function Timeline({ r, meta }: { r: RunResult; meta: Meta }) {
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div style={{ padding: '10px 14px' }} className="small muted">
        Chronologiczny przepływ środków na adresach przypisanych badanemu (≥40%). Wiersze 💶 wskazują możliwe wyjście do walut tradycyjnych.
      </div>
      <table>
        <thead>
          <tr><th>Czas</th><th>Adres</th><th>Kierunek</th><th>Kwota</th><th>Kontrahent</th><th>Tx</th></tr>
        </thead>
        <tbody>
          {r.timeline.map((t, i) => (
            <tr key={i} style={t.cashOut ? { background: '#fef2f2' } : undefined}>
              <td className="small">{fmtDate(t.time)}</td>
              <td className="mono small"><b>{t.chain}</b> {shortAddr(t.address)}</td>
              <td>{t.direction === 'in' ? '⬅ wpływ' : t.direction === 'out' ? '➡ wypływ' : '↺'}</td>
              <td><b>{fmtNum(t.amount)}</b> {t.asset}</td>
              <td className="small">
                {t.counterpartyLabel ? <><b>{t.counterpartyLabel}</b> <span className="tag">{meta.categories[t.counterpartyCategory ?? ''] ?? t.counterpartyCategory}</span></> : <span className="mono">{t.counterparty ? shortAddr(t.counterparty) : '—'}</span>}
                {t.cashOut && <span className="tag cash">💶 cash-out</span>}
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
      <div className="panel" style={{ padding: 0 }}>
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
        <h3 style={{ marginTop: 0 }}>Konta i potwierdzenie tożsamości</h3>
        <div className="small muted" style={{ marginBottom: 8 }}>
          Konta łączone są wyłącznie twardymi powiązaniami (odnośnik, wspólny e-mail/Telegram/telefon, dowód Keybase, dane wejściowe). Konto połączone z badanym tylko zgodnym nickiem dostaje karę R9.
        </div>
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
    api.compare(a, b).then(setRes).catch((e) => setErr(String(e.message ?? e)));
  }, [a, b]);
  const opts = useMemo(() => runs.map((r) => <option key={r.id} value={r.id}>#{r.seq} · {fmtDate(r.startedAt)}</option>), [runs]);
  if (runs.length < 2) return <div className="panel empty">Do porównania potrzebne są co najmniej dwa zakończone przebiegi. Uruchom analizę ponownie lub ustaw analizę cykliczną.</div>;
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
    <div className="panel" style={{ padding: 0 }}>
      <div style={{ padding: '10px 14px' }} className="small muted">
        Wszystkie zapytania sieciowe przebiegu (biała lista hostów: {String(r.configSnapshot.allowedHosts ?? '').split(',').length} pozycji). Silnik v{r.engineVersion}, {fmtDate(r.startedAt)} – {fmtDate(r.finishedAt)}.
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
