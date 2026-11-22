# OGAR - Narzędzie Analityczne

**HackNation 2026 · wyzwanie Ministerstwa Finansów / KAS („OSINTowy Łapacz Cyfrowych Śladów”)**

Ktoś sprzedaje kryptowaluty na forum, ma portfel w profilu na GitHubie i podaje adres do rozliczeń na Telegramie, ale nie wykazuje tego w PIT-38. Analityk KAS musi dziś ręcznie przeklikać się przez te miejsca, połączyć konta i ocenić, czy adres na pewno należy do tej osoby.

**OGAR robi to automatycznie.** Wpisujesz nick, e-mail, Telegram, imię i nazwisko, stronę WWW albo adres krypto. OGAR:

1. **szuka śladów** w publicznych źródłach i sam idzie dalej po nowo znalezionych identyfikatorach (np. z profilu bierze e-mail, a z e-maila znajduje ogłoszenie),
2. **wyciąga adresy kryptowalut** z tekstu i sprawdza ich sumy kontrolne, więc literówki i podróbki odpadają,
3. **ustala, kto opublikował adres**: badany czy ktoś inny w tym samym wątku,
4. **liczy Wskaźnik Pewności (0–99%)** według jawnych reguł. Każdy punkt ma uzasadnienie i link do źródła,
5. **odrzuca adresy, których nie wolno przypisać osobie**: giełdy, smart kontrakty, miksery, zbiórki, kantory,
6. **sprawdza blockchain** (BTC, ETH, TRON) i szuka **sygnałów wyjścia do walut tradycyjnych** (wpłata na giełdę, kantor, zamiana na stablecoin),
7. **zapisuje każdy przebieg** z dowodami (URL, czas pobrania, SHA-256 treści), **powtarza analizę cyklicznie** i **porównuje przebiegi**, np. wykrywa podmianę portfela w profilu,
8. **tworzy raport OSINT**, który oddziela fakty, obliczenia i wnioski do sprawdzenia. Raport da się przeczytać bez wiedzy technicznej.

> OGAR korzysta tylko z publicznych źródeł. Nie loguje się na cudze konta, nie obchodzi zabezpieczeń i nie skanuje systemów. Łączy się wyłącznie z hostami z białej listy i zapisuje każde zapytanie.

---

## Spis treści

- [Uruchom i przetestuj w 5 minut](#uruchom-i-przetestuj-w-5-minut)
- [Scenariusze testowe](#scenariusze-testowe)
- [Przykładowy wynik](#przykładowy-wynik)
- [Jak to działa](#jak-to-działa)
- [Wskaźnik Pewności](#wskaźnik-pewności)
- [Odrzucanie fałszywych trafień](#odrzucanie-fałszywych-trafień)
- [On-chain i wyjście do fiat](#on-chain-i-wyjście-do-fiat)
- [Raport](#raport)
- [Parametry wyszukiwania i źródła](#parametry-wyszukiwania-i-źródła)
- [AI (opcjonalnie)](#ai-opcjonalnie)
- [Inne sposoby uruchomienia](#inne-sposoby-uruchomienia)
- [Architektura](#architektura)
- [Bezpieczeństwo](#bezpieczeństwo)
- [Rozbudowa](#rozbudowa)
- [Zgodność z wymaganiami zadania](#zgodność-z-wymaganiami-zadania)
- [Licencje i źródła danych](#licencje-i-źródła-danych)
- [Ograniczenia](#ograniczenia)

---

## Uruchom i przetestuj w 5 minut

Potrzebujesz tylko **Node.js 22.18 lub nowszego** (zalecany 24). Baza danych, klucze API, GPU ani Docker nie są potrzebne.

```bash
npm install
npm run dev
```

Polecenie uruchamia trzy rzeczy naraz:

| Co | Adres | Po co |
|---|---|---|
| Aplikacja (UI) | **http://127.0.0.1:5173** | tu pracujesz |
| API | http://127.0.0.1:8080 | silnik analizy i baza |
| Piaskownica | http://127.0.0.1:4100 | fikcyjny „internet” do testów |

Baza PostgreSQL uruchamia się sama w procesie Node ([PGlite](https://pglite.dev)), a dane zapisuje w `apps/api/data/pg`.

### Pierwsza analiza: co kliknąć i co powinieneś zobaczyć

1. Otwórz http://127.0.0.1:5173 i kliknij **Nowa analiza**.
2. W sekcji **Scenariusze demonstracyjne** wybierz **scenariusz 1** (nick `cryptojanek`) i kliknij **Uruchom analizę**. Analiza trwa kilka sekund.
3. Na zakładce **Podsumowanie** powinieneś zobaczyć:
   - wniosek główny: adres BTC z wynikiem **99%**,
   - **4 adresy przypisane** badanemu, **2 wykluczone** (Binance i kontrakt USDT) i **5 sygnałów wyjścia do fiat**.
4. Kliknij adres, a potem **Zobacz dowody i wyliczenie**. Zobaczysz, skąd wziął się wynik, reguła po regule, oraz cytat ze źródła.
5. Przejrzyj pozostałe zakładki:
   - **Mapa powiązań**: jak OGAR przeszedł od nicku do kolejnych kont i adresów,
   - **Przepływ środków**: transakcje w kolejności czasu, z podświetlonym wyjściem do fiat,
   - **Źródła i tożsamość**: każdy dokument z datą pobrania i SHA-256 oraz dlaczego konta uznano za jedną osobę,
   - **Rejestr zapytań**: każde zapytanie sieciowe tego przebiegu.
6. Kliknij **Raport OSINT ↗**. Otworzy się raport do druku lub zapisu jako PDF.

### Testy automatyczne

```bash
npm test            # 35 testów: adresy i sumy kontrolne, identyfikatory, reguły punktacji, scenariusze 1–4, baza danych
npm run typecheck   # kontrola typów TypeScript
```

---

## Scenariusze testowe

Zgodnie z kryteriami akceptacji scenariusze 1–4 działają **wyłącznie na danych syntetycznych**.

**Piaskownica** (`apps/sandbox`) to lokalny, fikcyjny internet: forum, ogłoszenia P2P, profil programisty, strona prywatna, podgląd kanału Telegram, giveaway i archiwum listy mailingowej.
- E-maile są w domenie `example.com`.
- Adresy krypto mają poprawne sumy kontrolne, ale są wygenerowane z SHA-256 ([`gen-synthetic-addresses.ts`](apps/api/scripts/gen-synthetic-addresses.ts)), więc nikt nie zna do nich kluczy.
- Transakcje tych adresów pochodzą z [`chain-fixtures.json`](apps/api/data/chain-fixtures.json) i w UI są oznaczone jako syntetyczne.

Każdy scenariusz uruchamiasz jednym kliknięciem w **Nowa analiza → Scenariusze demonstracyjne**. Scenariusze 1–4 sprawdzają też testy automatyczne ([`scenarios.test.ts`](apps/api/test/scenarios.test.ts)).

Każdy scenariusz to **inna osoba, inny typ danych wejściowych i inna umiejętność narzędzia**:

| # | Osoba | Wejście | Co sprawdza |
|---|---|---|---|
| 1 | Jan Testowy, sprzedawca P2P | nick | pełna ścieżka i łączenie kont z wielu serwisów |
| 2 | Nowak, „szum” | nick | odporność na fałszywe trafienia |
| 3 | Ola, skupuje USDT | adres TRON | wyszukiwanie odwrotne: od adresu do osoby |
| 4 | Marek, programista | URL profilu | monitoring: zmiany w czasie |
| 5 | instytucja | adres BTC | prawdziwe, publiczne źródła |

**1. Jan Testowy: pełna ścieżka od nicka.** Wpisujesz `cryptojanek`. OGAR przechodzi przez profil, stronę WWW, ogłoszenie P2P, kanał Telegram i listę mailingową, a po drodze sam znajduje e-mail i Telegram. Spodziewaj się:
- 5 kont połączonych w jedną osobę,
- BTC z profilu **99%** (synergia 4 serwisów),
- ETH z ogłoszenia **70%** (wpłata na giełdę, kantor, zamiana na USDT, mikser),
- TRON z Telegrama **65%**,
- adres z forum **40%** i z giveaway **10%** (konta połączone tylko nickiem),
- Binance i kontrakt USDT **0%**,
- adres innej osoby w wątku bez przypisania,
- literówka w adresie ETH odrzucona.

**2. Nowak: fałszywe trafienia.** Wpisujesz `nowak_btc`. Ta osoba wkleja na forum adres giełdy i zbiórki dla Ukrainy oraz komentuje giveaway. Spodziewaj się:
- giełda i zbiórka **0% (wykluczone)**,
- konta połączone tylko nickiem z karą,
- **żaden adres powyżej 50%**.

**3. Ola: od adresu do osoby.** Wpisujesz tylko adres TRON `TUif3i…nCT9`. OGAR znajduje ogłoszenie „Kupię USDT”, ustala autorkę (`ola_wymiana`), potem jej kanał Telegram i drugi adres (ETH). Spodziewaj się:
- obu adresów na **55%**: przypisane, ale niżej, bo tożsamość ustalono tylko przez wyszukiwanie odwrotne (kara R10),
- sygnału **wypłaty na kartę krypto-fiat**,
- autora wpisu „Uwaga, scam! Nie wysyłajcie na …” **nie** uznanego za właściciela adresu, tylko odnotowanego w uwagach.

**4. Marek: monitoring profilu.** Wpisujesz URL profilu `marek_dev`, a analiza powtarza się co minutę. Za pierwszym razem: adres do wsparcia **90%**, bez sygnałów. Potem:
1. W piaskownicy (http://127.0.0.1:4100) kliknij **„Przełącz na okres 2”**.
2. Marek podmienia adres, a z nowego wpłaca 0,84 BTC na Binance.
3. Następny przebieg pokaże w zakładce **Zmiany w czasie** podmianę adresu na stronie i nowy sygnał wyjścia do fiat.

**5. Prawdziwe źródła publiczne.** Adres BTC zbiórki rządu Ukrainy, szukany w Hacker News i sprawdzany w Esplorze (prawdziwe API, wymaga internetu). Spodziewaj się:
- dokumentów z HN,
- wykluczenia jako zbiórka,
- ostrzeżenia o dużej aktywności.

> Scenariusze 1–4 pokazują, że logika jest spójna na danych, które sami zaprojektowaliśmy. Nie mówią, jak skuteczny jest OGAR w prawdziwym internecie (patrz [Ograniczenia](#ograniczenia)).

---

## Przykładowy wynik

Scenariusz 1, wynik prosto z silnika (bez UI):

```
dokumenty: 7 · identyfikatory: 3 · adresy: 9 · przypisane: 4 · wykluczone: 2 · sygnały cash-out: 5

 99%  BTC  bc1qpgfd4zxr…  80–99% · BARDZO WYSOKIE PRAWDOPODOBIEŃSTWO  [cash-out: CEX_OUTFLOW]
 70%  ETH  0xCfE541F7a2…  60–79% · PRAWDOPODOBNY  [cash-out: CEX_OUTFLOW, OFFRAMP, STABLECOIN_SWAP]
 65%  TRX  TXLFKvqCJRzY…  60–79% · PRAWDOPODOBNY  [cash-out: OFFRAMP]
 40%  ETH  0x7B431cddF8…  40–59% · ŚREDNI (wymaga potwierdzenia drugim śladem)
 10%  ETH  0x18b30Ed558…  10–39% · NISKI / SZUM
  5%  ETH  0xeCd180Ba67…  <10% · BRAK PRZYPISANIA (adres opublikowany przez inną osobę)
  5%  ETH  0x149bCE5c44…  <10% · BRAK PRZYPISANIA (adres opublikowany przez inną osobę)
  0%  ETH  0x28C6c06298…  WYKLUCZONY: E1: Etykieta "Binance 14 (hot wallet)" – Giełda scentralizowana (CEX)
  0%  ETH  0xdAC17F958D…  WYKLUCZONY: E1: Etykieta "Tether USD (USDT) – kontrakt tokena" – Kontrakt stablecoina

wyliczenie bc1qpgfd4zxr…:
  R1   +90  Kontekst: oficjalny, autorski profil / strona badanego (K6)
  R4    +5  Konto zweryfikowane w serwisie
  R6   +15  Synergia śladów: adres w 4 niezależnych źródłach
            (kodhub.example, janek-testowy.example, p2p-rynek.example, lista-mailingowa.example)
  = 99%  (suma 110, ale wskaźnik nigdy nie przekracza 99% – to prawdopodobieństwo, nie pewność)
```

---

## Jak to działa

```
 identyfikatory wejściowe (nick, e-mail, Telegram, URL, adres…)
          │
          ▼
 ┌──────────────────┐   dokumenty (URL, autor, czas, SHA-256)   ┌───────────────────┐
 │ Źródła Web2      │ ────────────────────────────────────────▶ │ Wyciąganie adresów│
 │                  │ ◀── nowe identyfikatory (pivot) ───────── │ i identyfikatorów │
 └──────────────────┘                                           └─────────┬─────────┘
                                                                          ▼
                      ┌──────────────────────┐   ┌───────────────────────────────┐
                      │ Etykiety + blockchain│◀──│ Kto opublikował adres?        │
                      │ (Blockscout, Esplora,│   │ W jakim kontekście?           │
                      │  TronGrid)           │   │                               │
                      └──────────┬───────────┘   └───────────────────────────────┘
                                 ▼
          Wskaźnik Pewności → przepływ środków → wnioski → raport / JSON / CSV
```

Krok po kroku:

1. **Szukanie.** OGAR pyta każde włączone źródło o każdy identyfikator, który to źródło obsługuje. Ten sam URL jest analizowany tylko raz.

2. **Pivot, czyli „idź dalej”.** Jeśli w dokumencie **należącym do badanego** pojawi się nowy identyfikator, OGAR szuka także po nim, o jeden krok głębiej. Takim identyfikatorem może być:
   - e-mail, `t.me/…`, „Telegram: @nick”,
   - telefon z prefiksem (`+48`, `tel.`),
   - link do innego profilu.

   Przy wejściu typu adres działa to odwrotnie: autor publikacji z tym adresem staje się nowym tropem. Wyjątek to autor, który przed adresem ostrzega („scam”, „nie wysyłajcie”), bo on tylko go cytuje. Strony z nieznanych hostów **nie są pobierane automatycznie**. Analityk musi je najpierw zatwierdzić.

3. **Wyciąganie adresów.** Wyrażenia regularne znajdują kandydatów, a potem każdy przechodzi kontrolę sumy kontrolnej:

   | Sieć | Kontrola |
   |---|---|
   | BTC, LTC, DOGE, TRON | Base58Check (podwójny SHA-256) i bajt wersji |
   | SegWit, Taproot | Bech32 (BIP-173) / Bech32m (BIP-350) |
   | Ethereum / EVM | EIP-55 (keccak-256): mieszana wielkość liter z błędną sumą oznacza odrzucenie |
   | Solana | tylko ze słowem kluczowym obok (brak sumy kontrolnej) |
   | Monero | po formacie |

   Hashe transakcji, adres zerowy i adresy z błędną sumą są odrzucane, a powód widać w raporcie.

4. **Kto opublikował adres.** Każde wystąpienie ma autora: autora posta albo właściciela strony. Adres jest przypisany badanemu tylko wtedy, gdy autorem jest badany. Adres wklejony przez kogoś innego w tym samym wątku **nie jest mu przypisywany**.

5. **Czy to ta sama osoba** ([`identity.ts`](apps/api/src/engine/identity.ts)). Ten sam nick w dwóch serwisach **nie oznacza** tej samej osoby. Konta łączymy tylko twardymi dowodami:
   - jawnym odnośnikiem między nimi,
   - wspólnym e-mailem, Telegramem albo telefonem,
   - dowodem Keybase.

   Konto połączone z badanym samym nickiem dostaje karę (R9).

6. **Kontekst.** Reguły K1–K8 rozpoznają, gdzie pojawił się adres: profil, ogłoszenie, komunikator, stopka e-mail, forum czy giveaway. Ogłoszenie wymaga słowa oferty („sprzedam”, „kupię”, „WTS”) **i** słowa płatności, bo samo „cena” czy „PLN” nie wystarcza.

7. **Blockchain i etykiety.** Patrz [On-chain i wyjście do fiat](#on-chain-i-wyjście-do-fiat).

8. **Wynik.** Wskaźnik Pewności, chronologia przepływu środków, wnioski do weryfikacji i wykryte podmiany adresów.

---

## Wskaźnik Pewności

Wskaźnik mówi, **jak bardzo prawdopodobne jest, że adres należy do badanej osoby**. Liczy go wyłącznie kod regułowy ([`confidence.ts`](apps/api/src/scoring/confidence.ts)), więc ten sam materiał zawsze daje ten sam wynik. Każdy składnik to nazwana reguła z linkiem do dowodu, widoczna w UI i w raporcie.

**Punkt wyjścia: gdzie opublikowano adres** (reguły K1–K8, [`context.ts`](apps/api/src/scoring/context.ts)):

| Kontekst | Baza | Przedział |
|---|---|---|
| Oficjalny profil / strona badanego | 90 | 80–99% bardzo wysokie |
| Ogłoszenie sprzedaży / oferta P2P | 70 | 60–79% prawdopodobne |
| Komunikator, kontekst rozliczenia | 70 | 60–79% |
| Stopka e-mail | 65 | 60–79% |
| Dyskusja na forum / w grupie | 50 | 40–59% średnie (potrzebny drugi ślad) |
| Masowe komentarze (giveaway, konkurs) | 25 | 10–39% niskie / szum |
| Adres opublikowany przez inną osobę | 5 | brak przypisania |
| Giełda, kontrakt, mikser, zbiórka, kantor | **0** | wykluczenie |

**Premie i kary.** Wynik to najlepszy dowód plus premie minus kary, w granicach 0–99%:

| Reguła | Kiedy | Wartość |
|---|---|---|
| R6 | **Synergia śladów:** adres w ≥ 2 niezależnych serwisach (różne domeny). Wiele wystąpień w jednym serwisie się nie liczy | +15 |
| R7 | Transakcje z innym adresem badanego o wyniku ≥ 60% | +5 |
| R4 | Adres w polu profilu (podpisany w Keybase, portfel w Gravatar) lub konto zweryfikowane | +5 |
| R2 | Autor znaleziony przez pivot, za każdy krok (maks. −15) | −5 |
| R3a / R3b | Nick zgodny dopiero po normalizacji / tylko częściowo | −5 / −15 |
| R5 | Adres tylko w archiwalnej wersji strony | −10 |
| R8 | ≥ 5000 transakcji, czyli raczej usługa niż osoba | −20 |
| R9 | Konto łączy z badanym **tylko zgodny nick** | −15 |
| R10 | Autora ustalono wyłącznie przez wyszukiwanie odwrotne adresu | −10 |

Za próg przypisania badanemu przyjmujemy **40%** (przedział „średni” i wyżej).

Przykład ze scenariusza 1, adres ETH z forum: `R1 forum 50 − R9 konto łączy z badanym tylko nick 15 + R7 transakcje z adresem z ogłoszenia 5 = 40%`.

---

## Odrzucanie fałszywych trafień

- **E1: etykiety.** Startowa lista [`labels.json`](apps/api/data/labels.json) (Binance, Coinbase, Kraken, Tornado Cash, Uniswap, USDT/USDC i inne), etykiety dodane przez analityka w UI oraz tagi z eksploratorów (Blockscout, Tronscan).
- **E2: smart kontrakt.** Blockscout `is_contract` (bytecode ≠ 0x), TronGrid `type = Contract`.
- **Autor to nie badany:** adres nie jest przypisywany.
- **Błędna suma kontrolna:** literówki i podróbki są odrzucane.
- **R8, duża aktywność:** adres z tysiącami transakcji jest oznaczany jako prawdopodobna usługa.

Wykluczony adres **nie znika z raportu**. OGAR odnotowuje interakcję, np. „badany wysyłał środki na adres Binance”, i podpowiada, że warto zapytać giełdę.

---

## On-chain i wyjście do fiat

OGAR korzysta z publicznych eksploratorów bez kluczy API:
- **Blockscout** (Ethereum): saldo, transakcje, transfery tokenów, etykiety,
- **Esplora / Blockstream** (Bitcoin),
- **TronGrid** (TRON).

Każdy przebieg pobiera dane na nowo. Cache działa tylko w obrębie jednego przebiegu.

| Kod | Co oznacza | Wyjście do fiat |
|---|---|---|
| `CEX_OUTFLOW` | wpłata na giełdę (zwykle przed sprzedażą; giełda zna klienta, KYC) | ✔ |
| `OFFRAMP` | kantor, bramka krypto-fiat, karta, P2P | ✔ |
| `STABLECOIN_SWAP` | zamiana na stablecoin przez DEX (od 1000 USD) | ✔ |
| `STABLECOIN_FLOW` | duże przepływy stablecoinów | – |
| `MIXER` | mikser (zacieranie pochodzenia) | – |
| `LINKED_ADDRESS` | transakcje z innym adresem badanego | – |
| `CEX_INFLOW`, `DEX_SWAP`, `NO_ACTIVITY`, `HIGH_ACTIVITY`, `DATA_LIMIT` | informacyjne | – |

Każdy sygnał wskazuje konkretne transakcje. Zakładka **Przepływ środków** pokazuje je w kolejności czasu i podświetla te, które mogą oznaczać wyjście do fiat.

---

## Raport

Przycisk **Raport OSINT** (`GET /api/runs/{id}/report.html`) otwiera raport do druku lub zapisu jako PDF. Raport ma osiem części:

1. Parametry wyszukiwania i konfiguracja
2. Podsumowanie w liczbach
3. **Fakty źródłowe:** dla każdego adresu URL, serwis, autor, data publikacji i pobrania, cytat, podstawa przypisania
4. **Wyniki obliczeń:** Wskaźnik Pewności reguła po regule i dane on-chain z nazwą dostawcy
5. **Chronologia przepływu środków**
6. **Wnioski do weryfikacji:** każdy z uzasadnieniem i wskazaniem, co sprawdzić
7. Ścieżka identyfikatorów (pivot)
8. **Dane do odtworzenia analizy:**
   - SHA-256 każdego dokumentu (pełna treść jest w bazie),
   - odrzuceni kandydaci,
   - parametry algorytmu,
   - rejestr zapytań.

Eksport do JSON (pełny wynik) i CSV (adresy; separator `;`, kodowanie zgodne z Excelem) jest w menu **⋯** analizy.

---

## Parametry wyszukiwania i źródła

| Parametr | Domyślnie | Opis |
|---|---|---|
| Identyfikatory wejściowe | – | nick, e-mail, Telegram, komunikator, imię i nazwisko, profil (URL), strona WWW, telefon, adres krypto. Można podać kilka naraz |
| Źródła | GitHub, Keybase, Gravatar, Hacker News, WWW, Wayback | dodatkowo Reddit (dziś zwraca 403), SearXNG (własna instancja), piaskownica |
| Głębokość pivotu | 2 | 0 = tylko dane wejściowe. Każdy krok obniża wynik o 5 pkt (R2) |
| Limit dokumentów | 120 | żeby analiza się „nie rozlała” |
| Analiza on-chain | tak | maks. 25 adresów na przebieg, najpierw przypisane badanemu |
| AI | wyłączone | tylko podpowiedź kategorii, **nie zmienia wyniku** |
| Analiza cykliczna | ręcznie | co 1 min (demo), godzinę, dzień, tydzień |

Co dokładnie pyta każde źródło:

| Źródło | Szuka po | Zapytanie |
|---|---|---|
| GitHub | nick, e-mail, imię i nazwisko, URL | profil, README profilu, gisty; wyszukiwanie użytkownika po e-mailu i nazwie |
| Keybase | nick, URL | dowody tożsamości i **podpisane** adresy krypto |
| Gravatar | e-mail | profil po hashu e-maila: portfele, zweryfikowane konta |
| Hacker News | nick, adres | profil, komentarze, wyszukiwanie adresu (Algolia) |
| Reddit | nick, adres | profil, komentarze, wyszukiwanie adresu |
| WWW | URL | strona podana przez analityka albo ujawniona w profilu badanego |
| Wayback Machine | URL | do 4 archiwalnych wersji strony (zmiany w czasie) |
| SearXNG | nick, e-mail, nazwa, Telegram, adres, telefon | wyszukiwanie na **własnej** instancji |
| Piaskownica | wszystko | wyszukiwarka po fikcyjnych stronach |

Wszystkie ustawienia serwera (porty, źródła, biała lista, AI) są opisane w [`.env.example`](.env.example). Żadne nie jest wymagane.

---

## AI (opcjonalnie)

Moduł AI **jest domyślnie wyłączony i nie zmienia Wskaźnika Pewności**. Gdy reguły nie rozpoznały kontekstu (K8, „dyskusja”), model podpowiada, czym może być ten wpis, np. „ogłoszenie sprzedaży”. Podpowiedź jest pokazana obok reguły jako pomocnicza, więc wynik zostaje wyjaśnialny i powtarzalny.

**Jak włączyć** (przetestowane z [Ollamą](https://ollama.com/download) i modelem `qwen2.5:3b`, ~2 GB, działa na samym CPU):

1. `ollama pull qwen2.5:3b`
2. Skopiuj `.env.example` do `.env` i zmień `AI_PROVIDER=none` na `AI_PROVIDER=openai-compatible`.
3. Uruchom ponownie `npm run dev`. Pasek boczny pokaże „AI: qwen2.5:3b”.
4. W **Nowa analiza** zaznacz „AI”. Podpowiedzi zobaczysz w szczegółach adresu (np. adres z forum w scenariuszu 1), a wywołania modelu w rejestrze zapytań.

Kilka szczegółów:
- **Zmiana modelu:** wystarczy zmienić `AI_BASE_URL` i `AI_MODEL`. Działa każdy serwer zgodny z OpenAI Chat Completions: Ollama, vLLM, LM Studio, llama.cpp.
- **Limity:** najwyżej 10 wywołań na przebieg, 20 s na każde. Gdy model nie odpowie, analiza i tak idzie dalej.
- **Prompt injection:** treść z internetu trafia do modelu jako dane, a instrukcja systemowa każe ignorować zawarte w niej polecenia.

---

## Inne sposoby uruchomienia

**Wersja produkcyjna w jednym procesie** (API serwuje zbudowany frontend na http://127.0.0.1:8080):

```bash
npm run sandbox &   # tylko jeśli chcesz scenariusze testowe
npm start
```

**Docker z serwerem PostgreSQL 17** (przetestowane: scenariusz 1 od początku do końca, dane przetrwały restart):

```bash
docker compose up --build   # postgres + API :8080 + piaskownica :4100
```

- Hasło bazy domyślnie to `ogar_lokalnie`. Poza demem ustaw `POSTGRES_PASSWORD`.
- Port bazy nie wychodzi poza sieć kontenerów.
- Linki do stron piaskownicy w wynikach wskazują `http://sandbox:4100`, czyli adres wewnątrz Dockera, więc nie otworzą się w przeglądarce. Sama analiza działa.

**Docker z AI:** odkomentuj w `docker-compose.yml` usługę `ollama`, wolumen `ollama` i zmienne `AI_*`, a po starcie wpisz `docker compose exec ollama ollama pull qwen2.5:3b`. Przetestowane: odpowiedź modelu w ~3 s na CPU.

**Własny serwer PostgreSQL:** ustaw `DATABASE_URL=postgres://…`. Schemat i zapytania są te same co w trybie wbudowanym. Ten sam test bazy przechodzi w obu trybach:

```bash
DATABASE_URL=postgres://ogar:haslo@127.0.0.1:5432/ogar node --test apps/api/test/store.test.ts
```

---

## Architektura

Jedno repozytorium (npm workspaces), trzy aplikacje:

```
apps/
  api/        Node.js + TypeScript (bez kroku kompilacji), Fastify 5
    src/
      extract/      wyciąganie i walidacja adresów (Base58Check, Bech32/m, EIP-55) oraz identyfikatorów
      sources/      źródła Web2 – wspólny interfejs Source + rejestr (registry.ts)
      chain/        dostawcy blockchain, etykiety, wskaźniki on-chain
      scoring/      kontekst publikacji (K1–K8) i Wskaźnik Pewności (R1–R10, E1–E2)
      engine/       investigate.ts – przebieg analizy; identity.ts – łączenie kont;
                    store.ts – sprawy, przebiegi, harmonogram, porównania, kosz
      ai/           wymienny dostawca AI (API zgodne z OpenAI)
      report/       raport HTML
      http/         fetcher.ts – jedyne wyjście do sieci: biała lista, limit tempa, cache, rejestr
      db/           PostgreSQL: serwer (pg) albo wbudowany (PGlite) – te same zapytania
    data/       labels.json (etykiety startowe), chain-fixtures.json (transakcje syntetyczne)
    test/       35 testów (node:test)
  web/        React 19 + Vite – interfejs analityka
  sandbox/    fikcyjny internet do scenariuszy testowych
```

**Model danych** ([`db.ts`](apps/api/src/db/db.ts)):
- `investigations`: sprawa, czyli identyfikatory, parametry i harmonogram,
- `runs`: przebieg z pełnym wynikiem w `JSONB`,
- `documents`: treść i SHA-256 każdego pobranego dokumentu,
- pomocnicze: `http_cache`, `chain_cache`, `custom_labels`, `audit_log`.

Usunięcie sprawy kasuje kaskadowo jej przebiegi i dokumenty. Najpierw sprawa trafia na 30 dni do kosza. Harmonogram rezerwuje przebieg atomowo, więc przy kilku instancjach API analiza nie uruchomi się dwa razy.

**API REST** (wszystkie ścieżki pod `/api`):

| Metoda | Ścieżka | Do czego |
|---|---|---|
| GET | `/meta` | źródła, typy identyfikatorów, parametry punktacji, konfiguracja |
| GET / POST | `/investigations` | lista spraw / nowa sprawa |
| GET / PUT / DELETE | `/investigations/{id}` | szczegóły z przebiegami / poprawa parametrów / do kosza |
| POST | `/investigations/{id}/runs` | nowy przebieg |
| PUT | `/investigations/{id}/schedule` | harmonogram `{minutes}` |
| POST | `/investigations/{id}/approved-hosts` | zatwierdzenie hosta strony z pivotu |
| GET | `/runs/{id}` | pełny wynik przebiegu |
| POST | `/runs/{id}/invalidate` · `/revalidate` | oznaczenie przebiegu jako błędny / cofnięcie |
| GET | `/runs/{id}/report.html` · `export.json` · `export.csv` | raport i eksport |
| GET | `/runs/{id}/documents/{docId}` | zapisana treść dokumentu |
| GET | `/compare?a={runId}&b={runId}` | porównanie dwóch przebiegów |
| GET / POST / DELETE | `/trash`, `/trash/{id}/restore`, `/trash/{id}` | kosz |
| GET / POST | `/labels` | etykiety adresów |
| POST | `/extract` | wyciągnięcie adresów i identyfikatorów z wklejonego tekstu |
| GET | `/audit` | dziennik zdarzeń |
| POST | `/login` | logowanie tokenem (gdy ustawiony `API_TOKEN`) |

**Docelowo w KAS:**
- serwer PostgreSQL w infrastrukturze KAS,
- lokalny model AI,
- własna instancja SearXNG jako wyszukiwarka,
- logowanie przez SSO KAS przed API (`API_TOKEN` to tylko zabezpieczenie prototypu),
- kolejka zadań przy wielu analitykach.

---

## Bezpieczeństwo

- **Biała lista hostów.** Każde zapytanie przechodzi przez [`fetcher.ts`](apps/api/src/http/fetcher.ts), a przekierowanie poza listę jest blokowane. Dane testowe i wyniki nie trafiają do niezatwierdzonych usług.
- **Zatwierdzenie hosta działa tylko w jednej sprawie.** Strona podana wprost przez analityka jest pobierana. Strona z nieznanego hosta znaleziona w pivocie dopiero po zatwierdzeniu, które trafia do audytu.
- **Rejestr zapytań** w każdym przebiegu i **dziennik audytu** operacji.
- **Tylko OSINT:** publiczne API i strony, User-Agent przedstawiający narzędzie, limit tempa na host, żadnego logowania do serwisów.
- **API:**
  - domyślnie słucha tylko na `127.0.0.1`,
  - dane wejściowe są walidowane schematami JSON,
  - CORS jest ograniczony do localhost.
- **Opcjonalny `API_TOKEN`:**
  - token jest przechowywany w ciasteczku `HttpOnly; SameSite=Strict` i nigdy nie trafia do adresu URL,
  - porównanie odporne na pomiar czasu (timing attack).

  Nie ma kont ani ról. W KAS zastąpi go SSO.
- **Minimalizacja danych:** zapisywane są tylko przeanalizowane dokumenty, z hashem do odtworzenia.

---

## Rozbudowa

- **Nowe źródło:** plik w `apps/api/src/sources/` z interfejsem `Source` (`id`, `accepts`, `search()`) i jeden wpis w [`registry.ts`](apps/api/src/sources/registry.ts).
- **Nowa sieć blockchain:** wzorzec adresu w `extract/addresses.ts` i dostawca w `chain/providers.ts`. Dla Polygon, Arbitrum czy Base wystarczy inny `BLOCKSCOUT_URL`, bo kod jest ten sam co dla ETH.
- **Nowe etykiety:** w UI (*Etykiety adresów*) albo w `data/labels.json`.
- **Nowe reguły:** `scoring/context.ts` (słowa kluczowe), `scoring/confidence.ts` (wagi w `SCORING_PARAMS`).

---

## Zgodność z wymaganiami zadania

| Wymaganie | Gdzie w OGAR |
|---|---|
| Wejście: imię i nazwisko, nick, komunikator, login, e-mail, adres krypto | formularz **Nowa analiza**, wiele identyfikatorów naraz |
| Wyszukiwanie powiązań w otwartych źródłach | źródła Web2 i pivot ([Jak to działa](#jak-to-działa)) |
| Kategoryzacja i Wskaźnik Pewności z własnym algorytmem | K1–K8 + R1–R10 ([Wskaźnik Pewności](#wskaźnik-pewności)) |
| Rozpoznawanie i wyodrębnianie adresów z tekstu | walidacja sum kontrolnych + zakładka **Ekstraktor adresów** |
| Wskaźniki wyjścia do fiat | `CEX_OUTFLOW`, `OFFRAMP`, `STABLECOIN_SWAP` ([On-chain](#on-chain-i-wyjście-do-fiat)) |
| Odrzucanie giełd, kontraktów, adresów instytucjonalnych | E1 (etykiety), E2 (bytecode), R8 |
| Cykliczne analizy, zapis wyników, porównanie | harmonogram, historia przebiegów, zakładka **Zmiany w czasie** |
| *(opcjonalne)* Wykrywanie podmiany adresów w czasie | scenariusz 4 (monitoring), Wayback Machine |
| Źródło, URL, data pobrania i metadane do odtworzenia | zakładka **Źródła**, SHA-256, rejestr zapytań, raport cz. 8 |
| Raport: fakty / obliczenia / wnioski, czytelny bez wiedzy IT | **Raport OSINT** |
| Scenariusze na danych syntetycznych | piaskownica + `npm test` |
| Backend Node.js, React, PostgreSQL, open source, monorepo | tak ([Licencje](#licencje-i-źródła-danych)) |
| AI z łatwą wymianą modelu, uruchamiane lokalnie | API zgodne z OpenAI, Ollama ([AI](#ai-opcjonalnie)) |
| Brak wysyłki danych do niezatwierdzonych usług | biała lista hostów ([Bezpieczeństwo](#bezpieczeństwo)) |

---

## Licencje i źródła danych

Kod OGAR: [MIT](LICENSE). Wszystkie zależności są open source:

| Komponent | Wersja | Licencja |
|---|---|---|
| fastify, @fastify/cors, @fastify/static | 5.12 / 11.4 / 10.1 | MIT |
| cheerio | 1.2 | MIT |
| @noble/hashes (keccak-256) | 1.8 | MIT |
| react, react-dom | 19.3 | MIT |
| vite, @vitejs/plugin-react | 6.4 / 4.7 | MIT |
| czcionki @fontsource: Saira Stencil One, IBM Plex Sans, IBM Plex Mono | 5.3 | OFL-1.1 |
| typescript | 5.9 | Apache-2.0 |
| pg (sterownik PostgreSQL) | 8.23 | MIT |
| @electric-sql/pglite (wbudowany PostgreSQL) | 0.5 | Apache-2.0 |
| PostgreSQL (obraz `postgres:17-alpine`) | 17 | PostgreSQL License |
| Node.js (`node:test`) | 24 | MIT |

Usługi zewnętrzne (publiczne, bez kluczy, zgodnie z ich warunkami):

| Usługa | Do czego | Warunki |
|---|---|---|
| GitHub REST API | profile, README, gisty | GitHub ToS, 60 zapytań/h bez tokenu |
| Keybase API | dowody tożsamości, podpisane adresy | Keybase Terms |
| Gravatar API | profil po hashu e-maila | Gravatar/Automattic ToS |
| Reddit JSON | wypowiedzi | Reddit Data API Terms (dziś wymaga OAuth) |
| HN Algolia API | profile, komentarze, wyszukiwanie | publiczne API Algolia dla HN |
| Internet Archive (Wayback CDX) | wersje archiwalne | Internet Archive Terms of Use |
| Blockscout | dane Ethereum, etykiety, flaga kontraktu | publiczna instancja; GPL-3.0, można hostować samemu |
| Blockstream Esplora | dane Bitcoin | publiczne API; MIT, można hostować samemu |
| TronGrid | dane TRON | TronGrid Terms (bez klucza – niskie limity) |

`npm audit`: 0 podatności (21.11.2026).

---

## Ograniczenia

Mówimy otwarcie, czego OGAR dziś nie umie:

- **Na żywo działają głównie serwisy programistyczne** (GitHub, Keybase, Gravatar, Hacker News). Fora, ogłoszenia P2P i komunikatory są dziś pokryte tylko w piaskownicy. Najważniejsze brakujące źródła to **Bitcointalk** i **publiczne kanały Telegram** (podgląd `t.me/s/…` działa bez logowania).
- **Reddit** odrzuca zapytania bez OAuth (HTTP 403), dlatego nie jest włączony domyślnie.
- **Facebook, Instagram, TikTok, X, OLX** nie pozwalają szukać bez logowania, a my nie scrapujemy za logowaniem. Pojedynczą publiczną stronę można podać jako URL.
- **Nieprzetestowane:** SearXNG i Tronscan z kluczem API.
- **Wykrywanie wyjścia do fiat opiera się na etykietach.** Prawdziwe adresy depozytowe giełd są unikalne dla klienta i nieoznaczone, a OGAR nie śledzi jeszcze kroku „depozyt → portfel giełdy”. Brakuje też wyceny w PLN po kursie NBP, ważnej dla PIT-38.
- **Portfele-kontrakty** (Safe, Argent) są wykluczane jak każdy kontrakt, choć mogą należeć do osoby. Adres EVM jest sprawdzany tylko w sieci Ethereum.
- **Dane on-chain to próbka** (ostatnie 25–100 transakcji) i raport to zaznacza. Dla BTC nie ma jeszcze klastrowania adresów.
- **Lista etykiet giełd jest startowa** i wymaga utrzymania albo integracji z komercyjną bazą etykiet.
- **Wskaźnik Pewności to ocena prawdopodobieństwa, nie dowód.** Każdy wniosek w raporcie mówi, co trzeba sprawdzić.
- Prezentację PDF i film (≤ 3 min) zespół przygotowuje osobno, poza repozytorium.
