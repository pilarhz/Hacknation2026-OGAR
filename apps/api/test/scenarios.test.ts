// Scenariusze end-to-end na danych syntetycznych (piaskownica uruchamiana w teście).
// Pokrywają kryteria akceptacji z zadania: wykrycie adresów, łączenie źródeł, Wskaźnik Pewności,
// źródła i przesłanki, wzorce on-chain, zapis metadanych, odrzucanie błędnych przypisań, zmiany w czasie.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAttributed } from '../src/scoring/confidence.ts';

const PORT = 4199;
process.env.DB_PATH = ':memory:';
process.env.SANDBOX_URL = `http://127.0.0.1:${PORT}`;
process.env.CHAIN_LIVE = 'false';
const here = path.dirname(fileURLToPath(import.meta.url));
let sandbox: ChildProcess;

before(async () => {
  sandbox = spawn(process.execPath, [path.join(here, '..', '..', 'sandbox', 'server.ts')], { env: { ...process.env, SANDBOX_PORT: String(PORT) }, stdio: 'pipe' });
  await new Promise<void>((resolve, reject) => {
    sandbox.stdout!.on('data', (d) => String(d).includes('Piaskownica') && resolve());
    sandbox.on('error', reject);
    setTimeout(() => reject(new Error('sandbox timeout')), 8000);
  });
});
after(() => sandbox?.kill());

const run = async (seeds: { kind: 'nick' | 'address' | 'url'; value: string }[]) => {
  const { runInvestigation } = await import('../src/engine/investigate.ts');
  return (await runInvestigation(seeds, { sources: ['sandbox', 'web'] })).result;
};
const find = (r: Awaited<ReturnType<typeof run>>, addr: string) => r.addresses.find((a) => a.address.toLowerCase() === addr.toLowerCase())!;

test('Scenariusz 1: nick → profil, strona, P2P, Telegram, e-mail; ocena i cash-out', async () => {
  const r = await run([{ kind: 'nick', value: 'cryptojanek' }]);
  // pivot: e-mail i Telegram ujawnione w dokumentach badanego
  assert.ok(r.identifiers.some((i) => i.kind === 'email' && i.value === 'jan.testowy@example.com'));
  assert.ok(r.identifiers.some((i) => i.kind === 'telegram' && i.value === 'janek_p2p'));
  // grupa kont połączonych odnośnikami/kontaktem: profil, strona WWW, ogłoszenie, kanał, lista mailingowa
  const main = r.identity.find((c) => c.confirmed)!;
  const sites = main.accounts.map((a) => a.site);
  for (const s of ['kodhub.example', 'janek-testowy.example', 'p2p-rynek.example', 'telegram-podglad.example', 'lista-mailingowa.example']) assert.ok(sites.includes(s), s);
  // konta na forum i w giveaway łączy z badanym tylko nick → niepotwierdzone
  assert.ok(!sites.includes('forum-krypto.example'));
  assert.ok(!sites.includes('insta-fake.example'));
  // BTC z profilu + 3 inne serwisy → synergia → limit 99
  const btc = find(r, 'bc1qpgfd4zxrrenlgyxvvlvrqy84a8f2h408fmfakp');
  assert.equal(btc.score.score, 99);
  assert.ok(btc.score.independentSites.length >= 2);
  // forum: 50 + R7 (transakcje z adresem P2P); powiązanie on-chain znosi karę R9 za sam nick = 55
  const forum = find(r, '0x7B431cddF8855cAd9946aB62557E5EE893b92D83');
  assert.ok(forum.score.rules.some((x) => x.code === 'R9'));
  assert.equal(forum.score.score, 55);
  assert.equal(forum.score.rules.find((x) => x.code === 'R9')!.value, 0);
  // ogłoszenie P2P → 70, wskaźniki wyjścia do fiat
  const p2p = find(r, '0xCfE541F7a25C5cD54277D1Dc4A2Ca6E37626ff4A');
  assert.equal(p2p.score.band, 'PROBABLE');
  const codes = p2p.indicators.map((i) => i.code);
  for (const c of ['CEX_OUTFLOW', 'OFFRAMP', 'STABLECOIN_SWAP', 'MIXER']) assert.ok(codes.includes(c as never), c);
  // komunikator (pivot) → 65
  assert.equal(find(r, 'TXLFKvqCJRzYQHsHMYNgtqHVq6VdNqgkSq').score.score, 65);
  // giveaway → niski
  assert.equal(find(r, '0x18b30Ed55876d989a6Ff02c60ad187f3cda07994').score.band, 'LOW');
  // odrzucanie błędnych przypisań
  assert.equal(find(r, '0x28C6c06298d514Db089934071355E5743bf21d60').score.band, 'EXCLUDED'); // Binance
  assert.equal(find(r, '0xdAC17F958D2ee523a2206206994597C13D831ec7').score.band, 'EXCLUDED'); // kontrakt USDT
  assert.equal(find(r, '0xeCd180Ba67478bE746F54732bE67fa8719691e6B').score.band, 'NOT_ATTRIBUTED'); // inny autor
  assert.ok(r.rejected.some((x) => x.candidate.endsWith('D84'))); // literówka EIP-55
  // metadane do odtworzenia analizy
  for (const d of r.documents) {
    assert.match(d.sha256, /^[0-9a-f]{64}$/);
    assert.ok(d.url && d.fetchedAt);
  }
  // chronologia i wnioski
  assert.ok(r.timeline.some((t) => t.cashOut));
  assert.ok(r.conclusions.some((c) => /wyjście do walut/.test(c.text)));
});

test('Scenariusz 2: nick z samymi adresami giełd/zbiórek/giveaway – brak fałszywych przypisań', async () => {
  const r = await run([{ kind: 'nick', value: 'nowak_btc' }]);
  assert.equal(find(r, '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo').score.band, 'EXCLUDED');
  assert.equal(find(r, '357a3So9CbsNfBBgFYACGvxxS6tMaDoa1P').score.band, 'EXCLUDED');
  assert.ok(r.addresses.every((a) => a.score.score <= 50));
});

test('Scenariusz 3: wyszukiwanie odwrotne – adres TRON → autorka ogłoszenia → jej kanał i drugi adres', async () => {
  const r = await run([{ kind: 'address', value: 'TUif3irKWRKLhzUw6yxyJNXayRqAncnCT9' }]);
  const nick = r.identifiers.find((i) => i.kind === 'nick' && i.value === 'ola_wymiana');
  assert.ok(nick && nick.origin === 'pivot' && nick.weak);
  // adres wejściowy: ogłoszenie (70) − pivot (5) − tożsamość tylko z wyszukiwania odwrotnego (R10)
  const trx = find(r, 'TUif3irKWRKLhzUw6yxyJNXayRqAncnCT9');
  assert.ok(trx.score.rules.some((x) => x.code === 'R10'));
  assert.equal(trx.score.band, 'MEDIUM');
  assert.ok(trx.indicators.some((i) => i.code === 'OFFRAMP')); // doładowanie karty krypto-fiat
  // drugi adres z kanału Telegram tej samej osoby
  assert.ok(isAttributed(find(r, '0xa88e193AF8F2bF13beaD0515f635371FF4A3357d').score));
  // autor ostrzeżenia "Uwaga, scam! Nie wysyłajcie na <adres>" nie jest właścicielem adresu
  assert.ok(!r.identifiers.some((i) => i.value === 'czujny_user'));
  assert.ok(r.notes.some((n) => n.includes('czujny_user')));
  // inne osoby z piaskownicy nie mieszają się do wyniku
  assert.ok(!r.identifiers.some((i) => i.value === 'cryptojanek'));
});

test('Strony ujawnione w pivocie: host spoza białej listy wymaga zatwierdzenia analityka', async () => {
  const { withRunScope } = await import('../src/http/fetcher.ts');
  const { webSource } = await import('../src/sources/web.ts');
  const skipped: { url: string; host: string; foundIn: string }[] = [];
  const ctx = { log: [], notes: [] as string[], origin: 'pivot' as const, foundIn: 'https://github.com/x', skipped };
  const docs = await withRunScope({ approvedHosts: new Set(), cacheSince: Date.now() }, () => webSource.search({ kind: 'url', value: 'https://niezaufana-strona.example/' }, ctx));
  assert.equal(docs.length, 0);
  assert.equal(skipped[0].host, 'niezaufana-strona.example');
  // zgoda dotyczy tylko jednego przebiegu – nie "przecieka" do kolejnych
  const { isHostAllowed } = await import('../src/http/fetcher.ts');
  await withRunScope({ approvedHosts: new Set(['niezaufana-strona.example']), cacheSince: Date.now() }, async () => assert.ok(isHostAllowed('https://niezaufana-strona.example/')));
  assert.ok(!isHostAllowed('https://niezaufana-strona.example/'));
});

test('Scenariusz 4: monitoring URL profilu – podmiana adresu, a z nowego adresu wpłata na giełdę', async () => {
  const seeds = [{ kind: 'url' as const, value: `http://127.0.0.1:${PORT}/s/kodhub.example/marek_dev` }];
  const r1 = await run(seeds);
  await fetch(`http://127.0.0.1:${PORT}/__admin/period?value=2`, { method: 'POST' });
  const r2 = await run(seeds);
  await fetch(`http://127.0.0.1:${PORT}/__admin/period?value=1`, { method: 'POST' });
  const V1 = 'bc1ql8ur7j730hwtyn3jfwxcvwwwyqttksaln6tal8';
  const V2 = 'bc1q3nvmyp6hwzzyyjda3w0dvvvqp8h4vcku6huhnw';
  assert.deepEqual(r1.addresses.map((a) => a.address), [V1]);
  assert.deepEqual(r2.addresses.map((a) => a.address), [V2]);
  assert.equal(find(r2, V2).score.band, 'VERY_HIGH'); // własny profil
  assert.equal(r1.stats.cashOutSignals, 0);
  assert.ok(find(r2, V2).indicators.some((i) => i.code === 'CEX_OUTFLOW'));
});
