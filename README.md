# 🦉 OŁCyŚ – Osintowy Łapacz Cyfrowych Śladów

**HackNation 2026 · wyzwanie Ministerstwa Finansów / KAS**

Narzędzie analityczne OSINT, które po podaniu identyfikatora (nick, e-mail, Telegram, imię i nazwisko, strona WWW albo **publiczny adres kryptowalutowy**):

1. przeszukuje publicznie dostępne źródła Web2 i **automatycznie pivotuje** po nowo odkrytych identyfikatorach,
2. **wykrywa i waliduje adresy kryptowalut** w treściach (sumy kontrolne: Base58Check, Bech32/Bech32m, EIP-55),
3. ustala, **czy adres opublikował badany**, czy ktoś inny,
4. wylicza **Wskaźnik Pewności (Confidence Score, 0–100%)** według jawnego, odtwarzalnego algorytmu,
5. **odrzuca błędne przypisania**: giełdy (CEX), smart kontrakty, miksery, zbiórki, kantory,
6. analizuje **aktywność on-chain** (BTC, ETH, TRON) i wykrywa **sygnały wyjścia do walut tradycyjnych (Fiat Cash-Out)**,
7. zapisuje wyniki z pełnymi metadanymi (URL, czas pobrania, SHA-256 treści), **uruchamia analizy cyklicznie** i **porównuje przebiegi**, w tym wykrywa podmianę adresu portfela w profilu,
8. generuje **raport OSINT**, który oddziela fakty źródłowe, wyniki obliczeń i wnioski wymagające weryfikacji. Raport jest czytelny dla osób bez wiedzy IT.

> Narzędzie korzysta wyłącznie z publicznie dostępnych źródeł. Nie loguje się na cudze konta, nie obchodzi zabezpieczeń i nie skanuje systemów. Łączy się tylko z hostami z białej listy i rejestruje każde zapytanie.

---

## Spis treści
- [Szybki start](#szybki-start)
- [Scenariusze testowe (dane syntetyczne)](#scenariusze-testowe-dane-syntetyczne)
- [Jak to działa](#jak-to-działa)
- [Parametry wyszukiwania](#parametry-wyszukiwania)
- [Wskaźnik Pewności – algorytm](#wskaźnik-pewności--algorytm)
- [Odrzucanie fałszywych trafień](#odrzucanie-fałszywych-trafień)
- [Wskaźniki on-chain i Fiat Cash-Out](#wskaźniki-on-chain-i-fiat-cash-out)
- [Raport](#raport)
- [Architektura](#architektura)
- [API REST](#api-rest)
- [Bezpieczeństwo i zgodność](#bezpieczeństwo-i-zgodność)
- [Rozbudowa](#rozbudowa)
- [Źródła danych i licencje](#źródła-danych-i-licencje)
- [Ograniczenia](#ograniczenia)

---

## Szybki start

Wymagania: **Node.js ≥ 22.18** (rekomendowany 24; używa wbudowanego `node:sqlite` i natywnego uruchamiania TypeScript). Nie potrzeba serwera bazy danych, GPU, kluczy API ani Dockera.

> ⚠️ **Odstępstwo od wymagań technicznych:** zadanie wskazuje MySQL/PostgreSQL/MongoDB/MS SQL – prototyp używa SQLite (moduł `node:sqlite`, w Node wciąż eksperymentalny), żeby uruchamiał się bez instalacji. Zapytania używają składni SQLite, więc przejście na PostgreSQL wymaga przepisania warstwy `db/` i `engine/store.ts`.

```bash
npm install
npm run build      # buduje frontend (apps/web/dist)
npm run dev        # piaskownica :4100 + API :8080 + UI (Vite) :5173
```

Otwórz **http://127.0.0.1:5173** (tryb deweloperski) albo **http://127.0.0.1:8080**, gdzie API serwuje zbudowany frontend.

Wersja produkcyjna w jednym procesie:
```bash
npm run sandbox &  # tylko do scenariuszy testowych
npm start          # build frontendu + API na :8080
```

Docker (**nieprzetestowane** – pliki przygotowane, ale obraz nie był budowany w trakcie hackathonu; linki w piaskownicy wskazują na `http://sandbox:4100`, więc nie otworzą się w przeglądarce hosta):
```bash
docker compose up --build   # api :8080 + piaskownica :4100
```

Testy i kontrola typów:
```bash
npm test           # 29 testów: walidacja adresów i identyfikatorów, reguły scoringu, scenariusze end-to-end
npm run typecheck
```

Konfiguracja przez zmienne środowiskowe opisane w [`.env.example`](.env.example). Wszystkie są opcjonalne.

---

## Scenariusze testowe (dane syntetyczne)

Zgodnie z kryteriami akceptacji scenariusze używają **wyłącznie danych syntetycznych**. Piaskownica (`apps/sandbox`) to lokalny „internet” z fikcyjnymi serwisami: forum, ogłoszenia P2P, profil programisty, publiczny podgląd kanału komunikatora, giveaway w serwisie społecznościowym i archiwum listy mailingowej. E-maile są w domenie `example.com` (RFC 2606). Adresy krypto są **poprawne kryptograficznie, ale wygenerowane z SHA-256** ([`scripts/gen-synthetic-addresses.ts`](apps/api/scripts/gen-synthetic-addresses.ts)), więc nikt nie zna do nich kluczy. Historia transakcji tych adresów pochodzi z [`data/chain-fixtures.json`](apps/api/data/chain-fixtures.json) i jest w UI oznaczona jako syntetyczna.

Scenariusze uruchamia się jednym kliknięciem w *Nowa analiza → Scenariusze demonstracyjne*. Są też pokryte testami automatycznymi ([`apps/api/test/scenarios.test.ts`](apps/api/test/scenarios.test.ts)).

| # | Wejście | Co sprawdza | Oczekiwany wynik |
|---|---|---|---|
| 1 | nick `cryptojanek` | pełny przebieg: profil → strona WWW → ogłoszenie P2P → kanał Telegram → lista mailingowa; pivot po e-mailu i Telegramie; grupowanie kont | potwierdzona grupa 5 kont (połączonych odnośnikami, e-mailem i Telegramem); BTC z profilu: **99%** (90 + synergia 4 serwisów, limit 99); ETH z ogłoszenia P2P: **70%** z sygnałami: wpłata na giełdę, kantor, swap na USDT, mikser; TRON z Telegrama: **65%** (70 − pivot); adres z forum: **40%** (50 − R9 „tylko zgodny nick” + R7 transakcje z adresem P2P); giveaway: **10%** (25 − R9); adres Binance i kontrakt USDT: **0% (wykluczenie)**; adres innego użytkownika w wątku: **brak przypisania**; literówka EIP-55: **odrzucona** |
| 2 | nick `nowak_btc` | odporność na fałszywe trafienia | adres giełdy i zbiórki → 0%, konta niepołączone z niczym → kara R9, żaden adres > 50% |
| 3 | adres `0xCfE5…ff4A` | wyszukiwanie odwrotne: adres → autor ogłoszenia → kolejne ślady | odkryty nick `cryptojanek` (pivot, kara R10), BTC ≥ 80%; autor wpisu „Uwaga, scam! Nie wysyłajcie na …” **nie** zostaje uznany za właściciela adresu |
| 4 | nick `cryptojanek`, analiza co 1 min | zmiany w czasie | po przełączeniu okresu w piaskownicy (http://127.0.0.1:4100 → „Przełącz na okres 2”) kolejny przebieg wykazuje **podmianę adresu BTC w profilu** (zakładka *Zmiany w czasie*) |
| 5 | adres BTC zbiórki rządu Ukrainy | prawdziwe, publiczne API (HN Algolia, Esplora) | dokumenty z HN, wykluczenie (zbiórka), heurystyka dużej aktywności |

> Wyniki scenariuszy 1–4 potwierdzają spójność logiki na danych zaprojektowanych przez autorów, a nie skuteczność na prawdziwym internecie.

---

## Jak to działa

```
 identyfikatory wejściowe
          │
          ▼
 ┌──────────────────┐  dokumenty (URL, autor, czas, SHA-256)   ┌───────────────────┐
 │ Źródła Web2      │ ───────────────────────────────────────▶ │ Ekstrakcja        │
 │ (registry.ts)    │ ◀─── nowe identyfikatory (pivot, BFS) ── │ adresów + ID      │
 └──────────────────┘                                          └─────────┬─────────┘
                                                                         ▼
                      ┌──────────────────────┐   ┌───────────────────────────────┐
                      │ Etykiety + on-chain  │◀──│ Przypisanie autorstwa         │
                      │ Blockscout/Esplora/  │   │ (autor = badany? dokument     │
                      │ TronGrid             │   │  badanego?) + kontekst        │
                      └──────────┬───────────┘   └───────────────────────────────┘
                                 ▼
          Wskaźnik Pewności → graf → chronologia → wnioski → raport / JSON / CSV
```

1. **Wyszukiwanie (BFS).** Każde źródło deklaruje, jakie typy identyfikatorów obsługuje. Dokumenty są deduplikowane po URL.
2. **Pivot.** Identyfikatory ujawnione w dokumentach **należących do badanego** trafiają do kolejki z głębokością +1: pola profilu (blog, e-mail, X), e-maile, `t.me/…` lub `Telegram: @nick`, telefony z jawnym prefiksem (`+48`, `tel.`), linki do profili. Podobnie wypowiedzi badanego w cudzych wątkach. Przy wejściu typu adres autor publikacji zawierającej ten adres staje się nowym identyfikatorem (wyszukiwanie odwrotne, kara R10) – **chyba że** wypowiedź ostrzega przed adresem („scam”, „nie wysyłajcie”, „oszust”), bo wtedy autor tylko go cytuje. Strony WWW ujawnione w pivocie na hostach spoza białej listy **nie są pobierane** – trafiają na listę do zatwierdzenia przez analityka.
3. **Ekstrakcja adresów.** Regex wybiera kandydatów, a następnie każdy przechodzi **walidację sumy kontrolnej**:
   - BTC/LTC/DOGE/TRON: Base58Check (podwójny SHA-256) + bajt wersji,
   - SegWit/Taproot: Bech32 (BIP-173) / Bech32m (BIP-350) z kontrolą wersji i długości programu,
   - Ethereum/EVM: EIP-55 (keccak-256). Mieszana wielkość liter z błędną sumą oznacza odrzucenie (literówka lub podróbka),
   - Solana: tylko ze słowem kluczowym w kontekście (brak sumy kontrolnej). Monero: rozpoznanie po formacie.

   Hashe transakcji (64 hex), adres zerowy i ciągi z błędną sumą są odrzucane. Odrzuceni kandydaci są widoczni w raporcie wraz z powodem.
4. **Przypisanie autorstwa.** Każde wystąpienie adresu ma autora: autora fragmentu (posta, komentarza) albo właściciela dokumentu. Adres jest przypisany badanemu, gdy autor zgadza się z identyfikatorem badanego (dokładnie / po normalizacji / częściowo) albo dokument należy do badanego. Adres wklejony przez inną osobę w tym samym wątku **nie jest przypisywany**.
5. **Tożsamość kont** ([`engine/identity.ts`](apps/api/src/engine/identity.ts)). Ten sam nick w dwóch serwisach **nie oznacza** tej samej osoby. Konta (serwis + nick) łączymy w grupy wyłącznie twardymi powiązaniami: jawny odnośnik (profil → strona WWW, ogłoszenie → `t.me/…`), wspólny e-mail/Telegram/telefon, dowód Keybase albo identyfikator z danych wejściowych. Potwierdzona jest grupa zakotwiczona w danych wejściowych, a przy samym nicku – największa grupa ≥ 2 kont z tym nickiem. Konto połączone z badanym tylko zgodnością nicku dostaje karę **R9**. Najlepszą kotwicą jest URL konkretnego profilu, e-mail lub Telegram.
6. **Kontekst publikacji.** Reguły K1–K8 klasyfikują kontekst według załącznika: profil, ogłoszenie, komunikator, stopka e-mail, forum, giveaway. Ogłoszenie wymaga wyrażenia oferty („sprzedam”, „kupię”, „oferta”, „WTS”) **i** słowa płatności – samo „cena”/„kurs”/„PLN” nie wystarcza. Stopka e-mail tylko w dokumentach będących wiadomością e-mail.
7. **On-chain i etykiety.** Patrz niżej.
8. **Wynik.** Wskaźnik Pewności, graf powiązań, chronologia przepływu środków, wnioski do weryfikacji, wykryte podmiany adresów.

---

## Parametry wyszukiwania

| Parametr | Domyślnie | Opis |
|---|---|---|
| Identyfikatory wejściowe | – | nick/login, e-mail, Telegram, komunikator, imię i nazwisko, profil (URL), strona WWW, telefon, adres krypto. Można podać kilka naraz |
| Źródła | `github`, `keybase`, `gravatar`, `hackernews`, `web`, `wayback` | dodatkowo: `reddit` (obecnie 403 – wymaga OAuth), `searxng` (wymaga własnej instancji), `sandbox` (syntetyczne) |
| Zatwierdzone hosty | brak | hosty stron ujawnionych w pivocie, zatwierdzone przez analityka w UI (zapisywane w audycie) |
| Głębokość pivotu | 2 | 0 = tylko dane wejściowe; każdy krok obniża wynik o 5 pkt (R2) |
| Limit dokumentów | 120 | ochrona przed „rozlaniem się” analizy |
| Analiza on-chain | tak | maks. 25 adresów na przebieg, priorytet dla przypisanych badanemu |
| Próg stablecoinów | 1000 USD | od tej kwoty swap na stablecoin jest sygnałem cash-out |
| AI | wyłączone | tylko sugestia kategorii kontekstu, **nie zmienia wyniku** |
| Analiza cykliczna | ręcznie | 1 min (demo), godzina, doba, tydzień – harmonogram w backendzie |

Zapytania wykonywane przez źródła:

| Źródło | Typ identyfikatora | Zapytanie |
|---|---|---|
| GitHub | nick, e-mail, imię i nazwisko, URL profilu | `GET /users/{nick}`, README profilu, gisty; `search/users?q={email} in:email`, `"{name}" in:name` (kandydaci – możliwe homonimy) |
| Keybase | nick, URL profilu | `user/lookup.json?usernames=…&github=…&reddit=…&hackernews=…` – dowody tożsamości i **podpisane** `cryptocurrency_addresses` |
| Gravatar | e-mail | profil po `sha256(e-mail)` (v3) lub `md5` (legacy) – portfele krypto, zweryfikowane konta |
| Reddit | nick, adres | `/user/{nick}/about|comments|submitted.json`, `search.json?q={adres}` |
| Hacker News | nick, adres | Algolia: `/users/{nick}`, komentarze autora, wyszukiwanie pełnotekstowe adresu |
| WWW | URL | pobranie strony wskazanej przez analityka lub ujawnionej w profilu badanego |
| Wayback Machine | URL | CDX API – do 4 różnych archiwalnych wersji strony (zmiany adresów w czasie) |
| SearXNG | nick, e-mail, nazwa, Telegram, adres, telefon | `/search?q="…"&format=json` na **własnej** instancji (on-premise) |
| Piaskownica | wszystkie | lokalna wyszukiwarka pełnotekstowa fikcyjnych stron |

---

## Wskaźnik Pewności – algorytm

Wynik to **prawdopodobieństwo, że adres należy do badanej osoby**. Liczy go wyłącznie kod regułowy ([`scoring/confidence.ts`](apps/api/src/scoring/confidence.ts)), więc ten sam materiał zawsze daje ten sam wynik. Każda składowa jest nazwaną regułą z odnośnikiem do dowodu, widoczną w UI i raporcie.

**Wartość bazowa: kontekst publikacji** (reguły K1–K8, [`scoring/context.ts`](apps/api/src/scoring/context.ts)):

| Kontekst | Baza | Przedział |
|---|---|---|
| Oficjalny, autorski profil / strona badanego | 90 | 80–99% bardzo wysokie |
| Ogłoszenie sprzedaży / oferta P2P | 70 | 60–79% prawdopodobne |
| Komunikator – kontekst rozliczenia | 70 | 60–79% |
| Stopka e-mail | 65 | 60–79% |
| Dyskusja na forum / grupie | 50 | 40–59% średnie (wymaga drugiego śladu) |
| Masowe komentarze (giveaway, konkurs) | 25 | 10–39% niskie / szum |
| Adres opublikowany przez inną osobę | 5 | brak przypisania |
| Giełda, kontrakt, mikser, zbiórka, kantor | **0** | wykluczenie |

**Modyfikatory** (wynik = najlepszy dowód + premie − kary, ograniczony do 0–99 – to prawdopodobieństwo, nigdy pewność):

| Reguła | Opis | Wartość |
|---|---|---|
| R6 | **Synergia śladów** – adres w ≥ 2 niezależnych serwisach (różne domeny). Wielokrotne wystąpienie w jednym serwisie nie podnosi wyniku | +15 |
| R7 | Bezpośrednie transakcje z innym adresem badanego o wyniku ≥ 60% | +5 |
| R4 | Adres w polu strukturalnym profilu (podpisany w Keybase, portfel w Gravatar) lub konto zweryfikowane | +5 |
| R2 | Autor ustalony przez pivot – za każdy krok (maks. 15) | −5 |
| R3a / R3b | Nick zgodny po normalizacji / tylko częściowo | −5 / −15 |
| R5 | Adres tylko w archiwalnej wersji strony | −10 |
| R8 | ≥ 5000 transakcji – profil usługi, a nie osoby | −20 |
| R9 | Konto połączone z badanym **tylko zgodnością nicku** – brak odnośnika i wspólnego kontaktu z innymi kontami badanego | −15 |
| R10 | Tożsamość autora wywnioskowana wyłącznie z publikacji adresu wejściowego (wyszukiwanie odwrotne) | −10 |

Przykłady ze scenariusza 1:
- BTC z profilu: `R1 oficjalny profil 90 + R4 konto zweryfikowane 5 + R6 synergia (kodhub, strona WWW, ogłoszenie P2P, lista mailingowa) 15 = 110 → 99%`,
- ETH z forum: `R1 forum 50 − R9 konto na forum łączy z badanym tylko nick 15 + R7 transakcje z adresem z ogłoszenia 5 = 40%`.

---

## Odrzucanie fałszywych trafień

- **E1 – etykiety.** Lista startowa [`data/labels.json`](apps/api/data/labels.json) (Binance, Coinbase, Kraken, Bitfinex, Tornado Cash, routery Uniswap/1inch, kontrakty USDT/USDC/DAI/WETH, zbiórki), etykiety analityka dodawane w UI oraz etykiety eksploratora (Blockscout `metadata.tags`, Tronscan `addressTag`), mapowane na kategorie słownikiem.
- **E2 – smart kontrakt.** Blockscout `is_contract` (bytecode ≠ 0x), TronGrid `type = Contract`.
- **Autor ≠ badany** – adres nie jest przypisany (R0).
- **Walidacja sum kontrolnych** – literówki i podróbki adresów są odrzucane.
- **Heurystyka R8** – adres o bardzo dużej liczbie transakcji jest oznaczany jako możliwa usługa.

Wykluczony adres **nie znika z raportu**. Odnotowany jest fakt interakcji, np. „badany wysyłał środki na adres Binance”, wraz z zaleceniem zapytania do giełdy.

---

## Wskaźniki on-chain i Fiat Cash-Out

Dostawcy (bez kluczy API): **Blockscout v2** (Ethereum: saldo, licznik tx, transakcje, transfery ERC-20, etykiety), **Esplora/Blockstream** (Bitcoin: statystyki, ostatnie transakcje), **TronGrid** (TRON: konto, transfery TRC-20). Cache w bazie służy wyłącznie deduplikacji zapytań **w ramach jednego przebiegu** – każdy kolejny (także cykliczny) przebieg pobiera dane na nowo. Sumy wolumenu: dla BTC z pełnych statystyk Esplory, dla ETH i TRON **tylko z pobranej próbki** (UI i raport to oznaczają).

| Kod | Znaczenie | Cash-out |
|---|---|---|
| `CEX_OUTFLOW` | wpłata na giełdę scentralizowaną (zwykle poprzedza sprzedaż za fiat; KYC u giełdy) | ✔ |
| `OFFRAMP` | interakcja z kantorem / bramką krypto-fiat / kartą / P2P | ✔ |
| `STABLECOIN_SWAP` | swap na stablecoin przez DEX w tej samej transakcji (≥ próg) | ✔ |
| `STABLECOIN_FLOW` | znaczne przepływy stablecoinów | – |
| `MIXER` | interakcja z mikserem (zacieranie pochodzenia) | – |
| `LINKED_ADDRESS` | transakcje z innym adresem przypisanym badanemu | – |
| `CEX_INFLOW`, `DEX_SWAP`, `NO_ACTIVITY`, `HIGH_ACTIVITY`, `DATA_LIMIT` | informacyjne | – |

Każdy wskaźnik wskazuje konkretne hashe transakcji. Zakładka *Przepływ środków* pokazuje chronologię wszystkich transakcji adresów przypisanych badanemu i podświetla te, które mogą oznaczać wyjście do fiat.

---

## Raport

`GET /api/runs/{id}/report.html` (przycisk *Raport*; drukowanie lub zapis do PDF z przeglądarki):

1. Parametry wyszukiwania i konfiguracja
2. Podsumowanie liczbowe
3. **Fakty źródłowe** – dla każdego adresu: URL, serwis, autor, data publikacji, data pobrania, fragment tekstu, podstawa przypisania
4. **Wyniki obliczeń** – rozpisany Wskaźnik Pewności (reguła po regule) i statystyki on-chain z oznaczeniem dostawcy
5. **Chronologia przepływu środków**
6. **Wnioski wymagające dalszej weryfikacji** – każdy z podstawą i wskazaniem, co sprawdzić
7. Ścieżka identyfikatorów (pivot)
8. **Metadane do odtworzenia analizy** – SHA-256 każdego dokumentu (pełna treść zapisana w bazie), odrzuceni kandydaci, parametry algorytmu, rejestr wszystkich zapytań sieciowych

Eksport: `export.json` (pełny wynik) i `export.csv` (adresy; separator `;`, UTF-8 BOM dla Excela).

---

## Architektura

Monorepo (npm workspaces):

```
apps/
  api/                 Node.js 24 + TypeScript (natywne uruchamianie, bez kroku build), Fastify 5
    src/
      extract/         walidacja adresów (encoding.ts: Base58Check, Bech32/m, EIP-55) + identyfikatory
      sources/         źródła Web2 – wspólny interfejs Source + registry.ts
      chain/           dostawcy blockchain, etykiety, wskaźniki on-chain
      scoring/         kontekst publikacji (K1–K8) + Wskaźnik Pewności (R0–R8, E1–E2)
      engine/          investigate.ts (BFS/pivot/przypisanie/graf/wnioski), identity.ts (grupy kont),
                       store.ts (przebiegi, harmonogram, porównania)
      ai/              wymienny dostawca AI (API zgodne z OpenAI, domyślnie wyłączony)
      report/          raport HTML
      http/fetcher.ts  jedyny punkt wyjścia do sieci: biała lista, limit tempa, cache, log
      db/              SQLite (node:sqlite), SQL zgodny z PostgreSQL
    data/              labels.json, chain-fixtures.json (syntetyczne)
    test/              node:test – 29 testów
  web/                 React 19 + Vite, Cytoscape.js (graf)
  sandbox/             syntetyczny "internet" do scenariuszy testowych
```

Model danych: `investigations` (sprawa, identyfikatory, parametry, harmonogram, zatwierdzone hosty) → `runs` (przebieg z pełnym wynikiem JSON) → `documents` (treść + SHA-256 każdego pobranego dokumentu) oraz `http_cache`, `chain_cache`, `custom_labels`, `audit_log`.

**Wymiana modelu AI** odbywa się wyłącznie przez konfigurację (`AI_BASE_URL`, `AI_MODEL`). ⚠️ Integracja AI **nie była uruchomiona** z żadnym modelem w trakcie hackathonu (kod gotowy, nieprzetestowany). Działa z każdym serwerem zgodnym z OpenAI Chat Completions: Ollama, vLLM, LM Studio, llama.cpp server. AI wyłącznie **proponuje** kategorię kontekstu dla przypadków, w których reguły dały wynik domyślny (K8). Propozycja jest pokazywana obok reguły i nie zmienia wyniku, więc rezultat pozostaje wyjaśnialny i odtwarzalny. Treść analizowana trafia do modelu jako dane w roli `user`, a instrukcja systemowa nakazuje ignorować polecenia z treści (ochrona przed prompt injection).

**Docelowo w środowisku KAS:** PostgreSQL zamiast SQLite (warstwa `db/`), lokalny model AI, SearXNG on-premise jako metawyszukiwarka, SSO przed API (`API_TOKEN` to tylko zabezpieczenie prototypu), kolejka zadań (np. BullMQ/RabbitMQ) przy wielu analitykach.

---

## API REST

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/meta` | źródła, typy identyfikatorów, parametry scoringu, konfiguracja |
| GET / POST | `/api/investigations` | lista / utworzenie analizy (`{name, caseRef?, seeds[], options?, scheduleMinutes?, runNow?}`) |
| GET / DELETE | `/api/investigations/{id}` | szczegóły z listą przebiegów / usunięcie |
| PUT | `/api/investigations/{id}/schedule` | harmonogram `{minutes}` |
| POST | `/api/investigations/{id}/approved-hosts` | zatwierdzenie hosta strony z pivotu `{host}` |
| POST | `/api/login` | ustawienie ciasteczka z tokenem (gdy `API_TOKEN`) |
| POST | `/api/investigations/{id}/runs` | nowy przebieg |
| GET | `/api/runs/{id}` | pełny wynik przebiegu |
| GET | `/api/runs/{id}/report.html` · `export.json` · `export.csv` | raport i eksport |
| GET | `/api/runs/{id}/documents/{docId}` | zapisana treść dokumentu |
| GET | `/api/compare?a={runId}&b={runId}` | porównanie dwóch przebiegów |
| GET / POST | `/api/labels` | etykiety adresów |
| POST | `/api/extract` | ekstrakcja adresów i identyfikatorów z tekstu |
| GET | `/api/audit` | dziennik zdarzeń (utworzenia, przebiegi, eksporty) |

---

## Bezpieczeństwo i zgodność

- **Biała lista hostów** ([`config.ts`](apps/api/src/config.ts)). Każde zapytanie przechodzi przez [`http/fetcher.ts`](apps/api/src/http/fetcher.ts); przekierowanie poza listę jest blokowane. Dane testowe i wyniki nie są wysyłane do niezatwierdzonych usług. AI jest domyślnie wyłączone.
- **Zgoda na host obowiązuje tylko w danym przebiegu** (AsyncLocalStorage – nie „przecieka” do innych analiz). Strona podana wprost przez analityka jest pobierana; strona ujawniona w pivocie na nieznanym hoście – dopiero po zatwierdzeniu hosta w UI (zapis w audycie).
- **Rejestr zapytań** w każdym przebiegu oraz **audit log** operacji.
- **Tylko OSINT:** publiczne API i strony, identyfikujący User-Agent, limit tempa per host, brak logowania i scrapingu za logowaniem.
- API nasłuchuje domyślnie na `127.0.0.1`. Wejście jest walidowane schematami JSON. CORS jest ograniczony do localhost. Opcjonalny `API_TOKEN`: UI prosi o token i zapisuje go w ciasteczku `HttpOnly; SameSite=Strict` (porównanie stałoczasowe); token nigdy nie trafia do adresu URL. To zabezpieczenie prototypu – brak ról i kont użytkowników.
- **Minimalizacja danych:** zapisywane są tylko dokumenty, w których szukano śladów (z hashem do odtworzenia). Usunięcie analizy usuwa kaskadowo przebiegi i dokumenty.
- Zależności: `npm audit` → 0 podatności (stan na 21.11.2026).

---

## Rozbudowa

- **Nowe źródło Web2:** plik w `apps/api/src/sources/` implementujący `Source` (`id`, `accepts`, `search()`) i jeden wpis w [`registry.ts`](apps/api/src/sources/registry.ts). Struktury fora (autor fragmentu) przekazuje się w `segments`, adresy z pól profilu w `structuredAddresses`.
- **Nowa sieć blockchain:** wzorzec `Chain` w `extract/addresses.ts` i dostawca w `chain/providers.ts` (np. Blockscout dla Polygon/Arbitrum/Base – ten sam kod co ETH, inny `BLOCKSCOUT_URL`).
- **Nowe etykiety:** UI *Etykiety adresów* lub `data/labels.json`.
- **Nowe reguły:** `scoring/context.ts` (słowa kluczowe i kategorie), `scoring/confidence.ts` (parametry w `SCORING_PARAMS`).

---

## Źródła danych i licencje

Kod: MIT. Zależności (wszystkie open source):

| Komponent | Wersja | Licencja |
|---|---|---|
| fastify, @fastify/cors, @fastify/static | 5.12 / 11.4 / 10.1 | MIT |
| cheerio | 1.2 | MIT |
| @noble/hashes (keccak-256) | 1.8 | MIT |
| react, react-dom | 19.3 | MIT |
| cytoscape | 3.35 | MIT |
| vite, @vitejs/plugin-react | 6.4 / 4.7 | MIT |
| typescript | 5.9 | Apache-2.0 |
| Node.js (`node:sqlite`, `node:test`) | 24 | MIT |

Usługi zewnętrzne (publiczne, bez kluczy; korzystanie zgodnie z ich warunkami):

| Usługa | Zastosowanie | Warunki |
|---|---|---|
| GitHub REST API | profile, README, gisty | GitHub Terms of Service, limit 60 zapytań/h bez tokenu |
| Keybase API | dowody tożsamości, podpisane adresy | Keybase Terms |
| Gravatar API | profil po hashu e-maila | Gravatar/Automattic ToS |
| Reddit JSON | wypowiedzi użytkowników | Reddit Data API Terms (obecnie wymaga OAuth – patrz ograniczenia) |
| HN Algolia API | profil, komentarze, wyszukiwanie | publiczne API Algolia dla HN |
| Internet Archive (Wayback CDX) | wersje archiwalne | Internet Archive Terms of Use |
| Blockscout (eth.blockscout.com) | dane Ethereum, etykiety, flaga kontraktu | publiczna instancja; Blockscout GPL-3.0, można hostować samodzielnie |
| Blockstream Esplora | dane Bitcoin | publiczne API; Esplora MIT, można hostować samodzielnie |
| TronGrid | dane TRON | TronGrid Terms (bez klucza – niskie limity) |

---

## Ograniczenia

- **Na żywo działają głównie serwisy programistyczne** (GitHub, Keybase, Gravatar, Hacker News). Fora, ogłoszenia P2P i komunikatory – wymienione w zadaniu – są dziś pokryte tylko w piaskownicy. Najważniejsze brakujące źródła: **Bitcointalk** (publiczne profile z adresami BTC) i **publiczne kanały Telegram** (podgląd `t.me/s/{kanał}` działa bez logowania).
- **Reddit** odrzuca dziś zapytania automatyczne bez OAuth (HTTP 403) – dlatego nie jest w domyślnym zestawie źródeł.
- **Facebook, Instagram, TikTok, X, OLX** nie udostępniają wyszukiwania bez logowania; zgodnie z zasadami OSINT ich nie scrapujemy. Publiczne strony można podać jako URL.
- **Nieprzetestowane:** dostawca AI, SearXNG, ścieżka Tronscan z kluczem (`TRONSCAN_API_KEY`), obraz Docker.
- **Wykrywanie wyjścia do fiat** opiera się na etykietach – prawdziwe adresy depozytowe giełd są unikalne dla użytkownika i nieoznaczone; brakuje analizy „o jeden krok dalej” (depozyt → portfel giełdy). Brak też wyceny w PLN (kurs NBP na dzień transakcji), istotnej dla PIT-38.
- **Portfele-kontrakty** (Safe, Argent) są wykluczane regułą E2 jak każdy kontrakt, choć mogą należeć do osoby. Adres EVM jest analizowany tylko w sieci Ethereum (BSC/Polygon – inny `BLOCKSCOUT_URL`).
- Dane on-chain są analizowane na **próbce** (ostatnie 25–100 transakcji). Sumy wolumenu pochodzą ze statystyk eksploratora, a raport informuje o próbkowaniu. Dla BTC nie stosujemy heurystyk klastrowania (common-input) – to kierunek rozwoju.
- Lista etykiet giełd jest **startowa**, spisana bez weryfikacji w eksploratorze – wymaga sprawdzenia i utrzymania (lub integracji z komercyjną bazą etykiet).
- Wskaźnik Pewności to **ocena prawdopodobieństwa, nie dowód**. Każdy wniosek w raporcie zawiera informację, co należy zweryfikować.
- Kryteria formalne spoza repozytorium (prezentacja PDF, film ≤ 3 min) przygotowuje zespół osobno.
