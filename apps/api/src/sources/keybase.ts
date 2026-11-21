// Keybase: publiczne profile z kryptograficznymi dowodami tożsamości (GitHub, Reddit, X, HN, strony WWW)
// oraz polem "cryptocurrency_addresses" – adres podpisany kluczem właściciela konta.
import { fetchJson } from '../http/fetcher.ts';
import type { Identifier } from '../extract/identifiers.ts';
import type { Source, SourceDocument } from './types.ts';

interface KbProof {
  proof_type: string;
  nametag: string;
  service_url: string;
  state: number;
}
interface KbUser {
  basics?: { username: string; ctime?: number };
  profile?: { full_name?: string; bio?: string; location?: string };
  proofs_summary?: { all: KbProof[] };
  cryptocurrency_addresses?: Record<string, { address: string }[]>;
}

export const keybaseSource: Source = {
  id: 'keybase',
  label: 'Keybase',
  description: 'Zweryfikowane powiązania kont (dowody kryptograficzne) i podpisane adresy kryptowalut.',
  accepts: ['nick', 'social'],
  hosts: ['keybase.io'],
  async search(identifier, ctx) {
    const queries: string[] = [];
    if (identifier.kind === 'nick') {
      const nick = encodeURIComponent(identifier.value.replace(/^@/, ''));
      queries.push(`usernames=${nick}`, `github=${nick}`, `reddit=${nick}`, `hackernews=${nick}`);
    } else {
      const m = identifier.value.match(/(github\.com|reddit\.com\/u(?:ser)?|x\.com|twitter\.com)\/([A-Za-z0-9_-]+)/i);
      if (!m) return [];
      const svc = m[1].startsWith('github') ? 'github' : m[1].startsWith('reddit') ? 'reddit' : 'twitter';
      queries.push(`${svc}=${encodeURIComponent(m[2])}`);
    }
    const seen = new Set<string>();
    const docs: SourceDocument[] = [];
    for (const q of queries) {
      const { data, res } = await fetchJson<{ them?: (KbUser | null)[] }>(
        `https://keybase.io/_/api/1.0/user/lookup.json?${q}&fields=basics,profile,proofs_summary,cryptocurrency_addresses`,
        { log: ctx.log },
      );
      for (const u of data?.them ?? []) {
        const username = u?.basics?.username;
        if (!u || !username || seen.has(username)) continue;
        seen.add(username);
        const proofs = (u.proofs_summary?.all ?? []).filter((p) => p.state === 1);
        const linked: Identifier[] = proofs.map((p) => (p.proof_type === 'generic_web_site' || p.proof_type === 'dns' ? { kind: 'url', value: p.service_url } : { kind: 'social', value: p.service_url }));
        const structured = Object.entries(u.cryptocurrency_addresses ?? {}).flatMap(([coin, list]) => list.map((a) => ({ address: a.address, label: coin })));
        docs.push({
          source: 'keybase',
          url: `https://keybase.io/${username}`,
          title: `Keybase: ${username}`,
          kind: 'profile',
          author: username,
          verified: proofs.length > 0,
          fetchedAt: res.fetchedAt,
          publishedAt: u.basics?.ctime ? new Date(u.basics.ctime * 1000).toISOString() : undefined,
          content: [
            `Użytkownik: ${username}`,
            u.profile?.full_name && `Imię i nazwisko: ${u.profile.full_name}`,
            u.profile?.bio && `Bio: ${u.profile.bio}`,
            ...proofs.map((p) => `Dowód ${p.proof_type}: ${p.nametag} (${p.service_url})`),
            ...structured.map((s) => `Adres ${s.label} (podpisany): ${s.address}`),
          ]
            .filter(Boolean)
            .join('\n'),
          linkedIdentifiers: linked,
          structuredAddresses: structured,
          query: `Keybase lookup ${q}`,
          subjectMatch: 'direct',
        });
      }
    }
    return docs;
  },
};
