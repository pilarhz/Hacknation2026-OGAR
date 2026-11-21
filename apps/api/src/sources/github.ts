// GitHub: publiczny profil (bio, blog, e-mail, X/Twitter), README profilu i gisty.
// Dokumentacja: https://docs.github.com/rest (limit bez tokenu: 60 zapytań/h).
import { config } from '../config.ts';
import { fetchJson, fetchText } from '../http/fetcher.ts';
import type { Identifier } from '../extract/identifiers.ts';
import type { Source, SourceContext, SourceDocument } from './types.ts';

interface GhUser {
  login: string;
  name: string | null;
  bio: string | null;
  blog: string | null;
  email: string | null;
  twitter_username: string | null;
  company: string | null;
  location: string | null;
  html_url: string;
  created_at: string;
}
interface GhGist {
  html_url: string;
  description: string | null;
  created_at: string;
  files: Record<string, { raw_url: string; size: number }>;
}

const API = 'https://api.github.com';
const headers = () => ({
  'X-GitHub-Api-Version': '2022-11-28',
  ...(config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {}),
});

async function profileDocs(login: string, ctx: SourceContext, via: string, match: SourceDocument['subjectMatch']): Promise<SourceDocument[]> {
  const docs: SourceDocument[] = [];
  const { data: u, res } = await fetchJson<GhUser>(`${API}/users/${encodeURIComponent(login)}`, { log: ctx.log, headers: headers() });
  if (!u) {
    if (res.status === 403) ctx.notes.push('GitHub: wyczerpany limit zapytań (ustaw GITHUB_TOKEN).');
    return docs;
  }
  const linked: Identifier[] = [];
  if (u.blog) linked.push({ kind: 'url', value: /^https?:/.test(u.blog) ? u.blog : `https://${u.blog}` });
  if (u.email) linked.push({ kind: 'email', value: u.email.toLowerCase() });
  if (u.twitter_username) linked.push({ kind: 'social', value: `https://x.com/${u.twitter_username}` });
  if (u.name) linked.push({ kind: 'name', value: u.name });
  docs.push({
    source: 'github',
    url: u.html_url,
    title: `GitHub: ${u.login}${u.name ? ` (${u.name})` : ''}`,
    kind: 'profile',
    author: u.login,
    publishedAt: u.created_at,
    fetchedAt: res.fetchedAt,
    content: [`Login: ${u.login}`, u.name && `Nazwa: ${u.name}`, u.bio && `Bio: ${u.bio}`, u.blog && `Blog: ${u.blog}`, u.email && `E-mail: ${u.email}`, u.twitter_username && `X/Twitter: @${u.twitter_username}`, u.company && `Firma: ${u.company}`, u.location && `Lokalizacja: ${u.location}`]
      .filter(Boolean)
      .join('\n'),
    linkedIdentifiers: linked,
    query: via,
    subjectMatch: match,
  });

  // README profilu (repozytorium login/login) – treść publikowana przez właściciela konta.
  try {
    const readme = await fetchText(`https://raw.githubusercontent.com/${u.login}/${u.login}/HEAD/README.md`, { log: ctx.log });
    if (readme.status === 200 && readme.body.trim()) {
      docs.push({ source: 'github', url: `https://github.com/${u.login}/${u.login}`, title: `README profilu ${u.login}`, kind: 'profile', author: u.login, fetchedAt: readme.fetchedAt, content: readme.body.slice(0, 50_000), query: via, subjectMatch: match });
    }
  } catch {
    /* brak README */
  }

  // Gisty – często zawierają "tip jar" / adresy do darowizn.
  try {
    const { data: gists } = await fetchJson<GhGist[]>(`${API}/users/${u.login}/gists?per_page=20`, { log: ctx.log, headers: headers() });
    for (const g of (gists ?? []).slice(0, 8)) {
      const parts = [g.description ?? ''];
      for (const f of Object.values(g.files).slice(0, 2)) {
        if (f.size > 200_000) continue;
        try {
          const raw = await fetchText(f.raw_url, { log: ctx.log });
          if (raw.status === 200) parts.push(raw.body.slice(0, 20_000));
        } catch {
          /* pomiń plik */
        }
      }
      docs.push({ source: 'github', url: g.html_url, title: `Gist: ${g.description || g.html_url}`, kind: 'post', author: u.login, publishedAt: g.created_at, fetchedAt: new Date().toISOString(), content: parts.join('\n'), query: via, subjectMatch: match });
    }
  } catch {
    /* brak gistów */
  }
  return docs;
}

export const githubSource: Source = {
  id: 'github',
  label: 'GitHub',
  description: 'Profil, README profilu, gisty; wyszukiwanie kont po e-mailu i nazwie.',
  accepts: ['nick', 'email', 'name', 'social'],
  hosts: ['api.github.com', 'raw.githubusercontent.com', 'gist.githubusercontent.com'],
  async search(identifier, ctx) {
    if (identifier.kind === 'nick') return profileDocs(identifier.value.replace(/^@/, ''), ctx, `GitHub /users/${identifier.value}`, 'direct');
    if (identifier.kind === 'social') {
      const m = identifier.value.match(/github\.com\/([A-Za-z0-9-]{1,39})(?:[/?#]|$)/i);
      return m ? profileDocs(m[1], ctx, `GitHub profil z linku ${identifier.value}`, 'direct') : [];
    }
    // Wyszukiwanie kont: e-mail (tylko publiczne e-maile) lub nazwa (kandydaci – możliwe homonimy).
    const q = identifier.kind === 'email' ? `${identifier.value} in:email` : `"${identifier.value}" in:name`;
    const { data } = await fetchJson<{ items: { login: string }[] }>(`${API}/search/users?q=${encodeURIComponent(q)}&per_page=3`, { log: ctx.log, headers: headers() });
    const docs: SourceDocument[] = [];
    const match = identifier.kind === 'email' ? 'direct' : 'search-candidate';
    for (const item of data?.items ?? []) docs.push(...(await profileDocs(item.login, ctx, `GitHub search/users: ${q}`, match)));
    return docs;
  },
};
