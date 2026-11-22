import type { Meta } from '../api.ts';

// Metodyka: jak OGAR dochodzi do wyniku. Wartości reguł czytane z /api/meta, więc zawsze zgodne z silnikiem.
const INDICATORS: [code: string, meaning: string, role: 'cash' | 'aux' | 'info'][] = [
  ['CEX_OUTFLOW', 'Wpłata na adres giełdy scentralizowanej – zwykle poprzedza sprzedaż za fiat; giełda zna klienta (KYC).', 'cash'],
  ['OFFRAMP', 'Transakcja z kantorem, bramką krypto-fiat, kartą krypto lub platformą P2P.', 'cash'],
  ['MIXER', 'Transakcja z mikserem – możliwe zacieranie pochodzenia środków. Zawsze osobny wniosek w raporcie.', 'aux'],
  ['STABLECOIN_SWAP', 'Wymiana na stablecoin przez DEX. To wymiana krypto–krypto; te same środki zwykle trafiają potem na giełdę, więc nie są liczone podwójnie.', 'aux'],
  ['LINKED_ADDRESS', 'Transakcje z innym adresem przypisanym badanemu – wspólna kontrola (podstawa reguły R7).', 'info'],
  ['CEX_INFLOW, DEX_SWAP, STABLECOIN_FLOW', 'Wypłaty z giełdy, wymiany na DEX, duże przepływy stablecoinów.', 'info'],
  ['NO_ACTIVITY, HIGH_ACTIVITY, DATA_LIMIT', 'Brak transakcji, profil usługi (≥ 5000 tx), analiza na próbce.', 'info'],
];
const ROLE = { cash: 'wyjście do fiat', aux: 'sygnał pomocniczy', info: 'informacyjny' } as const;

export function MethodPage({ meta }: { meta: Meta }) {
  const p = meta.scoringParams;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Metodyka</h1>
          <p className="lead">
            Jak OGAR łączy ślady z internetu z adresami kryptowalut i jak liczy Wskaźnik Pewności. Algorytm jest regułowy: ten sam materiał zawsze daje ten sam wynik, a każda
            składowa jest widoczna w szczegółach adresu i w raporcie.
          </p>
        </div>
      </div>

      <div className="doc-h"><span className="n">1.</span> Przebieg analizy</div>
      <div className="panel">
        <ol style={{ margin: 0 }}>
          <li><b>Wyszukiwanie.</b> Każde źródło przyjmuje określone typy identyfikatorów. Każdy pobrany dokument jest zapisywany z adresem URL, czasem pobrania i skrótem SHA-256.</li>
          <li>
            <b>Pivot.</b> Identyfikatory ujawnione w dokumentach należących do badanego (e-mail w profilu, Telegram w ogłoszeniu, link do innego konta) są wyszukiwane w kolejnym
            kroku, do zadanej głębokości. Przy wejściu typu adres tropem staje się autor publikacji – chyba że ostrzega przed adresem („scam”, „nie wysyłajcie”).
          </li>
          <li>
            <b>Wyodrębnianie adresów.</b> Kandydaci są weryfikowani sumą kontrolną: Base58Check (BTC, LTC, DOGE, TRON), Bech32/Bech32m (SegWit, Taproot), EIP-55 (Ethereum).
            Ciągi z błędną sumą trafiają na listę odrzuconych. Ten sam mechanizm działa w zakładce <a href="#/extract">Ekstraktor adresów</a>.
          </li>
          <li><b>Autorstwo.</b> Adres jest przypisany badanemu tylko wtedy, gdy opublikował go badany. Adres wklejony przez inną osobę w tym samym wątku ma status „brak przypisania”.</li>
          <li>
            <b>Tożsamość kont.</b> Ten sam nick w dwóch serwisach nie oznacza tej samej osoby. Konta łączymy tylko twardymi dowodami: jawnym odnośnikiem, wspólnym e-mailem,
            Telegramem lub telefonem albo dowodem Keybase. Dlatego najpewniejszym wejściem jest URL profilu, e-mail lub Telegram, a nie sam nick.
          </li>
          <li><b>Kontekst publikacji.</b> Reguły K1–K8 rozpoznają profil, ogłoszenie, komunikator, stopkę e-mail, forum i giveaway – od kontekstu zależy wartość bazowa wyniku.</li>
          <li><b>On-chain i wykluczenia.</b> Dla znalezionych adresów pobierane są transakcje i etykiety, a z nich liczone wskaźniki (sekcje 3–4).</li>
          <li><b>Wnioski.</b> Generowane z wyników, każdy z podstawą i wskazaniem, co należy zweryfikować.</li>
        </ol>
      </div>

      <div className="doc-h"><span className="n">2.</span> Wskaźnik Pewności</div>
      <div className="grid2">
        <div className="panel flush">
          <table>
            <thead><tr><th>Kontekst publikacji (wartość bazowa)</th><th className="right">Baza</th><th>Przedział</th></tr></thead>
            <tbody>
              {Object.entries(meta.contexts).map(([k, c]) => (
                <tr key={k}><td>{c.label}</td><td className="right"><b>{c.base}</b></td><td className="muted small">{c.band}</td></tr>
              ))}
              <tr><td>Adres opublikowany przez inną osobę (R0)</td><td className="right"><b>{p.notAttributedScore}</b></td><td className="muted small">brak przypisania</td></tr>
              <tr><td>Giełda, kontrakt, mikser, zbiórka, kantor (E1/E2)</td><td className="right"><b>0</b></td><td className="muted small">wykluczenie</td></tr>
            </tbody>
          </table>
        </div>
        <div className="panel flush">
          <table>
            <thead><tr><th>Premie i kary</th><th className="right">Wartość</th></tr></thead>
            <tbody>
              <tr><td>R6 · synergia: adres w ≥ 2 niezależnych serwisach (różne domeny)</td><td className="right plus">+{p.synergyBonus}</td></tr>
              <tr><td>R7 · transakcje z innym adresem badanego (≥ 60%); znosi karę R9</td><td className="right plus">+{p.onChainLinkBonus}</td></tr>
              <tr><td>R4 · adres w polu profilu (podpis Keybase, portfel Gravatar) lub konto zweryfikowane</td><td className="right plus">+{p.verifiedBonus}</td></tr>
              <tr><td>R2 · autor znaleziony przez pivot, za każdy krok (maks. −{p.pivotPenaltyMax})</td><td className="right minus">−{p.pivotPenaltyPerHop}</td></tr>
              <tr><td>R3 · nick zgodny po normalizacji / tylko częściowo</td><td className="right minus">−{p.normalizedMatchPenalty} / −{p.partialMatchPenalty}</td></tr>
              <tr><td>R5 · adres tylko w archiwalnej wersji strony</td><td className="right minus">−{p.archivedPenalty}</td></tr>
              <tr><td>R8 · bardzo duża liczba transakcji (profil usługi)</td><td className="right minus">−{p.highActivityPenalty}</td></tr>
              <tr><td>R9 · konto łączy z badanym tylko zgodny nick</td><td className="right minus">−{p.unconfirmedNickPenalty}</td></tr>
              <tr><td>R10 · tożsamość ustalona tylko przez wyszukiwanie odwrotne</td><td className="right minus">−{p.weakIdentityPenalty}</td></tr>
              <tr><td>MAX · obcięcie do {p.maxScore}%</td><td className="right muted">jawny wiersz</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel small">
        <b>Wynik</b> = najlepszy dowód + premie − kary, w granicach 0–{p.maxScore}%. Składowe zawsze sumują się do wyniku. Wielokrotne wystąpienie w jednym serwisie nie
        podnosi wyniku. Adres jest <b>przypisany badanemu od 40%</b>. Wskaźnik to ocena siły powiązania adresu z identyfikatorami badanego, a nie dowód tożsamości.
      </div>

      <div className="doc-h"><span className="n">3.</span> Wykluczenia</div>
      <div className="panel">
        <ul style={{ margin: 0 }}>
          <li><b>E1 · etykiety:</b> lista startowa, <a href="#/labels">etykiety analityka</a> i tagi eksploratorów (Blockscout, Tronscan).</li>
          <li><b>E2 · smart kontrakt:</b> adres zawiera kod wykonywalny (bytecode ≠ 0x).</li>
          <li>Wykluczony adres nie jest przypisywany osobie (0%), ale interakcja z nim zostaje odnotowana – np. wpłata badanego na adres giełdy.</li>
        </ul>
      </div>

      <div className="doc-h"><span className="n">4.</span> Wskaźniki on-chain</div>
      <div className="panel flush">
        <table>
          <thead><tr><th>Kod</th><th>Znaczenie</th><th>Rola</th></tr></thead>
          <tbody>
            {INDICATORS.map(([code, meaning, role]) => (
              <tr key={code}>
                <td className="mono small nowrap">{code}</td>
                <td className="small">{meaning}</td>
                <td className="nowrap"><span className={`tag ${role === 'cash' ? 'cash' : ''}`}>{ROLE[role]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="doc-h"><span className="n">5.</span> Źródła</div>
      <div className="panel flush">
        <table>
          <thead><tr><th>Źródło</th><th>Opis</th><th>Hosty</th></tr></thead>
          <tbody>
            {meta.sources.map((s) => (
              <tr key={s.id}>
                <td className="nowrap"><b>{s.label}</b> {s.synthetic && <span className="tag syn">syntetyczne</span>}</td>
                <td className="small">{s.description}</td>
                <td className="small mono">{s.hosts.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel small">
        Aplikacja łączy się wyłącznie z hostami z białej listy ({meta.config.allowedHosts.length} pozycji) i zapisuje każde zapytanie. Strona z nieznanego hosta, znaleziona
        w trakcie analizy, jest pobierana dopiero po zatwierdzeniu hosta przez analityka.
      </div>
    </>
  );
}
