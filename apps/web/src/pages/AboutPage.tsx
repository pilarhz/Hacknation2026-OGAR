import type { Meta } from '../api.ts';

const VERSION = '0.1.0';

export function AboutPage({ meta }: { meta: Meta }) {
  const live = meta.sources.filter((s) => !s.synthetic);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>O programie</h1>
          <p className="lead">
            OGAR to narzędzie analityczne OSINT dla pracowników Krajowej Administracji Skarbowej. Łączy publiczne ślady z internetu z adresami kryptowalutowymi i ocenia, jak
            mocno dany adres jest powiązany z badaną osobą.
          </p>
        </div>
      </div>

      <div className="doc-h"><span className="n">1.</span> Do czego służy</div>
      <div className="panel">
        <p style={{ marginTop: 0 }}>
          Część osób osiągających przychody z kryptowalut nie wykazuje ich w zeznaniu PIT-38, a jednocześnie publikuje adresy portfeli na forach, w profilach, ogłoszeniach i
          komunikatorach. Ręczne przeglądanie tych śladów jest czasochłonne i trudne do powtórzenia.
        </p>
        <p style={{ marginBottom: 0 }}>Po podaniu jednego identyfikatora OGAR:</p>
        <ol style={{ marginBottom: 0 }}>
          <li>przeszukuje publiczne źródła i podąża za nowo znalezionymi identyfikatorami (pivot),</li>
          <li>wyodrębnia adresy kryptowalut i sprawdza ich sumy kontrolne,</li>
          <li>ustala, kto opublikował adres, i łączy konta badanego tylko twardymi dowodami,</li>
          <li>liczy Wskaźnik Pewności według jawnych reguł (<a href="#/method">Metodyka</a>),</li>
          <li>odrzuca adresy giełd, kontraktów, mikserów, zbiórek i kantorów,</li>
          <li>analizuje transakcje (BTC, ETH, TRON) i wskazuje sygnały wyjścia do walut tradycyjnych,</li>
          <li>powtarza analizę cyklicznie i porównuje przebiegi – także wykrywa podmianę adresu w profilu,</li>
          <li>generuje raport OSINT oddzielający fakty źródłowe, wyniki obliczeń i wnioski do weryfikacji.</li>
        </ol>
      </div>

      <div className="doc-h"><span className="n">2.</span> Jak korzystać</div>
      <div className="panel">
        <ul style={{ margin: 0 }}>
          <li>
            <b>Nowa analiza</b> wymaga co najmniej jednego identyfikatora. Najlepsze wejście to URL profilu, e-mail lub Telegram – sam nick może należeć do różnych osób.
            Scenariusze demonstracyjne działają na piaskownicy z fikcyjnymi danymi.
          </li>
          <li><b>Analizę cykliczną</b> ustawiasz przy tworzeniu analizy albo później na jej stronie; zakładka <b>Zmiany w czasie</b> porównuje dowolne dwa przebiegi.</li>
          <li><b>Poprawa parametrów</b> (menu ⋯ analizy) uruchamia nowy przebieg; poprzednie zostają w historii sprawy.</li>
          <li>
            <b>Przebieg oznaczony jako błędny</b> nie jest usuwany: zostaje w historii i w dzienniku audytu, ale nie liczy się jako aktualny wynik i jest pomijany w porównaniach.
            Oznaczenie można cofnąć.
          </li>
          <li><b>Strony z nieznanych hostów</b> pojawiają się w podsumowaniu analizy. Po zatwierdzeniu hosta uruchom analizę ponownie, żeby je pobrać.</li>
          <li><b>Etykieta analityka</b> (przycisk „Oznacz adres…”) wyklucza adres z przypisania osobie w kolejnych przebiegach.</li>
          <li><b>Mapa powiązań:</b> kółko myszy przybliża i oddala, przeciągnięcie przesuwa widok, dwuklik w tło dopasowuje mapę do okna.</li>
          <li><b>Raport OSINT</b> otwiera się w przeglądarce; przed zapisem do PDF wyłącz w oknie drukowania „Nagłówki i stopki”, żeby raport miał własną stopkę z numerami stron.</li>
          <li><b>Kosz:</b> usunięta analiza jest przechowywana przez 30 dni razem z przebiegami i dokumentami, potem jest kasowana na stałe.</li>
        </ul>
      </div>

      <div className="doc-h"><span className="n">3.</span> Jak czytać wyniki</div>
      <div className="callout warn" style={{ marginTop: 0 }}>
        <b>Wskaźnik Pewności to ocena siły powiązania, a nie dowód.</b> Pokazuje, jak mocno adres łączy się z identyfikatorami badanego. Każdy wniosek w raporcie mówi, co
        należy zweryfikować przed dalszymi czynnościami.
      </div>
      <div className="panel">
        <ul style={{ margin: 0 }}>
          <li>W raporcie <b>✔ badany</b> oznacza, że adres opublikowało konto z potwierdzonej grupy kont badanego, a <b>◐ warunkowo</b>, że konto łączy z badanym tylko zgodny nick albo wyszukiwanie odwrotne.</li>
          <li><b>Wyjście do fiat</b> to wpłaty na giełdy i transakcje z kantorami. Mikser i zamiana na stablecoiny są sygnałami pomocniczymi.</li>
          <li>Dane on-chain są analizowane na próbce ostatnich transakcji, a daty transakcji podawane są w UTC. Wyceny w PLN jeszcze nie ma.</li>
          <li>Wykrywanie wyjścia do fiat opiera się na etykietach adresów; lista etykiet jest startowa i wymaga utrzymania.</li>
          <li>Serwisy wymagające logowania (np. Facebook, Instagram, X) nie są przeszukiwane; publiczną stronę można podać jako adres URL.</li>
        </ul>
      </div>

      <div className="doc-h"><span className="n">4.</span> Zasady i bezpieczeństwo</div>
      <div className="panel">
        <ul style={{ margin: 0 }}>
          <li>Wyłącznie publiczne źródła – bez logowania na cudze konta, obchodzenia zabezpieczeń i skanowania systemów.</li>
          <li>Połączenia tylko z hostami z białej listy (obecnie {meta.config.allowedHosts.length}); nowy host z wyników analizy zatwierdza analityk.</li>
          <li>Każde zapytanie trafia do rejestru zapytań przebiegu, a każdy dokument jest zapisywany z adresem URL, czasem pobrania i skrótem SHA-256.</li>
          <li>Dane testowe i wyniki analiz nie są wysyłane do niezatwierdzonych usług. AI działa lokalnie i nie zmienia wyniku.</li>
        </ul>
      </div>

      <div className="doc-h"><span className="n">5.</span> Informacje techniczne</div>
      <div className="panel flush">
        <table>
          <tbody>
            <tr><th style={{ width: 240 }}>Wersja</th><td>{VERSION}</td></tr>
            <tr><th>Projekt</th><td>HackNation 2026 · wyzwanie Ministerstwa Finansów / KAS</td></tr>
            <tr><th>Technologie</th><td>Node.js + TypeScript, Fastify (API) · React 19 + Vite (interfejs)</td></tr>
            <tr><th>Baza danych</th><td>{meta.config.database ?? 'PostgreSQL'}</td></tr>
            <tr><th>Analiza on-chain</th><td>{meta.config.chainLive ? 'publiczne API eksploratorów (Blockscout, Esplora, TronGrid)' : 'wyłączona'}</td></tr>
            <tr><th>AI</th><td>{meta.config.ai === 'none' ? 'wyłączone' : `${meta.config.aiModel} (lokalnie, API zgodne z OpenAI)`}</td></tr>
            <tr>
              <th>Źródła publiczne ({live.length})</th>
              <td>
                {live.map((s) => (
                  <span key={s.id} className={`tag ${s.available ? '' : 'syn'}`} title={s.description}>
                    {s.label}
                  </span>
                ))}
              </td>
            </tr>
            <tr><th>Licencja</th><td>MIT; wszystkie zależności są open source</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
