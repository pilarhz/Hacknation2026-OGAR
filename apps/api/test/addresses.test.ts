import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAddresses } from '../src/extract/addresses.ts';
import { extractIdentifiers, handleMatch } from '../src/extract/identifiers.ts';

const one = (t: string) => extractAddresses(t).matches.map((m) => `${m.chain}:${m.address}`);

test('BTC: legacy, P2SH, SegWit (BIP-173), Taproot (BIP-350)', () => {
  assert.deepEqual(one('genesis 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa.'), ['BTC:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa']);
  assert.deepEqual(one('p2sh 3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'), ['BTC:3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy']);
  assert.deepEqual(one('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4'), ['BTC:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4']);
  assert.deepEqual(one('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'), ['BTC:bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0']);
});

test('BTC: błędna suma kontrolna → odrzucony z powodem', () => {
  const r = extractAddresses('adres 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb');
  assert.equal(r.matches.length, 0);
  assert.match(r.rejected[0].reason, /suma kontrolna/);
  // SegWit v0 zakodowany jako bech32m jest niepoprawny (BIP-350)
  assert.equal(extractAddresses('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5').matches.length, 0);
});

test('ETH: EIP-55 poprawny, błędny, jednolita wielkość liter', () => {
  assert.deepEqual(one('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'), ['ETH:0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045']);
  const bad = extractAddresses('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96046');
  assert.equal(bad.matches.length, 0);
  assert.match(bad.rejected[0].reason, /EIP-55/);
  const lower = extractAddresses('0xdac17f958d2ee523a2206206994597c13d831ec7').matches[0];
  assert.equal(lower.address, '0xdAC17F958D2ee523a2206206994597C13D831ec7');
  assert.equal(lower.checksum, 'not-applicable');
});

test('Hash transakcji (64 hex) nie jest adresem; adres zerowy odrzucony', () => {
  assert.equal(extractAddresses('tx 0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060').matches.length, 0);
  assert.equal(extractAddresses('0x0000000000000000000000000000000000000000').matches.length, 0);
});

test('TRON, Litecoin, Dogecoin', () => {
  assert.deepEqual(one('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), ['TRX:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t']);
  assert.deepEqual(one('doge DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L'), ['DOGE:DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L']);
});

test('Solana tylko z podpowiedzią w kontekście', () => {
  const addr = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
  assert.equal(extractAddresses(`random ${addr}`).matches.length, 0);
  assert.equal(extractAddresses(`mój portfel Solana: ${addr}`).matches[0].chain, 'SOL');
});

test('Wiele adresów w tekście, kontekst wokół adresu', () => {
  const r = extractAddresses('BTC: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa, ETH: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  assert.equal(r.matches.length, 2);
  assert.match(r.matches[1].context, /BTC: 1A1z/);
});

test('Identyfikatory: e-mail, Telegram, profile, dopasowanie nicków', () => {
  const ids = extractIdentifiers('pisz: jan.testowy@example.com, t.me/janek_p2p albo https://github.com/cryptojanek');
  const kinds = ids.map((i) => `${i.kind}:${i.value}`);
  assert.ok(kinds.includes('email:jan.testowy@example.com'));
  assert.ok(kinds.includes('telegram:janek_p2p'));
  assert.ok(kinds.includes('social:https://github.com/cryptojanek'));
  assert.equal(handleMatch('CryptoJanek', 'cryptojanek'), 'exact');
  assert.equal(handleMatch('crypto_janek', 'cryptojanek'), 'normalized');
  assert.equal(handleMatch('cryptojanek_pl', 'cryptojanek'), 'partial');
  assert.equal(handleMatch('anonek', 'cryptojanek'), 'none');
});

test('Identyfikatory: brak fałszywych telefonów i nicków Telegram', () => {
  // liczby bez prefiksu telefonicznego nie są telefonami (kwoty, nr zamówień, fragmenty adresów)
  assert.deepEqual(extractIdentifiers('tx: bc1qz123456789abc, kwota 250 000 000 sat, nr zamówienia 600123456'), []);
  // słowo po "Telegram" bez @ ani linku nie jest nickiem
  assert.deepEqual(extractIdentifiers('Piszcie na Telegram support albo telegram kanał ogólny'), []);
  const ok = extractIdentifiers('tel. 600 123 456, +48 501-222-333, Telegram: @janek_p2p, t.me/s/kanal_testowy, t.me/joinchat/abcdef').map((i) => `${i.kind}:${i.value}`);
  assert.ok(ok.includes('phone:+48600123456'));
  assert.ok(ok.includes('phone:+48501222333'));
  assert.ok(ok.includes('telegram:janek_p2p'));
  assert.ok(ok.includes('telegram:kanal_testowy'));
  assert.ok(!ok.some((x) => x.includes('joinchat')));
});
