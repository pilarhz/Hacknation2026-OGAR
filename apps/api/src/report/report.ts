// Raport OSINT (HTML gotowy do druku / zapisu jako PDF z przeglądarki).
// Struktura wymagana w zadaniu: fakty źródłowe ≠ wyniki obliczeń ≠ wnioski do weryfikacji.
import { CATEGORY_LABELS } from '../chain/types.ts';
import { IDENTIFIER_LABELS, normalizeHandle } from '../extract/identifiers.ts';
import { CONTEXT_INFO } from '../scoring/context.ts';
import { isAttributed, SCORING_PARAMS, type Evidence } from '../scoring/confidence.ts';
import { INVALID_REASONS, type Investigation, type RunRow } from '../engine/store.ts';
import type { RunResult } from '../engine/investigate.ts';
import { plural } from '../plural.ts';

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
// Wszystkie daty w UTC (czas blockchaina) z jawnym oznaczeniem strefy.
const dt = (iso?: string | null) => (iso ? `${new Date(iso).toLocaleString('pl-PL', { timeZone: 'UTC' })} UTC` : '—');
const num = (n: number | null | undefined, max = 8) => (n === null || n === undefined ? '—' : n.toLocaleString('pl-PL', { maximumFractionDigits: max }));
const link = (u: string) => (/^https?:/.test(u) ? `<a href="${esc(u)}">${esc(u)}</a>` : esc(u));
/** Jedyny skrypt w raporcie – jego hash dopuszcza nagłówek CSP (server.ts). */
export const REPORT_PRINT_HANDLER = 'window.print()';
const LEVEL = { high: 'istotne', medium: 'średnie', low: 'informacyjne' } as const;

function scoreColor(s: number, excluded: boolean) {
  if (excluded) return '#6b7280';
  if (s >= 80) return '#b91c1c';
  if (s >= 60) return '#c2410c';
  if (s >= 40) return '#a16207';
  return '#4b5563';
}

/** Przypisanie wystąpienia: pewne (✔) tylko przy potwierdzonej tożsamości konta; reszta warunkowa (◐). */
function attributionCell(e: Evidence): string {
  if (e.attribution === 'other') return '✖ inna osoba';
  if (e.attribution === 'unknown') return '? brak autora';
  const conditional = e.viaNickOnly && !e.identityConfirmed;
  const head = conditional || e.weakIdentity ? '◐ badany – warunkowo' : '✔ badany';
  const why = [
    e.identityConfirmed ? 'konto w potwierdzonej grupie kont' : '',
    conditional ? 'tylko zgodny nick (R9)' : '',
    e.weakIdentity ? 'tożsamość z publikacji adresu (R10)' : '',
  ].filter(Boolean);
  return `${head}<br><span class="muted">${esc(e.attributionRule)}${why.length ? ` · ${why.join(' · ')}` : ''}</span>`;
}

export function renderReport(inv: Investigation, run: RunRow, r: RunResult): string {
  const attributed = r.addresses.filter((a) => isAttributed(a.score));
  const low = r.addresses.filter((a) => !a.score.excluded && !isAttributed(a.score));
  const excluded = r.addresses.filter((a) => a.score.excluded);
  const docById = new Map(r.documents.map((d) => [d.id, d]));
  const synthetic = r.documents.some((d) => d.synthetic);
  const cfg = r.configSnapshot as { allowedHosts?: string[]; ai?: string };
  const caseRef = inv.caseRef ?? '';

  // Faktycznie użyte źródła i dostawcy (a nie tylko zaznaczone w parametrach).
  const docsBySource = new Map<string, number>();
  for (const d of r.documents) docsBySource.set(d.source, (docsBySource.get(d.source) ?? 0) + 1);
  const sourcesCell = r.options.sources
    .map((s) => `${esc(s)}: ${docsBySource.get(s) ? plural(docsBySource.get(s)!, 'dokument', 'dokumenty', 'dokumentów') : '<span class="muted">brak dokumentów</span>'}`)
    .join('<br>');
  const providers = [...new Set(r.addresses.map((a) => a.onchain && `${a.chain}: ${a.onchain.provider}`).filter(Boolean))];

  // Streszczenie: wypływy do giełd i kantorów (cash-out) po aktywach, czerwone flagi.
  const cashOut = new Map<string, number>();
  for (const t of r.timeline) if (t.cashOut && t.direction === 'out') cashOut.set(t.asset, (cashOut.get(t.asset) ?? 0) + t.amount);
  const flags = [
    r.stats.cashOutSignals ? plural(r.stats.cashOutSignals, 'sygnał wyjścia do fiat', 'sygnały wyjścia do fiat', 'sygnałów wyjścia do fiat') : '',
    attributed.some((a) => a.indicators.some((i) => i.code === 'MIXER')) ? 'interakcja z mikserem' : '',
    r.swaps.length ? 'podmiana adresu na stronie w czasie' : '',
    excluded.some((a) => a.evidence.some((e) => e.attribution === 'subject')) ? 'badany publikował adresy giełd/kontraktów' : '',
  ].filter(Boolean);

  // Konta: powiązane z wejściem (potwierdzone), możliwe konta badanego (zgodny nick), inne osoby w materiale.
  const subjectNicks = new Set(r.identifiers.filter((i) => i.kind === 'nick').map((i) => normalizeHandle(i.value)));
  const onChainLinked = new Set(
    r.addresses.flatMap((a) =>
      a.score.rules.some((x) => x.code === 'R9' && x.value === 0) ? a.evidence.filter((e) => e.attribution === 'subject' && e.author).map((e) => `${e.site}|${normalizeHandle(e.author!)}`) : [],
    ),
  );
  const confirmed = (r.identity ?? []).filter((c) => c.confirmed);
  const others = (r.identity ?? []).filter((c) => !c.confirmed);
  const possible = others.filter((c) => c.accounts.some((a) => subjectNicks.has(normalizeHandle(a.handle))));
  const strangers = others.filter((c) => !possible.includes(c));

  const addrBlock = (a: RunResult['addresses'][number]) => {
    const oc = a.onchain;
    const tokens = oc ? oc.tokenFlows.filter((f) => f.asset !== oc.nativeAsset) : [];
    return `
  <div class="addr">
    <div class="addr-h">
      <span class="score" style="background:${scoreColor(a.score.score, a.score.excluded)}">${a.score.score}%</span>
      <div><div class="mono nowrap">${esc(a.chain)} · ${esc(a.address)}</div>
      <div class="muted">${esc(a.score.bandLabel)} · format: ${esc(a.format)} · suma kontrolna: ${esc(a.checksum)}${a.label ? ` · etykieta: <b>${esc(a.label.name)}</b> (${esc(CATEGORY_LABELS[a.label.category])})` : ''}</div></div>
    </div>
    <h4>Fakty źródłowe – gdzie opublikowano adres</h4>
    <table><tr><th style="width:44px">Dok.</th><th>Źródło / URL</th><th style="width:110px">Autor</th><th style="width:120px">Opublikowano</th><th style="width:120px">Pobrano</th><th style="width:190px">Przypisanie</th></tr>
    ${a.evidence
      .map(
        (e) => `<tr><td>${esc(e.docId)}</td><td>${esc(e.source)} · ${esc(e.site)}<br>${link(e.url)}</td><td class="nowrap">${esc(e.author ?? '—')}</td><td>${dt(e.publishedAt)}</td><td>${dt(e.fetchedAt)}</td><td>${attributionCell(e)}</td></tr>
    <tr class="snip-row"><td></td><td colspan="5"><span class="muted">Fragment:</span> <q>${esc(e.snippet)}</q></td></tr>`,
      )
      .join('')}
    </table>
    <h4>Wynik obliczeń – Wskaźnik Pewności</h4>
    <table class="rules"><tr><th style="width:44px">Reguła</th><th>Opis</th><th style="width:60px">Wartość</th></tr>
    ${a.score.rules.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.label)}${x.evidenceDocId ? ` <span class="muted">[${esc(x.evidenceDocId)}]</span>` : ''}</td><td class="num">${x.kind === 'base' ? '' : x.value > 0 ? '+' : ''}${x.value}</td></tr>`).join('')}
    <tr><td></td><td><b>Wynik</b></td><td class="num"><b>${a.score.score}</b></td></tr></table>
    ${
      oc
        ? `<h4>Wynik obliczeń – aktywność on-chain ${oc.synthetic ? '<span class="tag">DANE SYNTETYCZNE</span>' : ''}</h4>
    <table class="kv"><tr><th>Dostawca</th><td>${esc(oc.provider)} · pobrano ${dt(oc.fetchedAt)}${oc.explorerUrl ? ` · ${link(oc.explorerUrl)}` : ''}</td></tr>
    <tr><th>Transakcje</th><td>${num(oc.txCount, 0)} · pierwsza ${dt(oc.firstSeen)} · ostatnia ${dt(oc.lastSeen)}</td></tr>
    <tr><th>Saldo</th><td>${num(oc.balance)} ${esc(oc.nativeAsset)} <span class="muted">(wg dostawcy)</span>${tokens.length ? `<br>${tokens.map((f) => `${esc(f.asset)}: ${num(f.in - f.out)}`).join(' · ')} <span class="muted">(wpływy − wypływy z pobranych transakcji)</span>` : ''}</td></tr>
    <tr><th>Wolumen${oc.volumeScope === 'sample' ? ' (próbka)' : ''}</th><td>${oc.tokenFlows.map((f) => `${esc(f.asset)}: wpływy ${num(f.in)} / wypływy ${num(f.out)}`).join('<br>') || '—'}</td></tr>
    ${oc.error ? `<tr><th>Ograniczenie</th><td>${esc(oc.error)}</td></tr>` : ''}</table>
    ${a.indicators.length ? `<ul>${a.indicators.map((i) => `<li><b>${esc(i.title)}</b>${i.cashOut ? ' <span class="tag red">cash-out</span>' : ''} – ${esc(i.detail)} ${i.txs.length ? `<span class="muted">(tx: ${i.txs.slice(0, 6).map(esc).join(', ')}${i.txs.length > 6 ? '…' : ''})</span>` : ''}</li>`).join('')}</ul>` : ''}`
        : ''
    }
  </div>`;
  };

  // Stopka drukowanej strony (marginesy @page): ID przebiegu i numer strony.
  const footer = `OGAR v${r.engineVersion} · ${inv.name} · przebieg #${run.seq} · ${run.id}`.replace(/["\\]/g, '');
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Raport OSINT – ${esc(inv.name)} – przebieg #${run.seq}</title>
<style>
@page{size:A4;margin:16mm 14mm 18mm;@bottom-left{content:"${esc(footer)}";font:9px system-ui,sans-serif;color:#6b7280}@bottom-right{content:"strona " counter(page) " z " counter(pages);font:9px system-ui,sans-serif;color:#6b7280}}
body{font:13px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:32px auto;max-width:1100px;padding:0 16px}
h1{font-size:22px;margin:0 0 8px}h2{font-size:17px;border-bottom:2px solid #1e3a8a;padding-bottom:4px;margin-top:28px;color:#1e3a8a}
h3{font-size:15px;margin:18px 0 6px}h4{font-size:13px;margin:12px 0 4px;color:#374151}
table{border-collapse:collapse;width:100%;margin:6px 0 10px;font-size:12px}td,th{border:1px solid #d1d5db;padding:4px 6px;vertical-align:top;text-align:left;overflow-wrap:break-word}th{background:#f3f4f6}
.kv th{width:190px}.nowrap{white-space:nowrap}
.mono{font-family:ui-monospace,Consolas,monospace}.muted{color:#6b7280;font-size:11px}.num{text-align:right;white-space:nowrap}
.snip-row td{border-top:0;font-size:11.5px;color:#374151}.snip-row q{font-style:italic}
.addr{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin:10px 0}
.addr-h{display:flex;gap:12px;align-items:center}.score{color:#fff;font-weight:700;border-radius:6px;padding:6px 10px;font-size:16px;min-width:48px;text-align:center}
.box{background:#eff6ff;border-left:4px solid #1e3a8a;padding:8px 12px;margin:8px 0}.warn{background:#fef3c7;border-left-color:#b45309}
.tag{background:#fde68a;color:#78350f;border-radius:4px;padding:1px 6px;font-size:11px}.tag.red{background:#fee2e2;color:#991b1b}
.lvl-high{color:#b91c1c;font-weight:600}.lvl-medium{color:#c2410c;font-weight:600}.lvl-low{color:#4b5563}
.fill{display:inline-block;min-width:240px;border-bottom:1px solid #9ca3af}
@media print{a{color:#111;text-decoration:none}body{margin:0;max-width:none;padding:0}.noprint{display:none}.addr{break-inside:avoid-page}h2{break-after:avoid}}
</style></head><body>
<div class="noprint" style="text-align:right"><button onclick="${REPORT_PRINT_HANDLER}">Drukuj / zapisz PDF</button></div>
<h1>Raport OSINT – powiązania śladów cyfrowych z adresami kryptowalutowymi</h1>
<table class="kv">
<tr><th>Analiza</th><td>${esc(inv.name)}</td></tr>
<tr><th>Sygnatura sprawy</th><td>${caseRef ? esc(caseRef) : '<span class="fill">&nbsp;</span>'}</td></tr>
<tr><th>Analityk</th><td><span class="fill">&nbsp;</span></td></tr>
<tr><th>Przebieg</th><td>#${run.seq} (${run.trigger === 'schedule' ? 'cykliczny' : 'ręczny'}) · ${dt(r.startedAt)} – ${dt(r.finishedAt)} · <span class="mono">${esc(run.id)}</span></td></tr>
<tr><th>Narzędzie</th><td>OGAR v${esc(r.engineVersion)}</td></tr>
</table>
${run.invalidated ? `<div class="box warn" style="background:#fee2e2;border-left-color:#b3261e"><b>PRZEBIEG UNIEWAŻNIONY</b> ${dt(run.invalidated.at)} – ${esc(INVALID_REASONS[run.invalidated.reason] ?? run.invalidated.reason)}${run.invalidated.note ? `: ${esc(run.invalidated.note)}` : ''}.</div>` : ''}
${synthetic ? '<div class="box warn"><b>Dane testowe:</b> raport zawiera dane z piaskownicy (fikcyjne osoby i transakcje).</div>' : ''}

<h2>Streszczenie</h2>
<table><tr><th>Adres przypisany badanemu</th><th style="width:70px">Wskaźnik</th><th>Główne źródło</th><th>Sygnały</th></tr>
${
  attributed.length
    ? attributed
        .map((a) => {
          const best = a.evidence.find((e) => e.docId === a.score.bestEvidenceDocId);
          const sig = a.indicators.filter((i) => i.cashOut || i.code === 'MIXER').map((i) => (i.code === 'MIXER' ? 'mikser' : i.code));
          return `<tr><td class="mono nowrap">${esc(a.chain)} ${esc(a.address)}</td><td class="num"><b>${a.score.score}%</b></td><td>${esc(best?.site ?? '—')}</td><td>${sig.map((x) => `<span class="tag red">${esc(x)}</span>`).join(' ') || '—'}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="4">Brak adresów z Wskaźnikiem Pewności ≥ 40%.</td></tr>'
}</table>
<table class="kv">
<tr><th>Wypływy do giełd i kantorów</th><td>${cashOut.size ? [...cashOut].map(([asset, v]) => `${num(v)} ${esc(asset)}`).join(' · ') : '—'} <span class="muted">· wycena w PLN niedostępna (brak kursów NBP z dnia transakcji)</span></td></tr>
<tr><th>Czerwone flagi</th><td>${flags.length ? flags.map(esc).join(' · ') : '—'}</td></tr>
</table>

<h2>1. Parametry wyszukiwania</h2>
<table class="kv"><tr><th>Dane wejściowe</th><td>${r.seeds.map((s) => `${esc(IDENTIFIER_LABELS[s.kind])}: <b>${esc(s.value)}</b>`).join('<br>')}</td></tr>
<tr><th>Źródła</th><td>${sourcesCell}</td></tr>
<tr><th>Głębokość pivotu</th><td>${r.options.maxDepth}</td></tr>
<tr><th>Limit dokumentów</th><td>${r.options.maxDocuments}</td></tr>
<tr><th>Dane on-chain</th><td>${r.options.chainLookup ? (providers.length ? providers.map(esc).join('<br>') : 'brak adresów do sprawdzenia') : 'wyłączone'}</td></tr>
<tr><th>AI</th><td>${r.options.useAi ? esc(cfg.ai ?? 'tak') : 'wyłączone'}</td></tr>
<tr><th>Biała lista hostów</th><td class="muted">${(cfg.allowedHosts ?? []).map(esc).join(', ') || '—'}</td></tr></table>

<h2>2. Podsumowanie</h2>
<table><tr><th>Identyfikatory (wejściowe + pivot)</th><td>${r.stats.identifiers}</td><th>Przeanalizowane dokumenty</th><td>${r.stats.documents}</td></tr>
<tr><th>Wykryte adresy (poprawne formalnie)</th><td>${r.stats.addresses}</td><th>Przypisane badanemu (≥ 40%)</th><td>${r.stats.attributed} (w tym ≥ 80%: ${r.stats.highConfidence})</td></tr>
<tr><th>Wykluczone (giełdy, kontrakty…)</th><td>${r.stats.excluded}</td><th>Sygnały wyjścia do fiat</th><td>${r.stats.cashOutSignals}</td></tr>
<tr><th>Odrzuceni kandydaci (błędna suma kontrolna)</th><td>${r.stats.rejectedCandidates}</td><th>Zapytania sieciowe</th><td>${r.stats.requests}</td></tr></table>

<h2>3. Adresy: fakty źródłowe i wyniki obliczeń</h2>
${attributed.length ? attributed.map(addrBlock).join('') : '<p>Brak adresów z wynikiem ≥ 40%.</p>'}
${low.length ? `<h3>Adresy o niskim wskaźniku lub nieprzypisane</h3>${low.map(addrBlock).join('')}` : ''}
${excluded.length ? `<h3>Adresy wykluczone z przypisania osobowego (odnotowano interakcję)</h3>${excluded.map(addrBlock).join('')}` : ''}

<h2>4. Chronologia przepływu środków (adresy przypisane)</h2>
${
  r.timeline.length
    ? `<table><tr><th style="width:130px">Czas</th><th>Adres</th><th>Kierunek</th><th>Kwota</th><th>Kontrahent</th><th>Tx</th></tr>${r.timeline
        .map(
          (t) =>
            `<tr${t.cashOut ? ' style="background:#fef2f2"' : ''}><td>${dt(t.time)}</td><td class="mono nowrap">${esc(t.chain)} ${esc(t.address.slice(0, 10))}…</td><td class="nowrap">${t.direction === 'in' ? '⬅ wpływ' : t.direction === 'out' ? '➡ wypływ' : '↺'}</td><td class="num">${num(t.amount)} ${esc(t.asset)}</td><td>${t.counterpartyLabel ? `<b>${esc(t.counterpartyLabel)}</b> (${esc(CATEGORY_LABELS[t.counterpartyCategory as keyof typeof CATEGORY_LABELS] ?? t.counterpartyCategory)})` : `<span class="mono">${esc(t.counterparty ?? '—')}</span>`}${t.cashOut ? ' <span class="tag red">cash-out</span>' : ''}</td><td class="mono muted">${esc(t.hash)}</td></tr>`,
        )
        .join('')}</table>`
    : '<p>Brak danych transakcyjnych dla adresów przypisanych.</p>'
}

<h2>5. Wnioski wymagające dalszej weryfikacji</h2>
${r.conclusions.length ? `<ol>${[...r.conclusions].sort((x, y) => Object.keys(LEVEL).indexOf(x.level) - Object.keys(LEVEL).indexOf(y.level)).map((c) => `<li><span class="lvl-${c.level}">[${LEVEL[c.level]}]</span> ${esc(c.text)}<br><span class="muted">Podstawa: ${c.basis.slice(0, 5).map(esc).join(', ')}</span><br><i>Do weryfikacji:</i> ${esc(c.verify)}</li>`).join('')}</ol>` : '<p>Brak.</p>'}
${r.swaps.length ? `<h3>Zmiany adresów w czasie</h3><table><tr><th>Strona</th><th>Sieć</th><th>Wcześniej</th><th>Później</th></tr>${r.swaps.map((s) => `<tr><td>${link(s.url)}</td><td>${esc(s.chain)}</td><td class="mono">${s.before.map(esc).join('<br>')}<br><span class="muted">${dt(s.beforeAt)}</span></td><td class="mono">${s.after.map(esc).join('<br>')}<br><span class="muted">${dt(s.afterAt)}</span></td></tr>`).join('')}</table>` : ''}

<h2>6. Konta i tożsamość</h2>
<h3>Konta powiązane z identyfikatorami wejściowymi</h3>
${
  confirmed.length
    ? `<table><tr><th>Konta (serwis / nick)</th><th>Uzasadnienie i powiązania</th></tr>${confirmed.map((c) => `<tr><td>${c.accounts.map((a) => `${esc(a.site)} / <b>${esc(a.handle)}</b>`).join('<br>')}</td><td>${esc(c.reason)}<br><span class="muted">${c.links.map(esc).join('<br>')}</span></td></tr>`).join('')}</table>`
    : '<p>Brak.</p>'
}
${
  possible.length
    ? `<h3>Możliwe konta badanego – tylko zgodny nick</h3><table><tr><th>Konto</th><th>Status</th></tr>${possible
        .flatMap((c) => c.accounts)
        .map((a) => `<tr><td>${esc(a.site)} / <b>${esc(a.handle)}</b></td><td>${onChainLinked.has(`${a.site}|${normalizeHandle(a.handle)}`) ? 'powiązanie on-chain z adresem badanego (R7) – kara R9 zniesiona' : 'niepotwierdzone (R9)'}</td></tr>`)
        .join('')}</table>`
    : ''
}
${strangers.length ? `<h3>Inne osoby w materiale</h3><p>${strangers.flatMap((c) => c.accounts.map((a) => `${esc(a.site)} / <b>${esc(a.handle)}</b>`)).join(', ')}</p>` : ''}
${(r.skippedUrls ?? []).length ? `<h3>Strony ujawnione w pivocie, których nie pobrano (host wymaga zatwierdzenia)</h3><ul>${r.skippedUrls.map((u) => `<li class="mono">${esc(u.url)} <span class="muted">(znaleziono w ${esc(u.foundIn)})</span></li>`).join('')}</ul>` : ''}

<h2>7. Ścieżka identyfikatorów (pivot)</h2>
<table><tr><th>Identyfikator</th><th>Pochodzenie</th><th style="width:50px">Krok</th></tr>${r.identifiers.map((i) => `<tr><td>${esc(IDENTIFIER_LABELS[i.kind])}: <b>${esc(i.value)}</b></td><td>${i.origin === 'input' ? 'dane wejściowe' : `${esc(i.via?.rule)} – ${link(i.via?.url ?? '')}`}</td><td>${i.depth}</td></tr>`).join('')}</table>

<h2>8. Metadane i odtwarzalność</h2>
<table><tr><th style="width:44px">Dok.</th><th>Źródło / URL</th><th style="width:120px">Pobrano</th><th>SHA-256</th><th style="width:70px">Dokument badanego</th></tr>${r.documents.map((d) => `<tr><td>${esc(d.id)}</td><td>${esc(d.source)} · ${link(d.url)}<br><span class="muted">zapytanie: ${esc(d.query)}</span></td><td>${dt(d.fetchedAt)}</td><td class="mono muted" style="word-break:break-all">${esc(d.sha256)}</td><td>${d.ownedBySubject ? 'tak' : 'nie'}</td></tr>`).join('')}</table>
${r.rejected.length ? `<h3>Odrzuceni kandydaci na adresy</h3><table><tr><th>Ciąg</th><th>Powód</th><th>Dokument</th></tr>${r.rejected.map((x) => `<tr><td class="mono" style="word-break:break-all">${esc(x.candidate)}</td><td>${esc(x.reason)}</td><td>${esc(x.docId)} ${link(docById.get(x.docId)?.url ?? x.url)}</td></tr>`).join('')}</table>` : ''}
<h3>Parametry algorytmu Wskaźnika Pewności</h3>
<table><tr><th>Kontekst publikacji</th><th>Wartość bazowa</th></tr>${Object.values(CONTEXT_INFO).map((c) => `<tr><td>${esc(c.label)}</td><td>${c.base}% (${esc(c.band)})</td></tr>`).join('')}</table>
<table><tr><th>Parametr</th><th>Wartość</th></tr>${Object.entries(SCORING_PARAMS).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td class="num">${v}</td></tr>`).join('')}</table>
${r.notes.length ? `<h3>Uwagi techniczne i ograniczenia</h3><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<h3>Rejestr zapytań sieciowych (${r.requestLog.length})</h3>
<table><tr><th style="width:130px">Czas</th><th>URL</th><th>Status</th><th>Cache</th></tr>${r.requestLog.slice(0, 400).map((l) => `<tr><td class="muted">${dt(l.ts)}</td><td class="mono muted" style="word-break:break-all">${esc(l.url)}</td><td>${esc(l.status)}</td><td>${l.cache ? 'tak' : ''}</td></tr>`).join('')}</table>
</body></html>`;
}
