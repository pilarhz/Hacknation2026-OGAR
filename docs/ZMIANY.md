# Zmiany po przeglądzie kodu

Przegląd całego kodu (`apps/api`, `apps/web`, `apps/sandbox`). Wszystkie zmiany są pokryte testami:
`npm test` → **52/52** (było 41), `npm run typecheck` bez błędów. Wyniki scenariuszy 1–4 są bez zmian.

## Błędy poprawione

| # | Gdzie | Problem | Skutek przed poprawką | Poprawka |
|---|---|---|---|---|
| 1 | `http/fetcher.ts` | `redirect: 'follow'`, a host sprawdzany dopiero na `res.url` | Zapytanie (z URL-em, parametrami i nagłówkami) **docierało** do hosta spoza białej listy, a blokada była dopiero po fakcie. Łamało to deklarację „brak wysyłki danych do niezatwierdzonych usług”. | Ręczna obsługa przekierowań: host sprawdzany przed każdym kolejnym zapytaniem, maks. 5 przekierowań, wpis `BLOCKED` w rejestrze zapytań |
| 2 | `http/fetcher.ts` | `res.arrayBuffer()` bez limitu | Ogromna odpowiedź trafiała w całości do pamięci, a obcięcie do 2 mln znaków było dopiero potem | Odczyt strumieniowy z limitem 8 MB |
| 3 | `db/db.ts` `toJsonb` | NUL wycinany regexem z gotowego JSON-a | Dokument zawierający **dosłowny tekst** `\u0000` (typowy w kodzie z GitHuba lub gistów) dawał niepoprawny JSON i **cały przebieg kończył się błędem** | NUL usuwany z wartości (replacer `JSON.stringify`) |
| 4 | `engine/investigate.ts` `WARNING_CONTEXT` | `\b` i `\w` nie znają polskich liter | „Zgłoś” nie było rozpoznawane jako ostrzeżenie, więc autor ostrzeżenia mógł zostać potraktowany jako **właściciel** adresu przy wyszukiwaniu odwrotnym | Granice na `\p{L}` (flaga `u`), jak w `scoring/context.ts`, plus wariant „zglos” |
| 5 | `engine/investigate.ts` (R7) | Zbiór „silnych” adresów (≥ 60%) liczony z wyniku **bez** kar wskaźników | Adres, który R8 (≥ 5000 tx, czyli raczej usługa) spychał poniżej 60%, nadal dawał sąsiadom premię R7 i znosił im karę R9 | Wynik wstępny z karami, ale bez R7, a dopiero z niego zbiór silnych adresów |
| 6 | `chain/labels.ts` `categorizeExplorerTag` | Ogólne słowa sprawdzane przed nazwami usług, brak granic słów | „Uniswap … Exchange” → **CEX** (fałszywy sygnał wyjścia do fiat), „Index Coop” → DEX, „Hackathon” → SCAM | Najpierw konkretne usługi, potem ogólne słowa; `\b` dla krótkich słów |
| 7 | `POST /api/labels` | Adres etykiety zapisywany tak, jak go wpisano | Etykieta `BC1Q…` (wielkie litery) nie pasowała do klucza wykrytego adresu (`bc1q…`), więc **wykluczenie E1 po cichu nie działało**. Dało się też zapisać śmieci jako adres. | `canonicalLabelAddress`: walidacja sumy kontrolnej, postać kanoniczna, zgodność sieci (HTTP 400 z opisem) |
| 8 | `engine/store.ts` | Przebieg w stanie `running` po restarcie lub awarii API | Wisiał na zawsze jako „trwający”, a analityk nie mógł go unieważnić (409) | `recoverInterruptedRuns()` przy starcie oznacza go jako błąd z opisem i zapisem w audycie |
| 9 | `PUT /api/investigations/:id` | `invalidateRunId` bez sprawdzenia właściciela | Poprawka jednej sprawy mogła unieważnić przebieg **innej** sprawy | Sprawdzenie `runBelongsTo` (HTTP 400) |
| 10 | `GET /api/compare` | Brak schematu i brak sprawdzenia, czy przebiegi są z jednej sprawy | Porównanie przebiegów różnych spraw dawało mylący raport zmian | Schemat zapytania i błąd przy różnych sprawach |

## Bezpieczeństwo (dodatkowo)

- Nagłówki dla wszystkich odpowiedzi: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.
- Raport OSINT (`report.html`) renderuje treści z internetu, więc oprócz escapowania dostał ścisłe CSP: `default-src 'none'`, bez zewnętrznych zasobów, jedyny dozwolony skrypt to przycisk „Drukuj” (hash).

## Wydajność

- **Źródła równolegle:** wszystkie źródła dla jednego identyfikatora są odpytywane jednocześnie (różne hosty, a limit tempa per host nadal pilnuje fetcher). Wyniki są przetwarzane w stałej kolejności źródeł, więc numeracja dokumentów (D1, D2…), notatki i wynik są takie same jak przy odpytywaniu po kolei.
- **On-chain równolegle:** do 4 zapytań naraz (BTC, ETH i TRON to różne eksploratory). Kolejność i limit `maxChainLookups` bez zmian.
- **Zapis dokumentów paczkami:** jedno `INSERT … SELECT FROM jsonb_to_recordset` na 25 dokumentów zamiast jednego zapytania na dokument.
- Komunikat o limicie dokumentów pojawia się raz, a nie po razie na każde kolejne źródło.

## Nowe testy

- `test/fetcher.test.ts`: przekierowanie poza listę jest blokowane bez łączenia się z hostem docelowym; przekierowania względne w obrębie listy działają; pętla przekierowań kończy się błędem; limit rozmiaru odpowiedzi.
- `test/hardening.test.ts`: ostrzeżenia po polsku, kategorie tagów eksploratorów, postać kanoniczna adresów etykiet, JSONB z `\u0000` w treści.
- `test/store.test.ts`: odzyskiwanie przerwanych przebiegów, porównanie i unieważnianie tylko w obrębie sprawy, kompletność zapisu dokumentów paczkami.

## Znane ograniczenie

- `recoverInterruptedRuns` zakłada jedną instancję API na bazę (tak działa obecne wdrożenie). Przy kilku instancjach trzeba ją zastąpić kolejką zadań z dzierżawą (lease), co jest już w planie „Docelowo w KAS”.

## Etykiety giełd BTC (wykluczenie E1)

Dla BTC nie ma darmowego API etykiet adresów (dla ETH etykiety daje Blockscout), więc wykluczanie giełd BTC opiera się na liście startowej. Dodano 3 adresy o **potwierdzonej** przynależności:

| Adres | Podmiot | Potwierdzenie |
|---|---|---|
| `3LYJfcfHPXYJreMsASk2jkn69LWEYKzexb` | Binance (cold wallet) | ogłoszony przez Binance w 2019 r. (rezerwa BTCB) |
| `1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s` | Binance (hot wallet) | klaster „Binance.com” w WalletExplorer |
| `bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2` | Robinhood (portfel powierniczy) | własność potwierdzona przez Robinhood (CryptoSlate) |

Adresów, których przynależności nie dało się potwierdzić w publicznych źródłach (m.in. portfele TRON, które bez klucza Tronscan nie mają publicznej etykiety), celowo **nie dodano**: błędna etykieta wykluczyłaby prywatny portfel badanego. Nowy test sprawdza, że każdy wpis listy ma poprawną sumę kontrolną, zgodną sieć, postać kanoniczną i nie jest duplikatem.
