// Gravatar: publiczny profil powiązany z adresem e-mail (hash). Profil może zawierać
// sekcję portfeli kryptowalutowych i zweryfikowane konta społecznościowe.
import { createHash } from 'node:crypto';
import { fetchJson } from '../http/fetcher.ts';
import type { Identifier } from '../extract/identifiers.ts';
import type { Source } from './types.ts';

interface GravatarV3 {
  display_name?: string;
  profile_url?: string;
  description?: string;
  location?: string;
  verified_accounts?: { service_label: string; url: string }[];
  payments?: { crypto_wallets?: { label: string; address: string }[]; links?: { label: string; url: string }[] };
}
interface GravatarLegacy {
  entry?: { displayName?: string; profileUrl?: string; aboutMe?: string; currency?: { type: string; value: string }[]; accounts?: { url: string }[] }[];
}

export const gravatarSource: Source = {
  id: 'gravatar',
  label: 'Gravatar',
  description: 'Profil publiczny przypisany do e-maila (hash) – portfele krypto, konta społecznościowe.',
  accepts: ['email'],
  hosts: ['api.gravatar.com', 'en.gravatar.com'],
  async search(identifier, ctx) {
    const email = identifier.value.trim().toLowerCase();
    const sha = createHash('sha256').update(email).digest('hex');
    const md5 = createHash('md5').update(email).digest('hex');
    const v3 = await fetchJson<GravatarV3>(`https://api.gravatar.com/v3/profiles/${sha}`, { log: ctx.log }).catch(() => null);
    let name: string | undefined;
    let url = `https://gravatar.com/${md5}`;
    let about = '';
    const wallets: { address: string; label?: string }[] = [];
    const linked: Identifier[] = [];
    let fetchedAt = new Date().toISOString();
    if (v3?.data) {
      const d = v3.data;
      fetchedAt = v3.res.fetchedAt;
      name = d.display_name;
      url = d.profile_url ?? url;
      about = [d.description, d.location].filter(Boolean).join('\n');
      for (const w of d.payments?.crypto_wallets ?? []) wallets.push({ address: w.address, label: w.label });
      for (const a of d.verified_accounts ?? []) linked.push({ kind: 'social', value: a.url });
    } else {
      const legacy = await fetchJson<GravatarLegacy>(`https://en.gravatar.com/${md5}.json`, { log: ctx.log }).catch(() => null);
      const e = legacy?.data?.entry?.[0];
      if (!e) return [];
      fetchedAt = legacy!.res.fetchedAt;
      name = e.displayName;
      url = e.profileUrl ?? url;
      about = e.aboutMe ?? '';
      for (const c of e.currency ?? []) wallets.push({ address: c.value, label: c.type });
      for (const a of e.accounts ?? []) linked.push({ kind: 'social', value: a.url });
    }
    if (name) linked.push({ kind: 'name', value: name });
    return [
      {
        source: 'gravatar',
        url,
        title: `Gravatar: ${name ?? email}`,
        kind: 'profile',
        author: email,
        fetchedAt,
        content: [`E-mail (hash): ${sha}`, name && `Nazwa: ${name}`, about, ...wallets.map((w) => `Portfel ${w.label ?? ''}: ${w.address}`)].filter(Boolean).join('\n'),
        structuredAddresses: wallets,
        linkedIdentifiers: linked,
        query: `Gravatar profil dla sha256(e-mail)`,
        subjectMatch: 'direct',
      },
    ];
  },
};
