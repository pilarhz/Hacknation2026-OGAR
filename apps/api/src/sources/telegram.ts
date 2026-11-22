// Telegram – publiczny podgląd kanału https://t.me/s/<kanał> (bez logowania i bez API z kluczem).
// Telegram udostępnia tę stronę każdemu w przeglądarce; nie ma robots.txt ograniczającego dostęp.
// Czytamy tylko kanały publiczne: grupy prywatne, czaty i kanały bez podglądu są niedostępne z założenia.
//
// Wynik:
//  - dokument „profil kanału" (nazwa, opis, znacznik weryfikacji) – adres w opisie = oficjalny zasób właściciela,
//  - osobny dokument dla każdej wiadomości z możliwym adresem krypto – z permalinkiem i datą publikacji,
//    żeby raport wskazywał dokładną wiadomość, a kontekst „rozliczenia" (K4) był oceniany dla niej osobno.
import * as cheerio from 'cheerio';
import { fetchText } from '../http/fetcher.ts';
import type { Source, SourceDocument } from './types.ts';

/** Luźny filtr – do analizy trafiają tylko wiadomości, w których może być adres krypto. */
const CRYPTO_HINT = /0x[0-9a-fA-F]{40}|\b(?:bc1|ltc1)[0-9a-z]{20,}|\b[13LMDT][1-9A-HJ-NP-Za-km-z]{25,34}\b|\b(?:btc|eth|usdt|usdc|trx|wallet|portfel)\b/i;
/** Nazwa kanału w Telegramie: 5–32 znaki, litera na początku. */
const HANDLE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
/** Ścieżki t.me, które nie są kanałami (zaproszenia, naklejki, udostępnianie…). */
const RESERVED = new Set(['joinchat', 'addstickers', 'addemoji', 'share', 'proxy', 'socks', 'login', 'setlanguage', 'confirmphone', 'iv']);
/** Ile stron podglądu (po ~20 wiadomości) czytamy wstecz. */
const MAX_PAGES = 3;

export function normalizeTelegramHandle(v: string): string | null {
  const h = v
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:t|telegram)\.me\/(?:s\/)?/i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '');
  return HANDLE.test(h) && !RESERVED.has(h.toLowerCase()) ? h : null;
}

export interface TelegramPage {
  /** false = strona bez podglądu (kanał nie istnieje, jest prywatny albo to konto użytkownika). */
  isChannel: boolean;
  title: string;
  description: string;
  verified: boolean;
  messages: { id: number; url: string; publishedAt?: string; author?: string; text: string }[];
  /** Identyfikator do pobrania starszych wiadomości (?before=…), jeśli są. */
  before: number | null;
}

/** Parsowanie strony t.me/s/<kanał> (wydzielone, żeby dało się je testować bez sieci). */
export function parseTelegramPage(html: string): TelegramPage {
  const $ = cheerio.load(html);
  const info = $('.tgme_channel_info').first();
  const messages: TelegramPage['messages'] = [];
  $('.tgme_widget_message[data-post]').each((_, el) => {
    const m = $(el);
    const post = m.attr('data-post') ?? '';
    const id = Number(post.split('/').pop());
    const textEl = m.find('.tgme_widget_message_text').first();
    textEl.find('br').replaceWith('\n');
    const text = textEl.text().replace(/[ \t]+/g, ' ').trim();
    if (!text || !Number.isFinite(id)) return;
    messages.push({
      id,
      url: m.find('a.tgme_widget_message_date').attr('href') || `https://t.me/${post}`,
      publishedAt: m.find('time[datetime]').first().attr('datetime') || undefined,
      // podpis autora wiadomości (kanały z podpisami); brak = wiadomość wysłana jako kanał
      author: m.find('.tgme_widget_message_from_author').first().text().trim() || undefined,
      text,
    });
  });
  const more = $('.tme_messages_more[data-before]').first().attr('data-before');
  return {
    isChannel: info.length > 0 || messages.length > 0,
    title: info.find('.tgme_channel_info_header_title').first().text().trim() || $('meta[property="og:title"]').attr('content') || '',
    description: info.find('.tgme_channel_info_description').first().text().replace(/\s+/g, ' ').trim(),
    verified: info.find('.verified-icon').length > 0,
    messages,
    before: more ? Number(more) : null,
  };
}

export const telegramSource: Source = {
  id: 'telegram',
  label: 'Telegram (kanały publiczne)',
  description: 'Publiczny podgląd kanału t.me/s/… – opis kanału i ostatnie wiadomości z możliwym adresem krypto (każda z permalinkiem i datą).',
  accepts: ['telegram', 'nick'],
  hosts: ['t.me'],
  async search(identifier, ctx) {
    const handle = normalizeTelegramHandle(identifier.value);
    if (!handle) return [];
    // Telegram podany wprost to zasób badanego; sam nick może należeć do kogoś innego (R9).
    const match: SourceDocument['subjectMatch'] = identifier.kind === 'telegram' ? 'direct' : 'search-candidate';
    const docs: SourceDocument[] = [];
    let before: number | null = null;
    let page: TelegramPage | null = null;
    let first = true;

    for (let p = 0; p < MAX_PAGES; p++) {
      const url = `https://t.me/s/${handle}${before ? `?before=${before}` : ''}`;
      const res = await fetchText(url, { log: ctx.log, accept: 'text/html' });
      if (res.status !== 200) {
        if (first) ctx.notes.push(`Telegram @${handle}: brak publicznego podglądu (HTTP ${res.status}).`);
        break;
      }
      page = parseTelegramPage(res.body);
      if (first) {
        if (!page.isChannel) {
          if (identifier.kind === 'telegram') ctx.notes.push(`Telegram @${handle}: brak publicznego kanału z podglądem (konto prywatne, użytkownik albo nie istnieje).`);
          return [];
        }
        docs.push({
          source: 'telegram',
          url: `https://t.me/s/${handle}`,
          title: `Telegram: ${page.title || handle} (@${handle})`,
          kind: 'profile',
          author: handle,
          fetchedAt: res.fetchedAt,
          content: `Kanał Telegram @${handle}${page.title ? ` – ${page.title}` : ''}\n${page.description}`,
          verified: page.verified || undefined,
          linkedIdentifiers: [{ kind: 'telegram', value: handle }],
          query: `Telegram t.me/s/${handle}`,
          subjectMatch: match,
        });
        first = false;
      }
      for (const m of page.messages) {
        if (!CRYPTO_HINT.test(m.text)) continue;
        docs.push({
          source: 'telegram',
          url: m.url,
          title: `Telegram @${handle}: wiadomość #${m.id}`,
          kind: 'channel',
          // autor wiadomości: podpisany członek zespołu kanału albo sam kanał
          author: m.author ?? handle,
          publishedAt: m.publishedAt,
          fetchedAt: res.fetchedAt,
          content: m.text,
          verified: page.verified || undefined,
          query: `Telegram t.me/s/${handle}${before ? `?before=${before}` : ''}`,
          subjectMatch: match,
        });
      }
      if (!page.before || page.messages.length === 0) break;
      before = page.before;
    }
    return docs;
  },
};
