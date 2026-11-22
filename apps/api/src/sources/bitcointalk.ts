// Bitcointalk – największe forum kryptowalutowe (SMF). Czytamy wyłącznie strony dostępne dla gościa:
//  - profil https://bitcointalk.org/index.php?action=profile;u=<id> – ma strukturalne pole „Bitcoin address" i podpis,
//  - ostatnie posty użytkownika (…;sa=showPosts) – każdy z permalinkiem i datą.
// Wyszukiwarka forum (po nicku i treści) wymaga logowania, więc NIE szukamy po nicku – źródło działa
// dla adresu profilu podanego przez analityka albo ujawnionego w pivocie (np. link w bio GitHub).
// robots.txt forum nie ogranicza dostępu; forum prosi o umiarkowane tempo – zachowujemy >1 s między zapytaniami.
import * as cheerio from 'cheerio';
import { fetchText } from '../http/fetcher.ts';
import type { Source, SourceDocument } from './types.ts';

const BASE = 'https://bitcointalk.org/index.php';
/** Luźny filtr – do analizy trafiają tylko posty, w których może być adres krypto. */
const CRYPTO_HINT = /0x[0-9a-fA-F]{40}|\b(?:bc1|ltc1)[0-9a-z]{20,}|\b[13LMDT][1-9A-HJ-NP-Za-km-z]{25,34}\b/;
const PAUSE_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Id użytkownika z adresu profilu / listy postów Bitcointalk; null = to nie jest profil. */
export function bitcointalkUserId(value: string): number | null {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)bitcointalk\.org$/i.test(u.hostname)) return null;
  // SMF używa średników w query: ?action=profile;u=35;sa=showPosts
  const q = decodeURIComponent(u.search);
  if (!/action=profile/i.test(q)) return null;
  const m = /[;&?]u=(\d{1,9})\b/.exec(q);
  return m ? Number(m[1]) : null;
}

/**
 * Data z forum („November 20, 2026, 02:10:24 PM" albo „Today at 02:10:24 PM").
 * Godziny dla gościa są w strefie forum (UTC).
 */
export function parseForumDate(raw: string, fetchedAt: string): string | undefined {
  const s = raw.replace(/^\s*on:\s*/i, '').replace(/\s+/g, ' ').trim();
  const today = /^Today at (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/i.exec(s);
  if (today) {
    const d = new Date(fetchedAt);
    let h = Number(today[1]) % 12;
    if (today[4].toUpperCase() === 'PM') h += 12;
    d.setUTCHours(h, Number(today[2]), Number(today[3]), 0);
    return d.toISOString();
  }
  const t = Date.parse(`${s.replace(/, (\d{1,2}:\d{2})/, ' $1')} UTC`);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

export interface BitcointalkProfile {
  name: string;
  fields: Record<string, string>;
  bitcoinAddress?: string;
  signature: string;
}

/** Profil SMF: tabela „Etykieta: | wartość" + blok podpisu. */
export function parseProfile(html: string): BitcointalkProfile | null {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $('tr').each((_, tr) => {
    const tds = $(tr).children('td');
    if (tds.length !== 2) return;
    const label = $(tds[0]).text().replace(/\s+/g, ' ').trim().replace(/:\s*$/, '');
    if (!label || label.length > 40 || !$(tds[0]).find('b').length) return;
    fields[label] = $(tds[1]).text().replace(/\s+/g, ' ').trim();
  });
  if (!fields.Name) return null;
  const sig = $('div.signature').first();
  sig.find('br').replaceWith('\n');
  return {
    name: fields.Name,
    fields,
    bitcoinAddress: fields['Bitcoin address'] || undefined,
    signature: sig.text().trim(),
  };
}

/** Lista „Latest posts of …": posty z permalinkiem i datą; cytaty innych osób są usuwane. */
export function parseUserPosts(html: string, fetchedAt: string): { url: string; title: string; publishedAt?: string; text: string }[] {
  const $ = cheerio.load(html);
  const out: { url: string; title: string; publishedAt?: string; text: string }[] = [];
  $('div.post').each((_, el) => {
    const post = $(el);
    const head = post.closest('table').prev('table');
    const link = head.find('a[href*=".msg"]').last();
    const url = link.attr('href');
    if (!url) return;
    // cytat to cudza wypowiedź – adres w cytacie nie może być przypisany autorowi posta
    post.find('.quoteheader, .quote').remove();
    post.find('br').replaceWith('\n');
    out.push({
      url,
      title: link.text().trim(),
      publishedAt: parseForumDate(head.find('td').last().text(), fetchedAt),
      text: post.text().replace(/[ \t]+/g, ' ').trim(),
    });
  });
  return out;
}

export const bitcointalkSource: Source = {
  id: 'bitcointalk',
  label: 'Bitcointalk (forum)',
  description: 'Profil forum po adresie URL (pole „Bitcoin address", podpis) i ostatnie posty użytkownika z adresami krypto. Wyszukiwanie po nicku wymaga logowania, więc nie jest używane.',
  accepts: ['social', 'url'],
  hosts: ['bitcointalk.org'],
  async search(identifier, ctx) {
    const uid = bitcointalkUserId(identifier.value);
    if (!uid) return [];
    const profileUrl = `${BASE}?action=profile;u=${uid}`;
    const res = await fetchText(profileUrl, { log: ctx.log, accept: 'text/html' });
    if (res.status !== 200) {
      ctx.notes.push(`Bitcointalk u=${uid}: profil niedostępny (HTTP ${res.status}).`);
      return [];
    }
    const prof = parseProfile(res.body);
    if (!prof) {
      ctx.notes.push(`Bitcointalk u=${uid}: brak publicznego profilu (konto nie istnieje albo forum wymaga logowania).`);
      return [];
    }
    const f = prof.fields;
    const docs: SourceDocument[] = [
      {
        source: 'bitcointalk',
        url: profileUrl,
        title: `Bitcointalk: ${prof.name}`,
        kind: 'profile',
        author: prof.name,
        publishedAt: f['Date Registered'] ? parseForumDate(f['Date Registered'], res.fetchedAt) : undefined,
        fetchedAt: res.fetchedAt,
        content: [
          `Profil forum Bitcointalk: ${prof.name}`,
          f.Position && `Pozycja: ${f.Position}`,
          f.Posts && `Posty: ${f.Posts}`,
          f['Date Registered'] && `Zarejestrowany: ${f['Date Registered']}`,
          f.Website && `Strona: ${f.Website}`,
          prof.bitcoinAddress && `Bitcoin address: ${prof.bitcoinAddress}`,
          prof.signature && `Podpis: ${prof.signature}`,
        ]
          .filter(Boolean)
          .join('\n'),
        structuredAddresses: prof.bitcoinAddress ? [{ address: prof.bitcoinAddress, label: 'pole profilu „Bitcoin address”' }] : undefined,
        query: `Bitcointalk profil u=${uid}`,
        subjectMatch: 'direct',
      },
    ];

    await sleep(PAUSE_MS);
    const postsUrl = `${profileUrl};sa=showPosts`;
    const pr = await fetchText(postsUrl, { log: ctx.log, accept: 'text/html' });
    if (pr.status === 200) {
      for (const p of parseUserPosts(pr.body, pr.fetchedAt)) {
        if (!CRYPTO_HINT.test(p.text)) continue;
        docs.push({
          source: 'bitcointalk',
          url: p.url,
          title: `Bitcointalk: ${p.title || 'post'} (${prof.name})`,
          kind: 'post',
          author: prof.name,
          publishedAt: p.publishedAt,
          fetchedAt: pr.fetchedAt,
          content: p.text,
          query: `Bitcointalk ostatnie posty u=${uid}`,
          subjectMatch: 'direct',
        });
      }
    } else ctx.notes.push(`Bitcointalk u=${uid}: lista postów niedostępna (HTTP ${pr.status}).`);
    return docs;
  },
};
