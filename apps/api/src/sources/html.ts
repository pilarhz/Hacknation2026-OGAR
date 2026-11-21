// Ekstrakcja treści z HTML. Obsługuje dwa poziomy:
// 1) znaczniki strukturalne (data-author, data-kind, data-published, itemprop) – używane przez
//    syntetyczną piaskownicę oraz wiele forów (schema.org / microdata),
// 2) fallback – czysty tekst strony.
import * as cheerio from 'cheerio';
import type { DocKind, Segment } from './types.ts';

export interface ParsedPage {
  title: string;
  text: string;
  author?: string;
  kind?: DocKind;
  publishedAt?: string;
  verified?: boolean;
  segments: Segment[];
  links: string[];
}

/** Spacja przed każdym znacznikiem zamykającym i po <br> – inaczej tekst sąsiednich elementów się skleja. */
const spaced = (html: string) => html.replace(/<\/[a-z][a-z0-9]*\s*>/gi, ' $&').replace(/<br\s*\/?>/gi, ' $&');

export function parseHtml(html: string, baseUrl: string): ParsedPage {
  const $ = cheerio.load(spaced(html));
  $('script, style, noscript, svg').remove();
  const title = $('title').first().text().trim() || $('h1').first().text().trim();
  const root = $('[data-doc]').first();
  const author =
    root.attr('data-author') ||
    $('meta[name="author"]').attr('content') ||
    $('[itemprop="author"]').first().text().trim() ||
    undefined;
  const kind = (root.attr('data-kind') as DocKind | undefined) || undefined;
  const publishedAt = root.attr('data-published') || $('meta[property="article:published_time"]').attr('content') || undefined;
  const verified = root.attr('data-verified') === 'true' || undefined;

  const segments: Segment[] = [];
  $('[data-segment]').each((_, el) => {
    const e = $(el);
    segments.push({
      author: e.attr('data-author') || undefined,
      kind: (e.attr('data-kind') as DocKind | undefined) || undefined,
      publishedAt: e.attr('data-published') || undefined,
      hint: e.attr('data-hint') || undefined,
      text: e.text().replace(/\s+/g, ' ').trim(),
    });
  });

  const links: string[] = [];
  $('a[href]').each((_, el) => {
    try {
      links.push(new URL($(el).attr('href') as string, baseUrl).toString());
    } catch {
      /* ignoruj błędne linki */
    }
  });

  const text = $('body').text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return { title, text, author, kind, publishedAt, verified, segments, links };
}

export function stripHtml(html: string): string {
  return cheerio.load(spaced(html)).text().replace(/\s+/g, ' ').trim();
}
