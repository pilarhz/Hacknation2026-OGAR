// Źródło Bitcointalk: parsowanie profilu i listy postów (struktura SMF 1.1 jak na forum) na danych syntetycznych.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitcointalkUserId, parseForumDate, parseProfile, parseUserPosts } from '../src/sources/bitcointalk.ts';
import { extractIdentifiers } from '../src/extract/identifiers.ts';

const row = (label: string, value: string) => `<tr><td><b>${label}: </b></td><td>${value}</td></tr>`;
const PROFILE = `<html><body><table>
${row('Name', 'cryptojanek')}${row('Posts', '42')}${row('Position', 'Member')}
${row('Date Registered', 'March 03, 2024, 09:15:00 PM')}${row('Website', '')}
${row('Bitcoin address', 'bc1q8f3xk2n7p5w4r6t9y0u2i3o4p5a6s7d8f9g0h1')}
<tr><td colspan="2"><hr /></td></tr>
</table>
<table><tr><td><b>Signature:</b></td></tr><tr><td colspan="2"><div class="signature">Kupię / sprzedam BTC<br />ETH: 0xCfE541F7a25C5cD54277D1Dc4A2Ca6E37626ff4A</div></td></tr></table>
</body></html>`;

const post = (msg: number, title: string, when: string, body: string) => `
<table><tr class="titlebg2"><td>1</td><td class="middletext"><a href="https://bitcointalk.org/index.php#1">Economy</a> / <a href="https://bitcointalk.org/index.php?topic=100.msg${msg}#msg${msg}">${title}</a></td><td class="middletext" align="right"> on: ${when} </td></tr></table>
<table style="table-layout: fixed;"><tr><td class="windowbg2"><div class="post">${body}</div></td></tr></table>`;

const POSTS = `<html><body>
${post(501, 'Re: Sprzedam BTC za PLN', 'November 18, 2026, 07:30:00 PM', '<div class="quoteheader"><a href="#">Quote from: ktos on November 18, 2026</a></div><div class="quote">Mój adres to 1BoatSLRHtKNngkdXEeobR76b53LETtpyT<br /></div><br />Płatność na bc1q8f3xk2n7p5w4r6t9y0u2i3o4p5a6s7d8f9g0h1, dziękuję.')}
${post(502, 'Re: Pytanie', 'Today at 08:05:10 AM', 'Bez adresu.')}
</body></html>`;

test('Bitcointalk: profil – pola, strukturalny „Bitcoin address” i podpis', () => {
  const p = parseProfile(PROFILE)!;
  assert.equal(p.name, 'cryptojanek');
  assert.equal(p.bitcoinAddress, 'bc1q8f3xk2n7p5w4r6t9y0u2i3o4p5a6s7d8f9g0h1');
  assert.equal(p.fields['Date Registered'], 'March 03, 2024, 09:15:00 PM');
  assert.match(p.signature, /0xCfE541F7a25C5cD54277D1Dc4A2Ca6E37626ff4A/);
  assert.match(p.signature, /\n/, '<br> w podpisie zamieniony na nową linię');
  assert.equal(parseProfile('<html><body><h1>Login</h1></body></html>'), null, 'strona logowania to nie profil');
});

test('Bitcointalk: posty użytkownika – permalink, data, cytat innej osoby usunięty', () => {
  const posts = parseUserPosts(POSTS, '2026-11-22T10:00:00.000Z');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].url, 'https://bitcointalk.org/index.php?topic=100.msg501#msg501');
  assert.equal(posts[0].publishedAt, '2026-11-18T19:30:00.000Z');
  assert.match(posts[0].text, /bc1q8f3xk2n7p5w4r6t9y0u2i3o4p5a6s7d8f9g0h1/);
  assert.doesNotMatch(posts[0].text, /1BoatSLRHtKNngkdXEeobR76b53LETtpyT/, 'adres z cytatu należy do innej osoby');
  assert.equal(posts[1].publishedAt, '2026-11-22T08:05:10.000Z', '„Today at …” liczone od dnia pobrania');
});

test('Bitcointalk: rozpoznanie profilu w URL i w treści (pivot)', () => {
  assert.equal(bitcointalkUserId('https://bitcointalk.org/index.php?action=profile;u=35'), 35);
  assert.equal(bitcointalkUserId('https://bitcointalk.org/index.php?action=profile;u=35;sa=showPosts'), 35);
  assert.equal(bitcointalkUserId('https://bitcointalk.org/index.php?topic=100.msg501'), null, 'wątek to nie profil');
  assert.equal(bitcointalkUserId('https://evil.example/index.php?action=profile;u=35'), null, 'tylko domena forum');
  assert.equal(parseForumDate('on: February 09, 2010, 12:49:38 AM', ''), '2010-02-09T00:49:38.000Z');
  const ids = extractIdentifiers('Mój profil na forum: https://bitcointalk.org/index.php?action=profile;u=1234567 – zapraszam');
  assert.ok(ids.some((i) => i.kind === 'social' && bitcointalkUserId(i.value) === 1234567), 'link do profilu w treści staje się identyfikatorem do pivotu');
});
