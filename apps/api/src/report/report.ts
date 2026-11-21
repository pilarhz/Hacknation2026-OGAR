// Raport OSINT (HTML gotowy do druku / zapisu jako PDF z przeglądarki).
// Struktura wymagana w zadaniu: fakty źródłowe ≠ wyniki obliczeń ≠ wnioski do weryfikacji.
import { CATEGORY_LABELS } from '../chain/types.ts';
import { IDENTIFIER_LABELS } from '../extract/identifiers.ts';
import { CONTEXT_INFO } from '../scoring/context.ts';
import { BANDS, SCORING_PARAMS } from '../scoring/confidence.ts';
import type { Investigation, RunRow } from '../engine/store.ts';
import type { RunResult } from '../engine/investigate.ts';

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : '—');
const num = (n: number | null | undefined, max = 8) => (n === null || n === undefined ? '—' : n.toLocaleString('pl-PL', { maximumFractionDigits: max }));
const link = (u: string) => (/^https?:/.test(u) ? `<a href="${esc(u)}">${esc(u)}</a>` : esc(u));

function scoreColor(s: number, excluded: boolean) {
  if (excluded) return '#6b7280';
  if (s >= 80) return '#b91c1c';
  if (s >= 60) return '#c2410c';
  if (s >= 40) return '#a16207';
  return '#4b5563';
}

export function renderReport(inv: Investigation, run: RunRow, r: RunResult): string {
  const attributed = r.addresses.filter((a) => !a.score.excluded && a.score.score >= 40);
  const low = r.addresses.filter((a) => !a.score.excluded && a.score.score < 40);
  const excluded = r.addresses.filter((a) => a.score.excluded);
  const docById = new Map(r.documents.map((d) => [d.id, d]));
  const synthetic = r.documents.some((d) => d.synthetic);

  const addrBlock = (a: RunResult['addresses'][number]) => `
  <div class="addr">
    <div class="addr-h">
      <span class="score" style="background:${scoreColor(a.score.score, a.score.excluded)}">${a.score.score}%</span>
      <div><div class="mono">${esc(a.chain)} · ${esc(a.address)}</div>
      <div class="muted">${esc(a.score.bandLabel)} · format: ${esc(a.format)} · suma kontrolna: ${esc(a.checksum)}${a.label ? ` · etykieta: <b>${esc(a.label.name)}</b> (${esc(CATEGORY_LABELS[a.label.category])})` : ''}</div></div>
    </div>
    <h4>Fakty źródłowe (gdzie opublikowano adres)</h4>
    <table><tr><th>Dok.</th><th>Źródło / URL</th><th>Autor</th><th>Opublikowano</th><th>Pobrano</th><th>Fragment</th><th>Przypisanie</th></tr>
    ${a.evidence
      .map(
        (e) => `<tr><td>${esc(e.docId)}</td><td>${esc(e.source)} · ${esc(e.site)}<br>${link(e.url)}</td><td>${esc(e.author ?? '—')}</td><td>${dt(e.publishedAt)}</td><td>${dt(e.fetchedAt)}</td><td class="snip">${esc(e.snippet)}</td><td>${e.attribution === 'subject' ? '✔ badany' : e.attribution === 'other' ? '✖ inna osoba' : '? brak autora'}<br><span class="muted">${esc(e.attributionRule)}</span>${e.attribution === 'subject' ? `<br><span class="muted">${e.identityConfirmed ? '✔ tożsamość potwierdzona' : e.viaNickOnly ? '⚠ tylko zgodny nick (R9)' : ''} ${e.weakIdentity ? '⚠ z publikacji adresu (R10)' : ''}</span>` : ''}</td></tr>`,
      )
      .join('')}
    </table>
    <h4>Wynik obliczeń – Wskaźnik Pewności</h4>
    <table class="rules"><tr><th>Reguła</th><th>Opis</th><th>Wartość</th></tr>
    ${a.score.rules.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.label)}${x.evidenceDocId ? ` <span class="muted">[${esc(x.evidenceDocId)}]</span>` : ''}</td><td class="num">${x.kind === 'base' ? '' : x.value > 0 ? '+' : ''}${x.value}</td></tr>`).join('')}
    <tr><td></td><td><b>Wynik (ograniczony do 0–100)</b></td><td class="num"><b>${a.score.score}</b></td></tr></table>
    ${a.aiSuggestions.length ? `<p class="muted">Sugestie AI (nie wpływają na wynik): ${a.aiSuggestions.map((s) => `[${esc(s.docId)}] ${esc(s.category)} – ${esc(s.reason)}`).join('; ')}</p>` : ''}
    ${
      a.onchain
        ? `<h4>Wynik obliczeń – aktywność on-chain ${a.onchain.synthetic ? '<span class="tag">DANE SYNTETYCZNE</span>' : ''}</h4>
    <p>Dostawca: ${esc(a.onchain.provider)} · pobrano ${dt(a.onchain.fetchedAt)} ${a.onchain.explorerUrl ? `· ${link(a.onchain.explorerUrl)}` : ''}<br>
    Transakcje: ${num(a.onchain.txCount, 0)} · pierwsza: ${dt(a.onchain.firstSeen)} · ostatnia: ${dt(a.onchain.lastSeen)} · saldo: ${num(a.onchain.balance)} ${esc(a.onchain.nativeAsset)}<br>
    Wolumen${a.onchain.volumeScope === 'sample' ? ' <b>(tylko pobrana próbka transakcji)</b>' : ''}: ${a.onchain.tokenFlows.map((f) => `${esc(f.asset)} wpływy ${num(f.in)} / wypływy ${num(f.out)}`).join(' · ') || '—'}
    ${a.onchain.error ? `<br><b>Ograniczenie:</b> ${esc(a.onchain.error)}` : ''}</p>
    ${a.indicators.length ? `<ul>${a.indicators.map((i) => `<li><b>${i.cashOut ? '💶 ' : ''}${esc(i.title)}</b> – ${esc(i.detail)} ${i.txs.length ? `<span class="muted">(tx: ${i.txs.slice(0, 6).map(esc).join(', ')}${i.txs.length > 6 ? '…' : ''})</span>` : ''}</li>`).join('')}</ul>` : ''}`
        : ''
    }
  </div>`;

  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Raport OSINT – ${esc(inv.name)} – przebieg #${run.seq}</title>
<style>
body{font:13px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:32px auto;max-width:1100px;padding:0 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;border-bottom:2px solid #1e3a8a;padding-bottom:4px;margin-top:28px;color:#1e3a8a}
h3{font-size:15px;margin:18px 0 6px}h4{font-size:13px;margin:12px 0 4px;color:#374151}
table{border-collapse:collapse;width:100%;margin:6px 0 10px;font-size:12px}td,th{border:1px solid #d1d5db;padding:4px 6px;vertical-align:top;text-align:left}th{background:#f3f4f6}
.mono{font-family:ui-monospace,Consolas,monospace;word-break:break-all}.muted{color:#6b7280;font-size:11px}.num{text-align:right;white-space:nowrap}
.snip{max-width:340px;font-size:11px;color:#374151}.addr{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin:10px 0;page-break-inside:avoid}
.addr-h{display:flex;gap:12px;align-items:center}.score{color:#fff;font-weight:700;border-radius:6px;padding:6px 10px;font-size:16px;min-width:48px;text-align:center}
.box{background:#eff6ff;border-left:4px solid #1e3a8a;padding:8px 12px;margin:8px 0}.warn{background:#fef3c7;border-left-color:#b45309}
.legend span{display:inline-block;margin-right:14px}.tag{background:#fde68a;color:#78350f;border-radius:4px;padding:1px 6px;font-size:11px}
.lvl-high{color:#b91c1c;font-weight:600}.lvl-medium{color:#c2410c;font-weight:600}.lvl-low{color:#4b5563}
@media print{a{color:#111;text-decoration:none}body{margin:0}.noprint{display:none}}
</style></head><body>
<div class="noprint" style="text-align:right"><button onclick="window.print()">Drukuj / zapisz PDF</button></div>
<h1>Raport OSINT – powiązania śladów cyfrowych z adresami kryptowalutowymi</h1>
<div class="muted">OŁCyŚ v${esc(r.engineVersion)} · analiza „${esc(inv.name)}”${inv.caseRef ? ` · sygnatura ${esc(inv.caseRef)}` : ''} · przebieg #${run.seq} (${run.trigger === 'schedule' ? 'cykliczny' : 'ręczny'}) · ${dt(r.startedAt)} – ${dt(r.finishedAt)}</div>
${synthetic ? '<div class="box warn"><b>Uwaga:</b> raport zawiera dane z piaskownicy testowej (fikcyjne osoby i transakcje oznaczone jako syntetyczne).</div>' : ''}
<div class="box"><b>Jak czytać raport.</b> Sekcja 3 zawiera <b>fakty źródłowe</b> – to, co zostało opublikowane w Internecie, z adresem URL i czasem pobrania. Sekcja 4 to <b>wyniki obliczeń</b> – Wskaźnik Pewności liczony według jawnych reguł oraz dane z blockchaina. Sekcja 6 to <b>wnioski wymagające dalszej weryfikacji</b> – nie są ustaleniami faktycznymi.</div>

<h2>1. Parametry wyszukiwania</h2>
<table><tr><th>Dane wejściowe</th><td>${r.seeds.map((s) => `${esc(IDENTIFIER_LABELS[s.kind])}: <b>${esc(s.value)}</b>`).join('<br>')}</td></tr>
<tr><th>Źródła</th><td>${esc(r.options.sources.join(', '))}</td></tr>
<tr><th>Głębokość pivotu</th><td>${r.options.maxDepth} · limit dokumentów ${r.options.maxDocuments} · dane on-chain: ${r.options.chainLookup ? 'tak' : 'nie'} · AI: ${r.options.useAi ? 'pomocniczo (bez wpływu na wynik)' : 'wyłączone'}</td></tr>
<tr><th>Konfiguracja</th><td class="muted">${esc(JSON.stringify(r.configSnapshot))}</td></tr></table>

<h2>2. Podsumowanie</h2>
<table><tr><th>Identyfikatory (wejściowe + pivot)</th><td>${r.stats.identifiers}</td><th>Przeanalizowane dokumenty</th><td>${r.stats.documents}</td></tr>
<tr><th>Wykryte adresy (poprawne formalnie)</th><td>${r.stats.addresses}</td><th>Przypisane badanemu (≥40%)</th><td>${r.stats.attributed} (w tym ≥80%: ${r.stats.highConfidence})</td></tr>
<tr><th>Wykluczone (giełdy, kontrakty…)</th><td>${r.stats.excluded}</td><th>Sygnały wyjścia do fiat</th><td>${r.stats.cashOutSignals}</td></tr>
<tr><th>Odrzuceni kandydaci (błędna suma kontrolna)</th><td>${r.stats.rejectedCandidates}</td><th>Zapytania sieciowe</th><td>${r.stats.requests}</td></tr></table>
<p class="legend muted">Przedziały: ${Object.values(BANDS).map((b) => `<span>${esc(b)}</span>`).join('')}</p>

<h2>3–4. Adresy przypisane badanemu: fakty źródłowe i wyniki obliczeń</h2>
${attributed.length ? attributed.map(addrBlock).join('') : '<p>Brak adresów z wynikiem ≥ 40%.</p>'}
${low.length ? `<h3>Adresy o niskim prawdopodobieństwie lub nieprzypisane</h3>${low.map(addrBlock).join('')}` : ''}
${excluded.length ? `<h3>Adresy wykluczone z przypisania osobowego (odnotowano interakcję)</h3>${excluded.map(addrBlock).join('')}` : ''}

<h2>5. Chronologia przepływu środków (adresy przypisane)</h2>
${
  r.timeline.length
    ? `<table><tr><th>Czas</th><th>Adres</th><th>Kierunek</th><th>Kwota</th><th>Kontrahent</th><th>Tx</th></tr>${r.timeline
        .map(
          (t) =>
            `<tr${t.cashOut ? ' style="background:#fef2f2"' : ''}><td>${dt(t.time)}</td><td class="mono">${esc(t.chain)} ${esc(t.address.slice(0, 10))}…</td><td>${t.direction === 'in' ? '⬅ wpływ' : t.direction === 'out' ? '➡ wypływ' : '↺'}</td><td class="num">${num(t.amount)} ${esc(t.asset)}</td><td>${t.counterpartyLabel ? `<b>${esc(t.counterpartyLabel)}</b> (${esc(CATEGORY_LABELS[t.counterpartyCategory as keyof typeof CATEGORY_LABELS] ?? t.counterpartyCategory)})` : `<span class="mono">${esc(t.counterparty ?? '—')}</span>`}${t.cashOut ? ' 💶' : ''}</td><td class="mono muted">${esc(t.hash)}</td></tr>`,
        )
        .join('')}</table><p class="muted">💶 = transakcja wskazująca na możliwe wyjście do walut tradycyjnych.</p>`
    : '<p>Brak danych transakcyjnych dla adresów przypisanych.</p>'
}

<h2>6. Wnioski wymagające dalszej weryfikacji</h2>
${r.conclusions.length ? `<ol>${r.conclusions.map((c) => `<li><span class="lvl-${c.level}">[${c.level === 'high' ? 'istotne' : c.level === 'medium' ? 'średnie' : 'informacyjne'}]</span> ${esc(c.text)}<br><span class="muted">Podstawa: ${c.basis.slice(0, 5).map(esc).join(', ')}</span><br><i>Do weryfikacji:</i> ${esc(c.verify)}</li>`).join('')}</ol>` : '<p>Brak.</p>'}
${r.swaps.length ? `<h3>Zmiany adresów w czasie</h3><table><tr><th>Strona</th><th>Sieć</th><th>Wcześniej</th><th>Później</th></tr>${r.swaps.map((s) => `<tr><td>${link(s.url)}</td><td>${esc(s.chain)}</td><td class="mono">${s.before.map(esc).join('<br>')}<br><span class="muted">${dt(s.beforeAt)}</span></td><td class="mono">${s.after.map(esc).join('<br>')}<br><span class="muted">${dt(s.afterAt)}</span></td></tr>`).join('')}</table>` : ''}

<h2>7. Konta badanego i potwierdzenie tożsamości</h2>
<p class="muted">Ten sam nick w różnych serwisach nie musi należeć do tej samej osoby. Konta łączone są wyłącznie twardymi powiązaniami (odnośnik, wspólny e-mail/Telegram/telefon, dowód Keybase, dane wejściowe).</p>
<table><tr><th>Status</th><th>Konta (serwis / nick)</th><th>Uzasadnienie i powiązania</th></tr>${(r.identity ?? [])
  .map((c) => `<tr><td>${c.confirmed ? '✔ potwierdzona' : '⚠ niepotwierdzona'}</td><td>${c.accounts.map((a) => `${esc(a.site)} / <b>${esc(a.handle)}</b>`).join('<br>')}</td><td>${esc(c.reason)}<br><span class="muted">${c.links.map(esc).join('<br>')}</span></td></tr>`)
  .join('')}</table>
${(r.skippedUrls ?? []).length ? `<h3>Strony ujawnione w pivocie, których nie pobrano (host wymaga zatwierdzenia)</h3><ul>${r.skippedUrls.map((u) => `<li class="mono">${esc(u.url)} <span class="muted">(znaleziono w ${esc(u.foundIn)})</span></li>`).join('')}</ul>` : ''}

<h2>8. Ścieżka identyfikatorów (pivot)</h2>
<table><tr><th>Identyfikator</th><th>Pochodzenie</th><th>Krok</th></tr>${r.identifiers.map((i) => `<tr><td>${esc(IDENTIFIER_LABELS[i.kind])}: <b>${esc(i.value)}</b></td><td>${i.origin === 'input' ? 'dane wejściowe' : `${esc(i.via?.rule)} – ${link(i.via?.url ?? '')}`}</td><td>${i.depth}</td></tr>`).join('')}</table>

<h2>9. Metadane i odtwarzalność</h2>
<p>Każdy dokument zapisano w bazie wraz z pełną treścią i skrótem SHA-256 – pozwala to odtworzyć analizę i wykazać, co było widoczne w momencie pobrania.</p>
<table><tr><th>Dok.</th><th>Źródło</th><th>URL</th><th>Pobrano</th><th>SHA-256</th><th>Zapytanie</th><th>Należy do badanego</th></tr>${r.documents.map((d) => `<tr><td>${esc(d.id)}</td><td>${esc(d.source)}</td><td>${link(d.url)}</td><td>${dt(d.fetchedAt)}</td><td class="mono muted">${esc(d.sha256.slice(0, 16))}…</td><td class="muted">${esc(d.query)}</td><td>${d.ownedBySubject ? 'tak' : 'nie'}</td></tr>`).join('')}</table>
${r.rejected.length ? `<h3>Odrzuceni kandydaci na adresy</h3><table><tr><th>Ciąg</th><th>Powód</th><th>Dokument</th></tr>${r.rejected.map((x) => `<tr><td class="mono">${esc(x.candidate)}</td><td>${esc(x.reason)}</td><td>${esc(x.docId)} ${link(docById.get(x.docId)?.url ?? x.url)}</td></tr>`).join('')}</table>` : ''}
<h3>Parametry algorytmu Wskaźnika Pewności</h3>
<table><tr><th>Kontekst publikacji</th><th>Wartość bazowa</th></tr>${Object.values(CONTEXT_INFO).map((c) => `<tr><td>${esc(c.label)}</td><td>${c.base}% (${esc(c.band)})</td></tr>`).join('')}</table>
<p class="muted">Modyfikatory: ${esc(JSON.stringify(SCORING_PARAMS))}</p>
${r.notes.length ? `<h3>Uwagi techniczne i ograniczenia</h3><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<h3>Rejestr zapytań sieciowych (${r.requestLog.length})</h3>
<table><tr><th>Czas</th><th>URL</th><th>Status</th><th>Cache</th></tr>${r.requestLog.slice(0, 400).map((l) => `<tr><td class="muted">${dt(l.ts)}</td><td class="mono muted">${esc(l.url)}</td><td>${esc(l.status)}</td><td>${l.cache ? 'tak' : ''}</td></tr>`).join('')}</table>
<p class="muted">Narzędzie korzysta wyłącznie z publicznie dostępnych źródeł (OSINT), bez logowania na cudze konta i bez obchodzenia zabezpieczeń.</p>
</body></html>`;
}
