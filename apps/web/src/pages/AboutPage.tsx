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
            OGAR to narzędzie analityczne OSINT dla pracowników Krajowej Administracji Skarbowej. Łączy publiczne ślady z internetu z adresami kryptowalutowymi i
            ocenia, jak prawdopodobne jest, że dany adres należy do badanej osoby.
          </p>
        </div>
      </div>

      <div className="doc-h"><span className="n">1.</span> Do czego służy</div>
      <div className="panel">
        <p style={{ marginTop: 0 }}>
          Część osób osiągających przychody z kryptowalut nie wykazuje ich w zeznaniu PIT-38. Użytkownicy często zakładają, że są anonimowi, ale publikują adresy
          portfeli na forach, w profilach, ogłoszeniach i komunikatorach. Ręczne przeglądanie tych śladów jest czasochłonne i trudne do powtórzenia.
        </p>
        <p style={{ marginBottom: 0 }}>
          OGAR automatyzuje tę pracę: po podaniu jednego identyfikatora przeszukuje publiczne źródła, wyodrębnia adresy kryptowalut, sprawdza ich aktywność w
          blockchainie i przygotowuje raport, który da się sprawdzić krok po kroku.
        </p>
      </div>

      <div className="doc-h"><span className="n">2.</span> Co potrafi</div>
      <div className="panel">
        <ol style={{ margin: 0 }}>
          <li>Przyjmuje nick, e-mail, identyfikator z komunikatora, imię i nazwisko, adres strony albo publiczny adres kryptowalutowy.</li>
          <li>Przeszukuje publiczne źródła i automatycznie podąża za nowo znalezionymi identyfikatorami (pivot).</li>
          <li>Wykrywa adresy kryptowalut w tekście i sprawdza ich sumy kontrolne, żeby odrzucić literówki i podróbki.</li>
          <li>Ustala, czy adres opublikowała badana osoba, czy ktoś inny.</li>
          <li>Liczy Wskaźnik Pewności (0–99%) według jawnego algorytmu, opisanego w zakładce <a href="#/method">Metodyka</a>.</li>
          <li>Odrzuca adresy giełd, smart kontraktów, mikserów, zbiórek i kantorów, żeby nie przypisać ich osobie.</li>
          <li>Analizuje transakcje (BTC, ETH, TRON) i wskazuje sygnały wyjścia do walut tradycyjnych.</li>
          <li>Zapisuje wyniki z metadanymi, uruchamia analizy cyklicznie, porównuje przebiegi i wykrywa podmianę adresu w profilu.</li>
          <li>Generuje raport OSINT oddzielający fakty źródłowe, wyniki obliczeń i wnioski wymagające weryfikacji.</li>
        </ol>
      </div>

      <div className="doc-h"><span className="n">3.</span> Zasady i bezpieczeństwo</div>
      <div className="panel">
        <ul style={{ margin: 0 }}>
          <li>Korzysta wyłącznie z publicznie dostępnych źródeł. Nie loguje się na cudze konta, nie obchodzi zabezpieczeń i nie skanuje systemów.</li>
          <li>
            Łączy się tylko z hostami z białej listy (obecnie {meta.config.allowedHosts.length} pozycji). Nowy host z wyników analizy trzeba najpierw zatwierdzić.
          </li>
          <li>Każde zapytanie sieciowe trafia do rejestru zapytań przebiegu, a każdy pobrany dokument jest zapisywany z adresem URL, czasem pobrania i skrótem SHA-256.</li>
          <li>
            Dane testowe i wyniki analiz nie są wysyłane do niezatwierdzonych usług. Moduł AI jest {meta.config.ai === 'none' ? 'wyłączony' : `włączony (${meta.config.aiModel})`},
            może działać lokalnie i nigdy nie zmienia wyniku.
          </li>
        </ul>
      </div>

      <div className="doc-h"><span className="n">4.</span> Jak korzystać</div>
      <div className="panel">
        <ul style={{ margin: 0 }}>
          <li>
            <b>Nowa analiza</b> wymaga co najmniej jednego identyfikatora. Scenariusze demonstracyjne działają na piaskownicy z fikcyjnymi danymi ({meta.config.sandboxUrl}),
            bez przetwarzania danych prawdziwych osób.
          </li>
          <li>
            <b>Poprawa parametrów</b> (menu ⋯ analizy) uruchamia nowy przebieg; poprzednie zostają w historii sprawy. Literówkę w identyfikatorze poprawiaj właśnie tak.
          </li>
          <li>
            <b>Przebieg oznaczony jako błędny</b> nie jest usuwany: zostaje w historii i w dzienniku audytu, ale nie liczy się jako aktualny wynik i jest pomijany w
            porównaniach. Oznaczenie można cofnąć.
          </li>
          <li><b>Analizę cykliczną</b> ustawiasz przy tworzeniu analizy albo później na jej stronie (pole „Analiza cykliczna”).</li>
          <li>
            <b>Strony z nieznanych hostów</b>, znalezione w trakcie analizy, pojawiają się w podsumowaniu. Zatwierdź host i uruchom analizę ponownie, żeby je pobrać.
          </li>
          <li><b>Etykieta analityka</b> (przycisk „Oznacz adres…”) wyklucza adres z przypisania osobie w kolejnych przebiegach.</li>
          <li><b>Mapa powiązań:</b> kółko myszy przybliża i oddala, przeciągnięcie przesuwa widok, dwuklik w tło dopasowuje mapę do okna.</li>
          <li><b>Kosz:</b> usunięta analiza jest przechowywana przez 30 dni razem z przebiegami i dokumentami, potem jest kasowana na stałe.</li>
          <li><b>AI</b> włącza administrator (zmienna <code>AI_PROVIDER</code>, np. lokalna Ollama). Podpowiada kategorię kontekstu, ale nie zmienia wyniku.</li>
        </ul>
      </div>

      <div className="doc-h"><span className="n">5.</span> Jak czytać wyniki</div>
      <div className="callout warn" style={{ marginTop: 0 }}>
        <b>Wskaźnik Pewności to ocena prawdopodobieństwa, a nie dowód.</b> Każdy wniosek w raporcie zawiera informację, co należy zweryfikować przed podjęciem
        dalszych czynności.
      </div>
      <div className="panel">
        <ul style={{ margin: 0 }}>
          <li>Dane on-chain są analizowane na próbce ostatnich transakcji; raport informuje o próbkowaniu.</li>
          <li>Wykrywanie wyjścia do walut tradycyjnych opiera się na etykietach adresów. Lista etykiet jest startowa i wymaga utrzymania.</li>
          <li>Serwisy wymagające logowania (np. Facebook, Instagram, X) nie są przeszukiwane automatycznie; publiczną stronę można podać jako adres URL.</li>
        </ul>
      </div>

      <div className="doc-h"><span className="n">6.</span> Informacje techniczne</div>
      <div className="panel flush">
        <table>
          <tbody>
            <tr><th style={{ width: 240 }}>Wersja</th><td>{VERSION}</td></tr>
            <tr><th>Projekt</th><td>HackNation 2026 · wyzwanie Ministerstwa Finansów / KAS</td></tr>
            <tr><th>Technologie</th><td>Node.js + TypeScript (API), React 19 + Vite (interfejs), PostgreSQL</td></tr>
            <tr><th>Licencja</th><td>MIT; wszystkie zależności są open source</td></tr>
            <tr>
              <th>Analiza on-chain</th>
              <td>{meta.config.chainLive ? 'publiczne API eksploratorów (Blockscout, Esplora, TronGrid)' : 'wyłączona'}</td>
            </tr>
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
          </tbody>
        </table>
      </div>
    </>
  );
}
