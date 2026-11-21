// Strony WWW (podane przez analityka lub ujawnione w profilu badanego), archiwum
// Wayback Machine (zmiany w czasie) oraz opcjonalnie lokalna metawyszukiwarka SearXNG.
import { config } from '../config.ts';
import { allowHostForRun, fetchJson, fetchText, isHostAllowed } from '../http/fetcher.ts';
import { parseHtml } from './html.ts';
import type { Source, SourceDocument } from './types.ts';

const SKIP_HOSTS = /(^|\.)(github\.com|reddit\.com|keybase\.io|x\.com|twitter\.com|facebook\.com|instagram\.com|tiktok\.com|linkedin\.com)$/i;

export const webSource: Source = {
  id: 'web',
  label: 'Strony WWW',
  description: 'Pobranie wskazanych stron (np. osobista strona, ogłoszenie) i ekstrakcja treści.',
  accepts: ['url', 'social'],
  hosts: ['(host strony wskazanej przez analityka lub profil badanego)'],
  async search(identifier, ctx) {
    let url: URL;
    try {
      url = new URL(identifier.value);
    } catch {
      return [];
    }
    if (!/^https?:$/.test(url.protocol) || SKIP_HOSTS.test(url.hostname)) return [];
    const local = url.hostname === new URL(config.sandboxUrl).hostname;
    // Strona podana wprost przez analityka = zgoda na jej host (w tym przebiegu).
    if (!local && ctx.origin === 'input' && config.allowUserUrls) allowHostForRun(url.hostname);
    // Strona ujawniona w pivocie: pobieramy tylko, gdy analityk zatwierdził host – inaczej zapisujemy do decyzji.
    if (!isHostAllowed(url.toString())) {
      ctx.skipped?.push({ url: url.toString(), host: url.hostname, foundIn: ctx.foundIn ?? '' });
      ctx.notes.push(`Nie pobrano ${url.href} – host ${url.hostname} wymaga zatwierdzenia przez analityka (niezaufany zasób).`);
      return [];
    }
    const res = await fetchText(url.toString(), { log: ctx.log, accept: 'text/html,*/*' });
    if (res.status !== 200 || !/html|text/.test(res.contentType)) return [];
    const page = parseHtml(res.body, url.toString());
    return [
      {
        source: local ? 'sandbox' : 'web',
        url: url.toString(),
        title: page.title || url.hostname,
        kind: page.kind ?? 'website',
        author: page.author,
        publishedAt: page.publishedAt,
        fetchedAt: res.fetchedAt,
        content: page.text,
        segments: page.segments.length ? page.segments : undefined,
        verified: page.verified,
        query: `Pobranie strony ${url.href}`,
        subjectMatch: 'direct',
      },
    ];
  },
};

export const waybackSource: Source = {
  id: 'wayback',
  label: 'Wayback Machine',
  description: 'Archiwalne wersje stron/profilów – wykrywanie podmiany adresów portfeli w czasie.',
  accepts: ['url', 'social'],
  hosts: ['web.archive.org'],
  async search(identifier, ctx) {
    let target: URL;
    try {
      target = new URL(identifier.value);
    } catch {
      return [];
    }
    if (['127.0.0.1', 'localhost'].includes(target.hostname)) return [];
    const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target.href)}&output=json&filter=statuscode:200&collapse=digest&limit=-6`;
    const { data } = await fetchJson<string[][]>(cdx, { log: ctx.log });
    const rows = (data ?? []).slice(1); // pierwszy wiersz = nagłówki
    const docs: SourceDocument[] = [];
    for (const row of rows.slice(-4)) {
      const ts = row[1];
      const snapUrl = `https://web.archive.org/web/${ts}id_/${target.href}`;
      try {
        const res = await fetchText(snapUrl, { log: ctx.log });
        if (res.status !== 200) continue;
        const page = parseHtml(res.body, target.href);
        const when = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;
        docs.push({
          source: 'wayback',
          url: `https://web.archive.org/web/${ts}/${target.href}`,
          title: `Archiwum ${when.slice(0, 10)}: ${page.title || target.hostname}`,
          kind: 'archive',
          author: page.author,
          publishedAt: when,
          fetchedAt: res.fetchedAt,
          content: page.text.slice(0, 200_000),
          archiveOf: target.href,
          query: `Wayback CDX ${target.href}`,
          subjectMatch: 'direct',
        });
      } catch {
        /* pomiń migawkę */
      }
    }
    return docs;
  },
};

interface SearxResult {
  url: string;
  title: string;
  content?: string;
  publishedDate?: string;
}

export const searxngSource: Source = {
  id: 'searxng',
  label: 'SearXNG (metawyszukiwarka)',
  description: 'Samodzielnie hostowana metawyszukiwarka – wyszukiwanie pełnotekstowe identyfikatorów i adresów.',
  accepts: ['nick', 'email', 'name', 'telegram', 'address', 'phone'],
  hosts: ['(SEARXNG_URL)'],
  status: () => (config.searxngUrl ? { available: true, note: 'Integracja nieprzetestowana na żywej instancji w trakcie hackathonu.' } : { available: false, note: 'Nieskonfigurowane – ustaw SEARXNG_URL (własna instancja).' }),
  async search(identifier, ctx) {
    if (!config.searxngUrl) return [];
    const base = new URL(config.searxngUrl);
    const { data, res } = await fetchJson<{ results: SearxResult[] }>(`${base.origin}/search?q=${encodeURIComponent(`"${identifier.value}"`)}&format=json`, { log: ctx.log });
    return (data?.results ?? []).slice(0, 20).map((r) => ({
      source: 'searxng',
      url: r.url,
      title: r.title,
      kind: 'search-result' as const,
      publishedAt: r.publishedDate,
      fetchedAt: res.fetchedAt,
      content: `${r.title}\n${r.content ?? ''}`,
      query: `SearXNG: "${identifier.value}"`,
      subjectMatch: 'search-candidate' as const,
    }));
  },
};
