// Źródło syntetyczne: lokalny "internet" z fikcyjnymi forami, ogłoszeniami P2P, profilami
// i kanałami komunikatorów (apps/sandbox). Służy do odtwarzalnych scenariuszy testowych
// wymaganych w zadaniu – bez przetwarzania danych prawdziwych osób.
import { config } from '../config.ts';
import { fetchJson, fetchText } from '../http/fetcher.ts';
import { parseHtml } from './html.ts';
import type { Source, SourceDocument } from './types.ts';

interface SearchHit {
  url: string;
  title: string;
}

export const sandboxSource: Source = {
  id: 'sandbox',
  label: 'Piaskownica (dane syntetyczne)',
  description: 'Lokalna wyszukiwarka i strony z fikcyjnymi danymi do scenariuszy testowych.',
  accepts: ['nick', 'email', 'telegram', 'name', 'phone', 'address', 'url', 'social', 'messenger'],
  hosts: [config.sandboxUrl],
  synthetic: true,
  async search(identifier, ctx) {
    const base = config.sandboxUrl.replace(/\/$/, '');
    let hits: SearchHit[] = [];
    try {
      const { data } = await fetchJson<{ results: SearchHit[] }>(`${base}/api/search?q=${encodeURIComponent(identifier.value)}`, {
        log: ctx.log,
        useCache: false,
      });
      hits = data?.results ?? [];
    } catch {
      ctx.notes.push('Piaskownica niedostępna – uruchom `npm run sandbox`.');
      return [];
    }
    const docs: SourceDocument[] = [];
    for (const hit of hits.slice(0, 25)) {
      const url = new URL(hit.url, base).toString();
      const res = await fetchText(url, { log: ctx.log, useCache: false });
      if (res.status !== 200) continue;
      const page = parseHtml(res.body, url);
      docs.push({
        source: 'sandbox',
        url,
        title: page.title || hit.title,
        kind: page.kind ?? 'website',
        author: page.author,
        publishedAt: page.publishedAt,
        verified: page.verified,
        fetchedAt: res.fetchedAt,
        content: page.text,
        segments: page.segments.length ? page.segments : undefined,
        query: `"${identifier.value}" w wyszukiwarce piaskownicy`,
        subjectMatch: 'search-candidate',
      });
    }
    return docs;
  },
};
