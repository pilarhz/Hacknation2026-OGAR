# OGAR – dokumentacja techniczna

Szczegóły dla osób, które będą uruchamiać, utrzymywać albo rozwijać OGAR. Opis działania, algorytm i scenariusze testowe są w [README](../README.md).

- [Sposoby uruchomienia](#sposoby-uruchomienia)
- [Struktura repozytorium](#struktura-repozytorium)
- [Model danych](#model-danych)
- [API REST](#api-rest)
- [Rozbudowa](#rozbudowa)

---

## Sposoby uruchomienia

### Tryb deweloperski

```bash
npm install
npm run dev        # piaskownica :4100 + API :8080 + UI (Vite) :5173
```

Piaskownica nie przeładowuje się sama po zmianie `apps/sandbox/sites.ts`. Po zmianach zrestartuj `npm run dev`.

### Wersja produkcyjna w jednym procesie

API serwuje zbudowany frontend na http://127.0.0.1:8080:

```bash
npm run sandbox &   # tylko jeśli chcesz scenariusze testowe
npm start           # build frontendu + API
```

### Docker z serwerem PostgreSQL 17

Przetestowane: scenariusz 1 od początku do końca, dane przetrwały restart.

```bash
docker compose up --build   # postgres + API :8080 + piaskownica :4100
```

- Hasło bazy domyślnie to `ogar_lokalnie`. Poza demem ustaw `POSTGRES_PASSWORD` (np. w pliku `.env` obok `docker-compose.yml`).
- Port bazy nie wychodzi poza sieć kontenerów.
- Linki do stron piaskownicy w wynikach wskazują `http://sandbox:4100`, czyli adres wewnątrz Dockera, więc nie otworzą się w przeglądarce. Sama analiza działa.

### Docker z lokalnym AI

1. W `docker-compose.yml` odkomentuj usługę `ollama`, wolumen `ollama` i zmienne `AI_*` w usłudze `api`.
2. Uruchom stos poleceniem `docker compose up --build`.
3. Pobierz model:

   ```bash
   docker compose exec ollama ollama pull qwen2.5:3b
   ```

Przetestowane: scenariusz 1 z AI, odpowiedź modelu w ~3 s na CPU.

### Własny serwer PostgreSQL

Ustaw `DATABASE_URL=postgres://…`. Bez tej zmiennej OGAR używa wbudowanego PostgreSQL ([PGlite](https://pglite.dev)) z danymi w `apps/api/data/pg` (`DB_PATH`). Schemat i zapytania są te same w obu trybach, a test bazy przechodzi w obu:

```bash
DATABASE_URL=postgres://ogar:haslo@127.0.0.1:5432/ogar node --test apps/api/test/store.test.ts
```

### Konfiguracja

Wszystkie zmienne (porty, źródła, biała lista hostów, token API, dostawcy blockchain, AI, limity sieci) są opisane w [`.env.example`](../.env.example). Żadna nie jest wymagana. Plik `.env` w katalogu głównym jest wczytywany automatycznie.

### Testy

```bash
npm test            # 35 testów
npm run typecheck   # kontrola typów API i interfejsu
npm run build       # build frontendu
```

---

## Struktura repozytorium

Jedno repozytorium (npm workspaces), trzy aplikacje:

```
apps/
  api/        Node.js + TypeScript (uruchamiany bez kroku kompilacji), Fastify 5
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
    scripts/    gen-synthetic-addresses.ts – generator fikcyjnych adresów do piaskownicy
    test/       testy (node:test)
  web/        React 19 + Vite – interfejs analityka
  sandbox/    fikcyjny internet do scenariuszy testowych (sites.ts – strony, server.ts – serwer)
docs/         dokumentacja techniczna
```

---

## Model danych

Schemat w [`db.ts`](../apps/api/src/db/db.ts):

| Tabela | Zawartość |
|---|---|
| `investigations` | sprawa: identyfikatory i parametry (`JSONB`), harmonogram, zatwierdzone hosty, data przeniesienia do kosza |
| `runs` | przebieg: status, pełny wynik w `JSONB`, numer przebiegu unikalny w sprawie, unieważnienie |
| `documents` | treść i SHA-256 każdego pobranego dokumentu |
| `http_cache`, `chain_cache` | deduplikacja zapytań w obrębie przebiegu |
| `custom_labels` | etykiety adresów dodane przez analityka |
| `audit_log` | dziennik zdarzeń (`BIGSERIAL`) |

- **Usuwanie:** klucze obce mają `ON DELETE CASCADE`, więc usunięcie sprawy kasuje jej przebiegi i dokumenty. Najpierw sprawa trafia na 30 dni do kosza.
- **Lista spraw:** statystyki i najwyższy wynik są liczone w bazie (`jsonb_array_elements`), bez przesyłania pełnych wyników.
- **Harmonogram:** przesuwa termin atomowo (`UPDATE … RETURNING`), więc przy kilku instancjach API przebieg nie uruchomi się dwa razy.

---

## API REST

Wszystkie ścieżki są pod `/api`. Wejście jest walidowane schematami JSON.

| Metoda | Ścieżka | Do czego |
|---|---|---|
| GET | `/health` | stan API i bazy |
| GET | `/meta` | źródła, typy identyfikatorów, parametry punktacji, konfiguracja |
| GET / POST | `/investigations` | lista spraw / nowa sprawa (`{name, caseRef?, seeds[], options?, scheduleMinutes?, runNow?}`) |
| GET / PUT / DELETE | `/investigations/{id}` | szczegóły z przebiegami / poprawa parametrów / przeniesienie do kosza |
| POST | `/investigations/{id}/runs` | nowy przebieg |
| PUT | `/investigations/{id}/schedule` | harmonogram `{minutes}` (0 lub `null` = ręcznie) |
| POST | `/investigations/{id}/approved-hosts` | zatwierdzenie hosta strony z pivotu `{host}` |
| GET | `/runs/{id}` | pełny wynik przebiegu |
| POST | `/runs/{id}/invalidate` · `/runs/{id}/revalidate` | oznaczenie przebiegu jako błędny / cofnięcie |
| GET | `/runs/{id}/report.html` · `export.json` · `export.csv` | raport i eksport |
| GET | `/runs/{id}/documents/{docId}` | zapisana treść dokumentu |
| GET | `/compare?a={runId}&b={runId}` | porównanie dwóch przebiegów |
| GET | `/trash` | zawartość kosza |
| POST | `/trash/{id}/restore` | przywrócenie analizy z kosza |
| DELETE | `/trash/{id}` | trwałe usunięcie |
| GET / POST | `/labels` | etykiety adresów |
| POST | `/extract` | wyciągnięcie adresów i identyfikatorów z wklejonego tekstu |
| GET | `/audit` | dziennik zdarzeń |
| POST | `/login` | logowanie tokenem (gdy ustawiony `API_TOKEN`) |

---

## Rozbudowa

### Nowe źródło Web2

Dodaj plik w `apps/api/src/sources/` z implementacją interfejsu `Source` (`id`, `accepts`, `search()`) i jeden wpis w [`registry.ts`](../apps/api/src/sources/registry.ts). Dwa pola pomagają silnikowi ocenić autorstwo:
- `segments`: fragmenty dokumentu z własnym autorem, np. posty w wątku forum,
- `structuredAddresses`: adresy z pól profilu, za które jest premia R4.

Host nowego źródła trzeba dodać do białej listy w [`config.ts`](../apps/api/src/config.ts).

### Nowa sieć blockchain

1. Dodaj wzorzec adresu i walidację sumy kontrolnej w `extract/addresses.ts`. Lista sieci `CHAINS` jest wspólna dla typów i walidacji API.
2. Dodaj dostawcę danych w `chain/providers.ts`.

Dla sieci EVM (Polygon, Arbitrum, Base) wystarczy inny `BLOCKSCOUT_URL`, bo kod jest ten sam co dla Ethereum.

### Nowe etykiety

Dodaj je w UI (*Etykiety adresów*) albo w [`data/labels.json`](../apps/api/data/labels.json). Wpisy z `"synthetic": true` dotyczą fikcyjnych podmiotów z piaskownicy.

### Nowe reguły punktacji

- **Słowa kluczowe i kategorie kontekstu:** [`scoring/context.ts`](../apps/api/src/scoring/context.ts).
- **Wagi premii i kar:** `SCORING_PARAMS` w [`scoring/confidence.ts`](../apps/api/src/scoring/confidence.ts). Te same wartości pokazuje zakładka *Metodyka*, bo czyta je z `/api/meta`.

### Nowy scenariusz testowy

1. Wygeneruj fikcyjne adresy:

   ```bash
   node apps/api/scripts/gen-synthetic-addresses.ts btc:etykieta eth:etykieta trx:etykieta
   ```

2. Dodaj strony w [`apps/sandbox/sites.ts`](../apps/sandbox/sites.ts) i transakcje w [`data/chain-fixtures.json`](../apps/api/data/chain-fixtures.json).
3. Dodaj test w [`test/scenarios.test.ts`](../apps/api/test/scenarios.test.ts) i preset w `apps/web/src/pages/NewPage.tsx`.
