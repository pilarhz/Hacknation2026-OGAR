import { useEffect, useState } from 'react';
import { api, INVALID_REASON_LABELS, SCHEDULES, type Investigation, type InvalidReason, type Meta, type RunRow } from '../api.ts';
import { go } from '../App.tsx';

interface Seed {
  kind: string;
  value: string;
}

const PRESETS: { title: string; desc: string; name: string; seeds: Seed[]; sources: string[]; schedule?: number }[] = [
  {
    title: 'Scenariusz 1 · pełna ścieżka od nicka',
    desc: 'Profil → strona WWW → ogłoszenie P2P → Telegram → lista mailingowa. Synergia źródeł, cash-out, mikser.',
    name: 'Scenariusz testowy 1 – cryptojanek',
    seeds: [{ kind: 'nick', value: 'cryptojanek' }],
    sources: ['sandbox', 'web'],
  },
  {
    title: 'Scenariusz 2 · fałszywe trafienia',
    desc: 'Użytkownik publikuje adresy giełdy, zbiórki i komentuje giveaway – narzędzie nie może ich przypisać.',
    name: 'Scenariusz testowy 2 – nowak_btc',
    seeds: [{ kind: 'nick', value: 'nowak_btc' }],
    sources: ['sandbox', 'web'],
  },
  {
    title: 'Scenariusz 3 · od adresu do osoby',
    desc: 'Wejście: publiczny adres ETH. Wyszukiwanie odwrotne → autor ogłoszenia → kolejne ślady.',
    name: 'Scenariusz testowy 3 – adres 0xCfE5…',
    seeds: [{ kind: 'address', value: '0xCfE541F7a25C5cD54277D1Dc4A2Ca6E37626ff4A' }],
    sources: ['sandbox', 'web'],
  },
  {
    title: 'Scenariusz 4 · analiza cykliczna',
    desc: 'Jak scenariusz 1, uruchamiana co 1 min. Przełącz okres w piaskownicy, by zobaczyć podmianę adresu w profilu.',
    name: 'Scenariusz testowy 4 – monitoring cryptojanek',
    seeds: [{ kind: 'nick', value: 'cryptojanek' }],
    sources: ['sandbox', 'web'],
    schedule: 1,
  },
  {
    title: 'Źródła publiczne · adres instytucji',
    desc: 'Adres zbiórki rządu Ukrainy (BTC) – wyszukiwanie w Hacker News (i SearXNG, jeśli skonfigurowany), dane z Esplora; oczekiwane wykluczenie (zbiórka).',
    name: 'Test źródeł publicznych – adres zbiórki',
    seeds: [{ kind: 'address', value: '357a3So9CbsNfBBgFYACGvxxS6tMaDoa1P' }],
    sources: ['hackernews', 'searxng'],
  },
];

// Ten sam formularz służy do poprawienia parametrów istniejącej analizy (edit): wtedy zapisuje zmiany,
// uruchamia nowy przebieg i – jeśli analityk tak zdecyduje – unieważnia poprzedni, błędny przebieg.
export function NewPage({ meta, edit }: { meta: Meta; edit?: { inv: Investigation; lastRun?: RunRow } }) {
  const inv = edit?.inv;
  const [name, setName] = useState(inv?.name ?? '');
  const [caseRef, setCaseRef] = useState(inv?.caseRef ?? '');
  const [seeds, setSeeds] = useState<Seed[]>(inv ? inv.seeds.map((x) => ({ kind: x.kind, value: x.value })) : [{ kind: 'nick', value: '' }]);
  const [sources, setSources] = useState<string[]>(inv?.options.sources ?? meta.defaults.sources.filter((s) => s !== 'sandbox'));
  const [maxDepth, setMaxDepth] = useState(inv?.options.maxDepth ?? meta.defaults.maxDepth);
  const [maxDocuments, setMaxDocuments] = useState(inv?.options.maxDocuments ?? meta.defaults.maxDocuments);
  const [chainLookup, setChainLookup] = useState(inv?.options.chainLookup ?? true);
  const [useAi, setUseAi] = useState(inv?.options.useAi ?? false);
  const lastRun = edit?.lastRun && edit.lastRun.status !== 'running' && !edit.lastRun.invalidated ? edit.lastRun : undefined;
  const [invalidateLast, setInvalidateLast] = useState(!!lastRun);
  const [reason, setReason] = useState<InvalidReason>('wrong-identifier');
  const [note, setNote] = useState('');
  const [schedule, setSchedule] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setName(p.name);
    setSeeds(p.seeds);
    setSources(p.sources.filter((id) => meta.sources.find((s) => s.id === id)?.available));
    setSchedule(p.schedule ?? 0);
  };

  const mixed = sources.includes('sandbox') && sources.some((s) => !meta.sources.find((x) => x.id === s)?.synthetic && s !== 'web');
  const nickOnly = seeds.some((s) => s.kind === 'nick' && s.value.trim()) && !seeds.some((s) => ['social', 'email', 'url', 'telegram', 'phone'].includes(s.kind) && s.value.trim());
  const hasSeed = seeds.some((s) => s.value.trim());
  const valid = name.trim() && hasSeed && sources.length && !(lastRun && invalidateLast && reason === 'other' && !note.trim());

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (inv) {
        await api.update(inv.id, {
          name: name.trim(),
          caseRef: caseRef.trim() || null,
          seeds: seeds.filter((s) => s.value.trim()),
          options: { sources, maxDepth, maxDocuments, chainLookup, useAi },
          rerun: true,
          ...(lastRun && invalidateLast ? { invalidateRunId: lastRun.id, invalidReason: reason, invalidNote: note.trim() || undefined } : {}),
        });
        go(`/inv/${inv.id}`);
        return;
      }
      const r = await api.create({
        name: name.trim(),
        caseRef: caseRef.trim() || undefined,
        seeds: seeds.filter((s) => s.value.trim()),
        options: { sources, maxDepth, maxDocuments, chainLookup, useAi },
        scheduleMinutes: schedule > 0 ? schedule : null,
      });
      go(`/inv/${r.investigation.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const missing = [!name.trim() && 'nazwę analizy', !hasSeed && 'co najmniej jeden identyfikator', !sources.length && 'co najmniej jedno źródło'].filter(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{inv ? 'Popraw parametry analizy' : 'Nowa analiza'}</h1>
          <p className="lead">
            {inv
              ? 'Popraw identyfikatory, źródła lub ustawienia. Po zapisaniu uruchomi się nowy przebieg. Dotychczasowe przebiegi zostają w historii sprawy.'
              : 'Podaj co najmniej jeden identyfikator. Narzędzie przeszuka publiczne źródła, wyodrębni adresy krypto, policzy Wskaźnik Pewności i przeanalizuje aktywność on-chain.'}
          </p>
        </div>
        {/* w tym samym miejscu co „Nowa analiza" na liście analiz */}
        <button type="button" className="cta-back" onClick={() => go(inv ? `/inv/${inv.id}` : '/')}>
          Cofnij
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" />
          </svg>
        </button>
      </div>

      <div className="steps">
        <section className="panel">
          <div className="step-head">
            <span className="step-num">1</span>
            <div>
              <h3>Kogo badamy?</h3>
              <p>{inv ? 'Sprawdź i popraw dane wejściowe analizy.' : 'Wpisz dane albo kliknij gotowy scenariusz demonstracyjny poniżej.'}</p>
            </div>
          </div>
          <div className="row" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
            <label className="field" style={{ flex: '2 1 260px' }}>
              Nazwa analizy
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Kontrola PIT-38 – podatnik X" />
            </label>
            <label className="field" style={{ flex: '1 1 200px' }}>
              <span>
                Sygnatura sprawy <span className="hint">(opcjonalnie)</span>
              </span>
              <input value={caseRef} onChange={(e) => setCaseRef(e.target.value)} placeholder="np. 1234-KAS.5000.2026" />
            </label>
          </div>
          <div className="small" style={{ fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Identyfikatory</div>
          {seeds.map((s, i) => (
            <div key={i} className="seed-row">
              <select aria-label="Typ identyfikatora" value={s.kind} onChange={(e) => setSeeds(seeds.map((x, k) => (k === i ? { ...x, kind: e.target.value } : x)))}>
                {meta.identifierKinds.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input
                aria-label="Wartość identyfikatora"
                value={s.value}
                onChange={(e) => setSeeds(seeds.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))}
                placeholder={s.kind === 'address' ? 'bc1… / 0x… / T…' : s.kind === 'email' ? 'jan@example.com' : s.kind === 'url' ? 'https://…' : 'wartość'}
              />
              <button className="ghost" onClick={() => setSeeds(seeds.filter((_, k) => k !== i))} disabled={seeds.length === 1} title="Usuń identyfikator" aria-label="Usuń identyfikator">
                ✕
              </button>
            </div>
          ))}
          <button className="sm" onClick={() => setSeeds([...seeds, { kind: 'nick', value: '' }])}>
            + Dodaj kolejny identyfikator
          </button>
          {nickOnly && (
            <div className="callout small">
              <b>Sam nick to słaba kotwica.</b> Ten sam nick w różnych serwisach może należeć do różnych osób – konta połączone z badanym wyłącznie nickiem dostaną karę R9. Jeśli znasz profil (URL), e-mail lub Telegram, dodaj go.
            </div>
          )}

          {!inv && (
            <>
          <div className="section-title" style={{ marginTop: 24 }}>
            Scenariusze demonstracyjne
          </div>
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p.title} className={`preset ${name === p.name ? 'active' : ''}`} onClick={() => applyPreset(p)}>
                <b>{p.title}</b>
                <span>{p.desc}</span>
              </button>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            Scenariusze 1–4 działają na piaskownicy z fikcyjnymi danymi ({meta.config.sandboxUrl}) – bez przetwarzania danych prawdziwych osób.
          </div>
            </>
          )}
        </section>

        <section className="panel">
          <div className="step-head">
            <span className="step-num">2</span>
            <div>
              <h3>Gdzie szukać?</h3>
              <p>Zaznacz źródła. Każde przyjmuje tylko wybrane typy identyfikatorów.</p>
            </div>
          </div>
          <div className="source-grid">
            {meta.sources.map((s) => {
              const on = sources.includes(s.id);
              return (
                <label key={s.id} className={`source-card ${on ? 'on' : ''} ${s.available ? '' : 'disabled'}`}>
                  <input type="checkbox" checked={on} onChange={(e) => setSources(e.target.checked ? [...sources, s.id] : sources.filter((x) => x !== s.id))} disabled={!s.available} />
                  <div style={{ minWidth: 0 }}>
                    <b>{s.label}</b> {s.synthetic && <span className="tag syn">syntetyczne</span>}
                    <div className="small muted">{s.description}</div>
                    <div className="small muted">przyjmuje: {s.accepts.join(', ')}</div>
                    {s.note && (
                      <span className={`tag ${s.available ? 'syn' : ''}`} style={{ marginTop: 4, whiteSpace: 'normal' }}>
                        ⚠ {s.note}
                      </span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          {mixed && <div className="callout warn small">Łączysz piaskownicę z prawdziwymi źródłami – identyfikatory testowe zostaną wysłane także do serwisów publicznych.</div>}
        </section>

        <section className="panel">
          <div className="step-head">
            <span className="step-num">3</span>
            <div>
              <h3>Jak głęboko i jak często?</h3>
              <p>Wartości domyślne pasują do większości spraw.</p>
            </div>
          </div>
          <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
            <label className="field">
              Głębokość pivotu
              <select value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))}>
                {[0, 1, 2, 3].map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? '0 (tylko dane wejściowe)' : `${d} ${d === 1 ? 'krok' : 'kroki'}`}
                  </option>
                ))}
              </select>
            </label>
            {!inv && (
            <label className="field">
              Analiza cykliczna
              <select value={schedule} onChange={(e) => setSchedule(Number(e.target.value))}>
                {SCHEDULES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            )}
          </div>
          {inv && <div className="small muted" style={{ marginTop: 8 }}>Harmonogram analizy cyklicznej zmienisz na stronie analizy (pole „Analiza cykliczna”).</div>}
          <label className="check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={chainLookup} onChange={(e) => setChainLookup(e.target.checked)} />
            <div>
              Analiza on-chain <span className="small muted">– Blockscout, Esplora, Tronscan (publiczne API)</span>
            </div>
          </label>
          <details className="adv" style={{ marginTop: 6 }}>
            <summary>Ustawienia zaawansowane</summary>
            <label className="field" style={{ marginTop: 10, maxWidth: 200 }}>
              Limit dokumentów
              <input type="number" min={1} max={500} value={maxDocuments} onChange={(e) => setMaxDocuments(Number(e.target.value))} />
            </label>
            <label className="check">
              <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} disabled={meta.config.ai === 'none'} />
              <div>
                Sugestie AI dla niejednoznacznego kontekstu{' '}
                <span className="small muted">{meta.config.ai === 'none' ? '(wyłączone – ustaw AI_PROVIDER, np. lokalna Ollama)' : `(${meta.config.aiModel}, bez wpływu na wynik)`}</span>
              </div>
            </label>
          </details>
        </section>

        {inv && lastRun && (
          <section className="panel">
            <div className="step-head">
              <span className="step-num">4</span>
              <div>
                <h3>Co z poprzednim przebiegiem?</h3>
                <p>Przebieg #{lastRun.seq} zostanie w historii sprawy. Jeśli był błędny, oznacz go, żeby nie liczył się jako aktualny wynik.</p>
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={invalidateLast} onChange={(e) => setInvalidateLast(e.target.checked)} />
              <div>Oznacz przebieg #{lastRun.seq} jako błędny</div>
            </label>
            {invalidateLast && <InvalidReasonFields reason={reason} setReason={setReason} note={note} setNote={setNote} />}
          </section>
        )}

        {err && <div className="callout red">{err}</div>}
        <div className="submit-bar">
          <button className="primary lg" disabled={!valid || busy} onClick={submit}>
            {busy ? (inv ? 'Zapisywanie…' : 'Uruchamianie…') : inv ? 'Zapisz i uruchom ponownie →' : 'Uruchom analizę →'}
          </button>
          <span className="small muted">
            {missing.length ? `Uzupełnij: ${missing.join(', ')}.` : 'Korzystamy wyłącznie z publicznych źródeł (OSINT) – bez logowania i obchodzenia zabezpieczeń.'}
          </span>
        </div>
      </div>
    </>
  );
}

/** Wybór powodu unieważnienia przebiegu (wspólny dla formularza poprawy i okna „Oznacz jako błędny”). */
export function InvalidReasonFields({ reason, setReason, note, setNote }: { reason: InvalidReason; setReason: (r: InvalidReason) => void; note: string; setNote: (n: string) => void }) {
  return (
    <div className="invalid-fields">
      <fieldset>
        <legend>Powód</legend>
        {(Object.keys(INVALID_REASON_LABELS) as InvalidReason[]).map((r) => (
          <label key={r} className="check">
            <input type="radio" name="invalid-reason" checked={reason === r} onChange={() => setReason(r)} />
            <div>{INVALID_REASON_LABELS[r]}</div>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>
          Opis {reason === 'other' ? <span className="hint">(wymagany)</span> : <span className="hint">(opcjonalnie)</span>}
        </span>
        <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="np. literówka w nicku: cryptojanke zamiast cryptojanek" />
      </label>
    </div>
  );
}

/** #/inv/:id/edit – formularz analizy wypełniony parametrami istniejącej sprawy. */
export function EditInvestigationPage({ id, meta }: { id: string; meta: Meta }) {
  const [data, setData] = useState<{ inv: Investigation; lastRun?: RunRow } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api
      .get(id)
      .then((r) => setData({ inv: r.investigation, lastRun: r.runs[0] }))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [id]);
  if (err) return <div className="callout red">{err}</div>;
  if (!data) return <div className="empty">Ładowanie…</div>;
  if (data.lastRun?.status === 'running') {
    return (
      <div className="panel callout warn">
        <b>Trwa przebieg tej analizy.</b> Parametry można poprawić po jego zakończeniu. <a href={`#/inv/${id}`}>Wróć do analizy</a>
      </div>
    );
  }
  return <NewPage meta={meta} edit={data} />;
}
