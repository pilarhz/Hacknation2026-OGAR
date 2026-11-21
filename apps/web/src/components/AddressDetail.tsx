import { useState } from 'react';
import { api, fmtDate, fmtNum, type AddressResult, type Meta } from '../api.ts';

function Highlight({ text, needle }: { text: string; needle: string }) {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="hl mono">{text.slice(i, i + needle.length)}</span>
      {text.slice(i + needle.length)}
    </>
  );
}

export function AddressDetail({ a, meta, onOpenDoc, onLabeled }: { a: AddressResult; meta: Meta; onOpenDoc: (docId: string) => void; onLabeled?: () => void }) {
  const [labelForm, setLabelForm] = useState(false);
  const [lname, setLname] = useState('');
  const [lcat, setLcat] = useState('CEX');
  const [saved, setSaved] = useState(false);
  const oc = a.onchain;
  return (
    <div>
      <div className="row between">
        <div>
          <div className="mono" style={{ fontSize: 14 }}>
            <b>{a.chain}</b> {a.address}
          </div>
          <div className="small muted">
            {a.format} · suma kontrolna: {a.checksum === 'valid' ? '✔ poprawna' : a.checksum === 'not-applicable' ? 'brak w formacie' : 'niezweryfikowana'}
            {a.formatNotes.map((n) => (
              <div key={n}>ⓘ {n}</div>
            ))}
          </div>
        </div>
        <div className="row">
          {oc?.explorerUrl && (
            <a className="btn" href={oc.explorerUrl} target="_blank" rel="noreferrer">
              Eksplorator ↗
            </a>
          )}
          <button onClick={() => setLabelForm(!labelForm)}>Oznacz adres…</button>
        </div>
      </div>
      {labelForm && (
        <div className="callout row small">
          Dodaj etykietę analityka (np. adres giełdy) – kolejne przebiegi wykluczą go z przypisania osobowego:
          <input value={lname} onChange={(e) => setLname(e.target.value)} placeholder="nazwa podmiotu" />
          <select value={lcat} onChange={(e) => setLcat(e.target.value)}>
            {Object.entries(meta.categories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button
            className="primary"
            disabled={!lname}
            onClick={async () => {
              await api.addLabel({ chain: a.chain, address: a.address, name: lname, category: lcat });
              setSaved(true);
              onLabeled?.();
            }}
          >
            Zapisz
          </button>
          {saved && <span className="tag ok">zapisano – uruchom analizę ponownie</span>}
        </div>
      )}

      <h3>Fakty źródłowe – gdzie opublikowano adres</h3>
      <table>
        <thead>
          <tr>
            <th>Źródło</th>
            <th>Autor</th>
            <th>Fragment</th>
            <th>Kontekst</th>
            <th>Przypisanie</th>
          </tr>
        </thead>
        <tbody>
          {a.evidence.map((e, i) => (
            <tr key={i}>
              <td className="small">
                <b>{e.site}</b> <span className="muted">({e.source})</span>
                <br />
                <a href={e.url} target="_blank" rel="noreferrer">
                  {e.title}
                </a>
                <div className="muted">
                  opubl.: {fmtDate(e.publishedAt)}
                  <br />
                  pobrano: {fmtDate(e.fetchedAt)}
                </div>
                <button className="small" style={{ padding: '2px 8px', marginTop: 4 }} onClick={() => onOpenDoc(e.docId)}>
                  zapisana treść {e.docId}
                </button>
              </td>
              <td>{e.author ?? <span className="muted">—</span>}</td>
              <td className="evidence-snip">
                <Highlight text={e.snippet} needle={a.address} />
              </td>
              <td className="small">
                {meta.contexts[e.context.category]?.label}
                <div className="muted">{e.context.rule}</div>
                {e.context.keywords.length > 0 && <div>{e.context.keywords.map((k) => <span key={k} className="tag">{k}</span>)}</div>}
                {e.structured && <span className="tag ok">pole strukturalne</span>}
                {e.verified && <span className="tag ok">konto zweryfikowane</span>}
                {e.archived && <span className="tag">archiwum</span>}
              </td>
              <td className="small">
                {e.attribution === 'subject' ? <span className="tag ok">badany</span> : e.attribution === 'other' ? <span className="tag cash">inna osoba</span> : <span className="tag">nieustalony</span>}
                <div className="muted">{e.attributionRule}</div>
                {e.attribution === 'subject' &&
                  (e.identityConfirmed ? (
                    <span className="tag ok" title={e.identityRule}>tożsamość potwierdzona</span>
                  ) : e.viaNickOnly ? (
                    <span className="tag cash" title={e.identityRule}>tylko zgodny nick</span>
                  ) : null)}
                {e.weakIdentity && <span className="tag cash">z publikacji adresu</span>}
                {e.depth > 0 && <div className="muted">pivot: krok {e.depth}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {a.aiSuggestions.length > 0 && (
        <div className="callout small">
          🤖 Sugestie AI (pomocnicze, nie zmieniają wyniku): {a.aiSuggestions.map((s) => `[${s.docId}] ${s.category} – ${s.reason}`).join('; ')}
        </div>
      )}

      <h3>Wynik obliczeń – Wskaźnik Pewności</h3>
      {a.score.exclusionReason && <div className="callout warn">{a.score.exclusionReason}</div>}
      <table className="rules">
        <tbody>
          {a.score.rules.map((r, i) => (
            <tr key={i}>
              <td style={{ width: 60 }}>
                <span className="tag blue">{r.code}</span>
              </td>
              <td>
                {r.label} {r.evidenceDocId && <span className="muted small">[{r.evidenceDocId}]</span>}
              </td>
              <td className={r.kind === 'base' ? '' : r.value > 0 ? 'plus' : r.value < 0 ? 'minus' : 'muted'}>
                {r.kind === 'base' ? r.value : r.value > 0 ? `+${r.value}` : r.value === 0 ? '·' : r.value}
              </td>
            </tr>
          ))}
          <tr>
            <td />
            <td>
              <b>Wynik</b> <span className="muted small">(ograniczony do 0–100) · {a.score.bandLabel}</span>
            </td>
            <td>
              <b>{a.score.score}</b>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>
        Aktywność on-chain {oc?.synthetic && <span className="tag syn">dane syntetyczne</span>}
      </h3>
      {!oc ? (
        <div className="muted">Nie pobierano danych on-chain dla tego adresu (adres z listy wykluczeń lub analiza on-chain wyłączona).</div>
      ) : oc.error ? (
        <div className="callout warn">{oc.error}</div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <b>{fmtNum(oc.txCount, 0)}</b>
              <span>transakcji</span>
            </div>
            <div className="kpi">
              <b style={{ fontSize: 15 }}>{fmtDate(oc.firstSeen)}</b>
              <span>pierwsza (w próbce)</span>
            </div>
            <div className="kpi">
              <b style={{ fontSize: 15 }}>{fmtDate(oc.lastSeen)}</b>
              <span>ostatnia</span>
            </div>
            <div className="kpi">
              <b>{fmtNum(oc.balance)}</b>
              <span>saldo {oc.nativeAsset}</span>
            </div>
            {oc.tokenFlows.map((f) => (
              <div className="kpi" key={f.asset}>
                <b style={{ fontSize: 15 }}>
                  ⬅ {fmtNum(f.in)} / ➡ {fmtNum(f.out)}
                </b>
                <span>wolumen {f.asset}{oc.volumeScope === 'sample' ? ' (tylko próbka)' : ''}</span>
              </div>
            ))}
          </div>
          <div className="small muted" style={{ margin: '6px 0' }}>
            Dostawca: {oc.provider} · pobrano {fmtDate(oc.fetchedAt)}
            {oc.isContract !== null && <> · {oc.isContract ? 'smart kontrakt' : 'konto zewnętrzne (EOA)'}</>}
          </div>
          {a.indicators.map((i) => (
            <div key={i.code + i.title} className={`callout ${i.cashOut ? 'red' : i.severity === 'medium' ? 'warn' : ''}`}>
              <b>
                {i.cashOut ? '💶 ' : ''}
                {i.title}
              </b>{' '}
              {i.cashOut && <span className="tag cash">możliwy cash-out do fiat</span>}
              <div className="small">{i.detail}</div>
            </div>
          ))}
          {oc.txs.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Czas</th>
                  <th>Kierunek</th>
                  <th>Kwota</th>
                  <th>Kontrahent</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {oc.txs.slice(-40).map((t, i) => (
                  <tr key={i}>
                    <td className="small">{fmtDate(t.time)}</td>
                    <td>{t.direction === 'in' ? '⬅ wpływ' : t.direction === 'out' ? '➡ wypływ' : '↺'}</td>
                    <td>
                      {fmtNum(t.amount)} {t.asset}
                    </td>
                    <td className="small">
                      {t.counterpartyLabel ? (
                        <>
                          <b>{t.counterpartyLabel.name}</b> <span className="tag">{meta.categories[t.counterpartyLabel.category]}</span>
                        </>
                      ) : (
                        <span className="mono">{t.counterparty ?? '—'}</span>
                      )}
                    </td>
                    <td className="mono small muted">{t.hash.slice(0, 18)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
