// Reddit i Hacker News – publiczne wypowiedzi użytkowników + wyszukiwanie odwrotne po adresie.
import { fetchJson } from '../http/fetcher.ts';
import { stripHtml } from './html.ts';
import type { Source, SourceDocument } from './types.ts';

/** Luźny filtr – pobieramy tylko wypowiedzi, w których może być adres krypto. */
const CRYPTO_HINT = /0x[0-9a-fA-F]{40}|\b(?:bc1|ltc1)[0-9a-z]{20,}|\b[13LMDT][1-9A-HJ-NP-Za-km-z]{25,34}\b|btc|eth|usdt|wallet|portfel/i;

interface RedditListing {
  data?: { children: { kind: string; data: Record<string, unknown> }[] };
}

const iso = (sec: unknown) => (typeof sec === 'number' ? new Date(sec * 1000).toISOString() : undefined);

export const redditSource: Source = {
  id: 'reddit',
  label: 'Reddit',
  description: 'Profil, komentarze i posty użytkownika; wyszukiwanie postów zawierających adres.',
  accepts: ['nick', 'address'],
  hosts: ['www.reddit.com'],
  status: () => ({ available: true, note: 'Reddit wymaga OAuth dla klientów automatycznych – publiczne JSON zwraca obecnie HTTP 403 (źródło poza domyślnym zestawem).' }),
  async search(identifier, ctx) {
    const docs: SourceDocument[] = [];
    const toDoc = (d: Record<string, unknown>, fetchedAt: string, query: string, match: SourceDocument['subjectMatch']): SourceDocument => {
      const body = String(d.body ?? `${d.title ?? ''}\n${d.selftext ?? ''}`);
      return {
        source: 'reddit',
        url: `https://www.reddit.com${String(d.permalink ?? '')}`,
        title: `r/${String(d.subreddit ?? '?')}: ${String(d.link_title ?? d.title ?? 'komentarz').slice(0, 90)}`,
        kind: d.body ? 'comment' : 'post',
        author: String(d.author ?? ''),
        publishedAt: iso(d.created_utc),
        fetchedAt,
        content: body,
        query,
        subjectMatch: match,
      };
    };
    if (identifier.kind === 'address') {
      const q = `https://www.reddit.com/search.json?q=${encodeURIComponent(identifier.value)}&limit=25`;
      const { data, res } = await fetchJson<RedditListing>(q, { log: ctx.log });
      if (res.status === 403 || res.status === 429) ctx.notes.push(`Reddit odrzucił wyszukiwanie (HTTP ${res.status}) – serwis wymaga OAuth dla klientów automatycznych; wynik niekompletny.`);
      for (const c of data?.data?.children ?? []) docs.push(toDoc(c.data, res.fetchedAt, `Reddit search: ${identifier.value}`, 'search-candidate'));
      return docs;
    }
    const nick = encodeURIComponent(identifier.value.replace(/^(u\/|@)/, ''));
    const about = await fetchJson<{ data?: Record<string, unknown> }>(`https://www.reddit.com/user/${nick}/about.json`, { log: ctx.log });
    if (about.res.status === 403 || about.res.status === 429) ctx.notes.push(`Reddit odrzucił zapytanie (HTTP ${about.res.status}) – limit lub blokada klientów bez OAuth.`);
    const sub = about.data?.data?.subreddit as Record<string, unknown> | undefined;
    if (about.data?.data) {
      docs.push({
        source: 'reddit',
        url: `https://www.reddit.com/user/${nick}`,
        title: `Reddit: u/${decodeURIComponent(nick)}`,
        kind: 'profile',
        author: decodeURIComponent(nick),
        publishedAt: iso(about.data.data.created_utc),
        fetchedAt: about.res.fetchedAt,
        content: `Profil u/${decodeURIComponent(nick)}\n${String(sub?.public_description ?? '')}`,
        query: `Reddit /user/${nick}/about`,
        subjectMatch: 'direct',
      });
    } else return docs;
    for (const kind of ['comments', 'submitted']) {
      const { data, res } = await fetchJson<RedditListing>(`https://www.reddit.com/user/${nick}/${kind}.json?limit=100`, { log: ctx.log });
      for (const c of data?.data?.children ?? []) {
        const doc = toDoc(c.data, res.fetchedAt, `Reddit /user/${nick}/${kind}`, 'direct');
        if (CRYPTO_HINT.test(doc.content)) docs.push(doc);
      }
    }
    return docs;
  },
};

interface HnHit {
  objectID: string;
  author: string;
  comment_text?: string;
  story_text?: string;
  title?: string;
  created_at: string;
  story_title?: string;
}

export const hackerNewsSource: Source = {
  id: 'hackernews',
  label: 'Hacker News',
  description: 'Profil "about" i komentarze (API Algolia); wyszukiwanie pełnotekstowe po adresie.',
  accepts: ['nick', 'address'],
  hosts: ['hn.algolia.com'],
  async search(identifier, ctx) {
    const docs: SourceDocument[] = [];
    const base = 'https://hn.algolia.com/api/v1';
    const hitDoc = (h: HnHit, fetchedAt: string, query: string, match: SourceDocument['subjectMatch']): SourceDocument => ({
      source: 'hackernews',
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      title: `HN: ${(h.story_title ?? h.title ?? 'komentarz').slice(0, 90)}`,
      kind: h.comment_text ? 'comment' : 'post',
      author: h.author,
      publishedAt: h.created_at,
      fetchedAt,
      content: stripHtml(h.comment_text ?? h.story_text ?? h.title ?? ''),
      query,
      subjectMatch: match,
    });
    if (identifier.kind === 'address') {
      const { data, res } = await fetchJson<{ hits: HnHit[] }>(`${base}/search?query=${encodeURIComponent(identifier.value)}&hitsPerPage=30`, { log: ctx.log });
      for (const h of data?.hits ?? []) docs.push(hitDoc(h, res.fetchedAt, `HN Algolia search: ${identifier.value}`, 'search-candidate'));
      return docs;
    }
    const nick = encodeURIComponent(identifier.value.replace(/^@/, ''));
    const user = await fetchJson<{ username?: string; about?: string; created_at?: string }>(`${base}/users/${nick}`, { log: ctx.log });
    if (!user.data?.username) return docs;
    docs.push({
      source: 'hackernews',
      url: `https://news.ycombinator.com/user?id=${nick}`,
      title: `HN: ${user.data.username}`,
      kind: 'profile',
      author: user.data.username,
      publishedAt: user.data.created_at,
      fetchedAt: user.res.fetchedAt,
      content: stripHtml(user.data.about ?? ''),
      query: `HN Algolia /users/${nick}`,
      subjectMatch: 'direct',
    });
    const { data, res } = await fetchJson<{ hits: HnHit[] }>(`${base}/search_by_date?tags=comment,author_${nick}&hitsPerPage=200`, { log: ctx.log });
    for (const h of data?.hits ?? []) {
      const d = hitDoc(h, res.fetchedAt, `HN komentarze author_${nick}`, 'direct');
      if (CRYPTO_HINT.test(d.content)) docs.push(d);
    }
    return docs;
  },
};
