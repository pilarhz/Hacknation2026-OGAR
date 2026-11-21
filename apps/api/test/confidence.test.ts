// Testy algorytmu Wskaźnika Pewności – przypadki z załącznika pojęciowo-metodycznego (KROK 2 i 3)
// oraz reguły tożsamości (R9/R10) i limit 99%.
process.env.DB_PATH = ':memory:';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAddress, type Evidence } from '../src/scoring/confidence.ts';
import { classifyContext } from '../src/scoring/context.ts';

const ev = (over: Partial<Evidence> = {}): Evidence => ({
  docId: 'D1',
  url: 'https://example.com/a',
  site: 'example.com',
  source: 'test',
  title: 't',
  kind: 'profile',
  fetchedAt: '2026-01-01T00:00:00Z',
  attribution: 'subject',
  attributionRule: 'test',
  linkStrength: 'exact',
  depth: 0,
  context: classifyContext('profile', true, 'tip jar'),
  snippet: '',
  structured: false,
  verified: false,
  archived: false,
  viaNickOnly: false,
  identityConfirmed: true,
  identityRule: 'test',
  weakIdentity: false,
  ...over,
});
const score = (evidence: Evidence[], extra: Partial<Parameters<typeof scoreAddress>[0]> = {}) =>
  scoreAddress({ evidence, label: null, isContract: false, indicators: [], linkedToStrongAddress: false, ...extra });

test('Oficjalny profil → 80–99%', () => {
  const r = score([ev()]);
  assert.equal(r.score, 90);
  assert.equal(r.band, 'VERY_HIGH');
});

test('Ogłoszenie P2P → 60–79%', () => {
  const r = score([ev({ kind: 'listing', context: classifyContext('listing', false, 'Sprzedam USDT, płatność przelewem') })]);
  assert.equal(r.score, 70);
  assert.equal(r.band, 'PROBABLE');
});

test('Komunikator w kontekście rozliczenia → 60–79%', () => {
  const c = classifyContext('channel', false, 'przelej na adres TRC-20 i rozliczenie');
  assert.equal(c.category, 'MESSENGER_SETTLEMENT');
  assert.equal(score([ev({ kind: 'channel', context: c })]).band, 'PROBABLE');
});

test('Stopka e-mail → 60–79%', () => {
  const c = classifyContext('email', false, '-- Jan BTC: ...', 'signature');
  assert.equal(c.category, 'EMAIL_SIGNATURE');
  assert.equal(score([ev({ context: c })]).band, 'PROBABLE');
});

test('Dyskusja na forum → 40–59%', () => {
  const r = score([ev({ kind: 'post', context: classifyContext('post', false, 'ja używam metamaska, mój adres') })]);
  assert.equal(r.score, 50);
  assert.equal(r.band, 'MEDIUM');
});

test('Giveaway / masowe komentarze → 10–39%', () => {
  const c = classifyContext('comment', false, 'giveaway 🙏 0x...', undefined, 'comment');
  assert.equal(c.category, 'MASS_COMMENT');
  const r = score([ev({ kind: 'comment', context: c })]);
  assert.equal(r.score, 25);
  assert.equal(r.band, 'LOW');
});

test('Kontekst: ogólne słowa o cenie/kursie i "Pozdrawiam @…" NIE zmieniają kategorii forum', () => {
  assert.equal(classifyContext('post', false, 'Jaki kurs PLN dzisiaj? Cena spadła, mój adres 0x..').category, 'FORUM_DISCUSSION');
  assert.equal(classifyContext('post', false, 'Pozdrawiam @anonek, mój adres 0x..').category, 'FORUM_DISCUSSION');
  assert.equal(classifyContext('post', false, 'Sprzedam 0.1 BTC, cena 25 000 zł, adres 0x..').category, 'SALE_OFFER');
});

test('Synergia: dwa niezależne źródła → +15, maksymalnie 99 (prawdopodobieństwo, nie pewność)', () => {
  const r = score([ev(), ev({ docId: 'D2', site: 'p2p.example', kind: 'listing', context: classifyContext('listing', false, 'sprzedam') })]);
  assert.equal(r.score, 99);
  assert.ok(r.rules.some((x) => x.code === 'R6' && x.value === 15));
  const r2 = score([ev({ kind: 'listing', context: classifyContext('listing', false, 'x') }), ev({ docId: 'D2', site: 'b.example', kind: 'post', context: classifyContext('post', false, 'x') })]);
  assert.equal(r2.score, 85); // 70 + 15
});

test('Wielokrotne wystąpienie w jednej usłudze – bez premii', () => {
  const r = score([ev({ kind: 'post', context: classifyContext('post', false, 'x') }), ev({ docId: 'D2', kind: 'post', context: classifyContext('post', false, 'x') })]);
  assert.equal(r.score, 50);
  assert.ok(r.rules.some((x) => x.code === 'R6x'));
});

test('Wykluczenia: giełda CEX, smart kontrakt, zbiórka → 0%', () => {
  assert.equal(score([ev()], { label: { name: 'Kraken', category: 'CEX', origin: 'seed-list' } }).band, 'EXCLUDED');
  assert.equal(score([ev()], { isContract: true }).score, 0);
  assert.equal(score([ev()], { label: { name: 'Zbiórka', category: 'CHARITY', origin: 'seed-list' } }).score, 0);
});

test('Adres opublikowany przez inną osobę → brak przypisania', () => {
  const r = score([ev({ attribution: 'other' })]);
  assert.equal(r.band, 'NOT_ATTRIBUTED');
  assert.ok(r.score < 10);
});

test('Kary: pivot, częściowe dopasowanie nicka, adres archiwalny; premia: weryfikacja', () => {
  assert.equal(score([ev({ depth: 2 })]).score, 80);
  assert.equal(score([ev({ linkStrength: 'partial' })]).score, 75);
  assert.equal(score([ev({ archived: true })]).score, 80);
  assert.equal(score([ev({ structured: true })]).score, 95);
});

test('R9: konto powiązane tylko zgodnością nicku (bez odnośnika/wspólnego kontaktu) → −15', () => {
  const r = score([ev({ viaNickOnly: true, identityConfirmed: false })]);
  assert.equal(r.score, 75);
  assert.ok(r.rules.some((x) => x.code === 'R9'));
  // Ten sam nick, ale konto w potwierdzonej grupie kont – bez kary.
  assert.equal(score([ev({ viaNickOnly: true, identityConfirmed: true })]).score, 90);
  // Dopasowanie po e-mailu (unikalny identyfikator) – bez kary nawet poza grupą.
  assert.equal(score([ev({ viaNickOnly: false, identityConfirmed: false })]).score, 90);
});

test('R10: tożsamość wywnioskowana tylko z publikacji adresu wejściowego → −10', () => {
  const r = score([ev({ weakIdentity: true })]);
  assert.equal(r.score, 80);
  assert.ok(r.rules.some((x) => x.code === 'R10'));
});

test('Wynik jest deterministyczny i każda składowa jest nazwaną regułą', () => {
  const input = [ev(), ev({ docId: 'D2', site: 'x.example' })];
  assert.deepEqual(score(input), score(input));
  for (const r of score(input).rules) assert.match(r.code, /^[A-Z]\d/);
});
