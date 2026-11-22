// Testy poprawek: rozpoznawanie ostrzeżeń po polsku, kategorie tagów eksploratorów,
// postać kanoniczna adresów etykiet analityka, serializacja JSONB z „\u0000” w treści.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { WARNING_CONTEXT } = await import('../src/engine/investigate.ts');
const { canonicalLabelAddress, categorizeExplorerTag } = await import('../src/chain/labels.ts');
const { toJsonb } = await import('../src/db/db.ts');

test('Ostrzeżenie przed adresem: polskie słowa z diakrytykami na granicy wyrazu', () => {
  for (const s of ['Zgłoś ten adres, to oszustwo', 'zgłoś', 'UWAGA NA ten portfel', 'fałszywy adres', 'Ostrzeżenie: phishing', 'kradzież środków', 'scammer!', 'reported to police'])
    assert.ok(WARNING_CONTEXT.test(s), s);
  // zwykłe słowa zawierające te ciągi wewnątrz nie są ostrzeżeniem
  for (const s of ['raport kwartalny', 'reporter lokalnej gazety', 'mój portfel do napiwków']) assert.ok(!WARNING_CONTEXT.test(s), s);
});

test('Tagi eksploratorów: konkretna usługa przed ogólnym słowem, krótkie słowa z granicami', () => {
  assert.equal(categorizeExplorerTag('Uniswap V1: BAT Exchange'), 'DEX'); // wcześniej: CEX (przez „exchange”)
  assert.equal(categorizeExplorerTag('Binance 14'), 'CEX');
  assert.equal(categorizeExplorerTag('Kraken Deposit'), 'CEX');
  assert.equal(categorizeExplorerTag('Tornado.Cash: Router'), 'MIXER');
  assert.equal(categorizeExplorerTag('Index Coop: Treasury'), null); // wcześniej: DEX (przez „dex” w „index”)
  assert.equal(categorizeExplorerTag('ETHGlobal Hackathon Prize'), null); // wcześniej: SCAM (przez „hack”)
  assert.equal(categorizeExplorerTag('Fake_Phishing1234'), 'SCAM');
  assert.equal(categorizeExplorerTag('Ronin Bridge Exploiter'), 'BRIDGE');
  assert.equal(categorizeExplorerTag('MoonPay: Hot Wallet'), 'OFFRAMP');
});

test('Etykieta analityka: adres w postaci kanonicznej, walidacja sumy kontrolnej i sieci', () => {
  // bech32 wielkimi literami → małe (tak jak klucz adresu wykrytego w tekście)
  assert.deepEqual(canonicalLabelAddress('BTC', ' BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4 '), { address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' });
  // EVM małymi literami → EIP-55
  assert.deepEqual(canonicalLabelAddress('ETH', '0xdac17f958d2ee523a2206206994597c13d831ec7'), { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' });
  assert.match((canonicalLabelAddress('BTC', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb') as { error: string }).error, /suma kontrolna/);
  assert.match((canonicalLabelAddress('ETH', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') as { error: string }).error, /TRX/);
  assert.match((canonicalLabelAddress('BTC', 'adres 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa') as { error: string }).error, /Niepoprawny/); // tylko sam adres
  assert.ok('address' in canonicalLabelAddress('SOL', '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV'));
  assert.ok('address' in canonicalLabelAddress('LTC', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')); // P2SH „3…” wspólny dla BTC/LTC
});

test('JSONB: dosłowny tekst „\\u0000” w treści (np. kod) nie psuje serializacji; prawdziwy NUL usunięty', () => {
  const BS = '\\';
  const code = `const nul = "${BS}u0000";`;
  const json = toJsonb({ code, nul: 'a\u0000b', list: ['x\u0000'] });
  const back = JSON.parse(json);
  assert.equal(back.code, code);
  assert.equal(back.nul, 'ab');
  assert.deepEqual(back.list, ['x']);
});

test('Lista startowa etykiet: każdy adres ma poprawną sumę kontrolną, zgodną sieć i postać kanoniczną; giełdy wykluczają (E1)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { scoreAddress } = await import('../src/scoring/confidence.ts');
  const { lookupLabel } = await import('../src/chain/labels.ts');
  const file = JSON.parse(readFileSync(fileURLToPath(new URL('../data/labels.json', import.meta.url)), 'utf8')) as { labels: { chain: 'BTC' | 'ETH' | 'TRX'; address: string; category: string }[] };
  const keys = new Set<string>();
  for (const l of file.labels) {
    const c = canonicalLabelAddress(l.chain, l.address);
    assert.ok('address' in c, `${l.chain} ${l.address}: ${'error' in c ? c.error : ''}`);
    assert.equal(c.address, l.address, `${l.address} nie jest w postaci kanonicznej`);
    const key = `${l.chain}:${l.address.toLowerCase()}`;
    assert.ok(!keys.has(key), `duplikat ${l.address}`);
    keys.add(key);
  }
  for (const btc of ['3LYJfcfHPXYJreMsASk2jkn69LWEYKzexb', '1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s', 'bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2']) {
    const s = scoreAddress({ evidence: [], label: lookupLabel('BTC', btc), isContract: null, indicators: [], linkedToStrongAddress: false });
    assert.equal(s.band, 'EXCLUDED', btc);
  }
});
