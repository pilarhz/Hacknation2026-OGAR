import type { Meta } from '../api.ts';

export function MethodPage({ meta }: { meta: Meta }) {
  const p = meta.scoringParams;
  return (
    <>
      <h1>Metodyka</h1>
      <div className="muted" style={{ marginBottom: 12 }}>
        Jak OGAR łączy ślady Web2 z adresami Web3 i jak liczy Wskaźnik Pewności. Algorytm jest w pełni regułowy – ten sam materiał daje zawsze ten sam wynik, a każda składowa jest widoczna w raporcie.
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>1. Przebieg analizy</h3>
          <ol>
            <li><b>Wyszukiwanie</b> – każde źródło przyjmuje określone typy identyfikatorów (nick, e-mail, adres…). Wyniki to dokumenty z URL, czasem pobrania i SHA-256 treści.</li>
            <li><b>Pivot</b> – identyfikatory ujawnione w dokumentach należących do badanego (e-mail w profilu, Telegram w ogłoszeniu) są wyszukiwane w kolejnym kroku (do zadanej głębokości).</li>
            <li><b>Ekstrakcja</b> – adresy wykrywane wyrażeniami regularnymi i weryfikowane sumą kontrolną: Base58Check (BTC/LTC/DOGE/TRON), Bech32/Bech32m (SegWit/Taproot), EIP-55 (Ethereum). Kandydaci z błędną sumą trafiają na listę odrzuconych. Ten sam mechanizm działa w zakładce <a href="#/extract">Ekstraktor adresów</a>.</li>
            <li><b>Przypisanie autorstwa</b> – adres jest przypisywany badanemu tylko wtedy, gdy opublikował go autor zgodny z identyfikatorem badanego albo dokument należy do badanego. Adres wklejony przez inną osobę ma status „brak przypisania”. Autor, który ostrzega przed adresem („scam”, „nie wysyłajcie”), nie jest uznawany za jego właściciela.</li>
            <li><b>Tożsamość kont</b> – ten sam nick w dwóch serwisach nie oznacza tej samej osoby. Konta łączymy w grupy tylko twardymi powiązaniami (odnośnik, wspólny e-mail/Telegram/telefon, dowód Keybase, dane wejściowe); konto spoza potwierdzonej grupy dostaje karę R9. Sam nick to więc słaba kotwica – najpewniejszym wejściem jest URL profilu, e-mail lub Telegram.</li>
            <li><b>Wykluczenia</b> – adresy giełd, kontraktów, mikserów, kantorów i zbiórek nie są przypisywane osobie (0%), ale interakcje z nimi są odnotowywane jako wskaźniki (np. wyjście do fiat). Źródła: lista startowa, <a href="#/labels">etykiety analityka</a>, etykiety eksploratorów (Blockscout, Tronscan) i flaga kontraktu (bytecode ≠ 0x).</li>
            <li><b>On-chain</b> – wolumen, okres aktywności, kontrahenci z etykietami, wskaźniki wyjścia do fiat (Blockscout, Esplora, TronGrid). Przepływ środków obejmuje adresy przypisane badanemu, czyli z wynikiem ≥ 40%.</li>
            <li><b>Wnioski</b> – generowane z wyników, zawsze z informacją, co należy zweryfikować.</li>
          </ol>
        </div>
        <div className="panel">
          <h3>2. Wskaźnik Pewności – wartość bazowa (kontekst publikacji)</h3>
          <table>
            <tbody>
              {Object.entries(meta.contexts).map(([k, c]) => (
                <tr key={k}><td>{c.label}</td><td><b>{c.base}%</b></td><td className="muted small">{c.band}</td></tr>
              ))}
              <tr><td>Giełda, kontrakt, mikser, zbiórka, kantor (wykluczenie)</td><td><b>0%</b></td><td className="muted small">E1/E2</td></tr>
              <tr><td>Adres opublikowany przez inną osobę</td><td><b>{p.notAttributedScore}%</b></td><td className="muted small">R0</td></tr>
            </tbody>
          </table>
          <h3>3. Modyfikatory</h3>
          <table>
            <tbody>
              <tr><td>R6 · synergia: ≥2 niezależne serwisy (różne domeny)</td><td className="plus">+{p.synergyBonus}</td></tr>
              <tr><td>R7 · transakcje z innym adresem badanego (≥60%)</td><td className="plus">+{p.onChainLinkBonus}</td></tr>
              <tr><td>R4 · pole strukturalne / konto zweryfikowane</td><td className="plus">+{p.verifiedBonus}</td></tr>
              <tr><td>R2 · identyfikator z pivotu (za każdy krok, max {p.pivotPenaltyMax})</td><td className="minus">−{p.pivotPenaltyPerHop}</td></tr>
              <tr><td>R3 · nick zgodny po normalizacji / częściowo</td><td className="minus">−{p.normalizedMatchPenalty} / −{p.partialMatchPenalty}</td></tr>
              <tr><td>R5 · adres tylko w archiwalnej wersji strony</td><td className="minus">−{p.archivedPenalty}</td></tr>
              <tr><td>R8 · bardzo duża liczba transakcji (profil usługi)</td><td className="minus">−{p.highActivityPenalty}</td></tr>
              <tr><td>R9 · konto połączone z badanym tylko zgodnym nickiem (brak odnośnika / wspólnego kontaktu); zniesiona, gdy działa R7</td><td className="minus">−{p.unconfirmedNickPenalty}</td></tr>
              <tr><td>R10 · tożsamość wywnioskowana tylko z publikacji adresu wejściowego</td><td className="minus">−{p.weakIdentityPenalty}</td></tr>
            </tbody>
          </table>
          <div className="small muted">Wynik = najlepszy dowód + premie − kary, ograniczony do 0–{p.maxScore}% (ocena heurystyczna, nie pewność); obcięcie do limitu jest jawnym wierszem MAX. Wielokrotne wystąpienie w jednym serwisie nie podnosi wyniku.</div>
        </div>
      </div>
      <div className="panel">
        <h3>4. Wskaźniki wyjścia do walut tradycyjnych (Fiat Cash-Out)</h3>
        <ul>
          <li><b>CEX_OUTFLOW</b> – wpłata na adres giełdy scentralizowanej (zwykle poprzedza sprzedaż za fiat; dane KYC u giełdy).</li>
          <li><b>OFFRAMP / P2P</b> – interakcja z kantorem, bramką krypto-fiat, kartą krypto lub platformą P2P.</li>
          <li>Pomocniczo: <b>STABLECOIN_SWAP</b> – wymiana na stablecoin przez DEX; to wymiana krypto–krypto, więc nie jest liczona jako wyjście do fiat (te same środki zwykle trafiają potem na giełdę).</li>
          <li>Dodatkowo: <b>MIXER</b> (zacieranie pochodzenia), <b>LINKED_ADDRESS</b> (wspólna kontrola), <b>CEX_INFLOW</b>, <b>NO_ACTIVITY</b>, <b>HIGH_ACTIVITY</b>.</li>
        </ul>
        <h3>5. Źródła i bezpieczeństwo</h3>
        <table>
          <tbody>
            {meta.sources.map((s) => (
              <tr key={s.id}><td><b>{s.label}</b> {s.synthetic && <span className="tag syn">syntetyczne</span>}</td><td className="small">{s.description}</td><td className="small mono">{s.hosts.join(', ')}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="small muted" style={{ marginTop: 8 }}>
          Aplikacja łączy się wyłącznie z hostami z białej listy ({meta.config.allowedHosts.length} pozycji) i loguje każde zapytanie. Strona z nieznanego hosta, znaleziona w trakcie analizy, nie jest pobierana, dopóki analityk nie zatwierdzi hosta. AI jest domyślnie wyłączone; po włączeniu korzysta z wymiennego, lokalnego modelu (API zgodne z OpenAI, np. Ollama) i nie zmienia wyniku.
        </div>
      </div>
    </>
  );
}
