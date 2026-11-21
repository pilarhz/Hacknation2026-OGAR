// Model tożsamości: konta (serwis + nick autora) łączone w grupy na podstawie twardych powiązań.
//
// Problem: ten sam nick w dwóch serwisach NIE oznacza tej samej osoby. Dlatego konto uznajemy za
// potwierdzone konto badanego tylko wtedy, gdy jest połączone z innymi kontami badanego:
//  - jawnym odnośnikiem (profil linkuje stronę WWW, kanał t.me, inny profil; dowód Keybase),
//  - wspólnym unikalnym kontaktem (ten sam e-mail, Telegram, telefon),
//  - albo jest zakotwiczone w danych wejściowych (podany e-mail/URL profilu, autor publikacji adresu wejściowego).
// Konto powiązane z badanym WYŁĄCZNIE zgodnością nicku dostaje karę R9 w Wskaźniku Pewności.
import { extractIdentifiers, normalizeHandle, type Identifier } from '../extract/identifiers.ts';

export interface AccountSource {
  site: string;
  url: string;
  kind: string;
  author?: string;
  owned: boolean;
  content: string;
  segments?: { author?: string; text: string; kind?: string }[];
  linked: Identifier[];
}

export interface AccountInfo {
  key: string;
  site: string;
  handle: string;
  urls: string[];
  component: number;
  confirmed: boolean;
}

export interface IdentityComponent {
  id: number;
  accounts: { site: string; handle: string }[];
  confirmed: boolean;
  reason: string;
  links: string[];
}

export interface IdentityResult {
  accounts: Map<string, AccountInfo>;
  components: IdentityComponent[];
}

export const accountKey = (site: string, author: string) => `${site}|${normalizeHandle(author)}`;

function normUrl(u: string): string {
  try {
    const x = new URL(u);
    return (x.host.replace(/^www\./, '') + x.pathname).replace(/\/+$/, '').toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

const SOCIAL_HANDLE = /(?:github\.com|x\.com|twitter\.com|reddit\.com\/(?:u|user)|instagram\.com|tiktok\.com\/@|keybase\.io)\/@?([A-Za-z0-9_.-]{2,40})/i;

export function identifierTokens(i: Identifier, siteOf: (url: string) => string): string[] {
  const v = i.value.trim();
  switch (i.kind) {
    case 'email':
      return [`email:${v.toLowerCase()}`];
    case 'telegram':
      return [`telegram:${normalizeHandle(v)}`];
    case 'phone':
      return [`phone:${v.replace(/\D/g, '').slice(-9)}`];
    case 'url':
      return [`url:${normUrl(v)}`, `site:${siteOf(v)}`];
    case 'social': {
      const h = v.match(SOCIAL_HANDLE)?.[1];
      return [`url:${normUrl(v)}`, ...(h ? [`handle:${normalizeHandle(h)}@${siteOf(v)}`] : [])];
    }
    default:
      return [];
  }
}

/** Tokeny "kontaktowe" – współdzielenie ich przez dwa konta łączy je nawet bez odnośnika. */
const SHARED_CONTACT = /^(email|telegram|phone):/;

class UnionFind {
  parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    this.parent.set(this.find(a), this.find(b));
  }
}

export function buildIdentity(
  docs: AccountSource[],
  seeds: Identifier[],
  addressPublishers: Set<string>,
  siteOf: (url: string) => string,
): IdentityResult {
  const identity = new Map<string, Set<string>>();
  const exposed = new Map<string, Set<string>>();
  const meta = new Map<string, { site: string; handle: string; urls: Set<string> }>();
  const ensure = (site: string, author: string) => {
    const k = accountKey(site, author);
    if (!meta.has(k)) {
      meta.set(k, { site, handle: author, urls: new Set() });
      identity.set(k, new Set([`handle:${normalizeHandle(author)}@${site}`]));
      exposed.set(k, new Set());
      if (author.includes('@')) identity.get(k)!.add(`email:${author.toLowerCase()}`);
    }
    return k;
  };
  const expose = (k: string, text: string, linked: Identifier[] = []) => {
    for (const i of [...extractIdentifiers(text), ...linked]) for (const t of identifierTokens(i, siteOf)) exposed.get(k)!.add(t);
  };

  for (const d of docs) {
    if (d.author) {
      const k = ensure(d.site, d.author);
      meta.get(k)!.urls.add(d.url);
      identity.get(k)!.add(`url:${normUrl(d.url)}`);
      if (d.kind === 'website') identity.get(k)!.add(`site:${d.site}`);
      if (d.kind === 'channel') identity.get(k)!.add(`telegram:${normalizeHandle(d.author)}`);
      // Pełna treść należy do autora dokumentu tylko, gdy nie ma fragmentów innych autorów.
      const foreign = (d.segments ?? []).some((s) => s.author && normalizeHandle(s.author) !== normalizeHandle(d.author!));
      expose(k, foreign ? '' : d.content, d.linked);
    }
    for (const s of d.segments ?? []) {
      if (!s.author) continue;
      const k = ensure(d.site, s.author);
      meta.get(k)!.urls.add(d.url);
      if (s.kind === 'channel') identity.get(k)!.add(`telegram:${normalizeHandle(s.author)}`);
      expose(k, s.text);
    }
  }

  const uf = new UnionFind();
  const SEED = '__SEED__';
  uf.find(SEED);
  const seedTokens = new Set(seeds.flatMap((s) => identifierTokens(s, siteOf)));
  const links: { a: string; b: string; why: string }[] = [];
  const keys = [...meta.keys()];
  for (const k of keys) uf.find(k);

  // Indeks tokenów tożsamości.
  const byIdentity = new Map<string, string[]>();
  for (const [k, toks] of identity) for (const t of toks) (byIdentity.get(t) ?? byIdentity.set(t, []).get(t)!).push(k);

  for (const k of keys) {
    for (const t of exposed.get(k)!) {
      for (const other of byIdentity.get(t) ?? []) {
        if (other !== k && uf.find(other) !== uf.find(k)) {
          uf.union(k, other);
          links.push({ a: k, b: other, why: `odnośnik/kontakt ${t}` });
        }
      }
    }
  }
  // Wspólny kontakt (np. ten sam e-mail w stopce i w profilu).
  const byContact = new Map<string, string[]>();
  for (const [k, toks] of exposed) for (const t of toks) if (SHARED_CONTACT.test(t)) (byContact.get(t) ?? byContact.set(t, []).get(t)!).push(k);
  for (const [t, ks] of byContact)
    for (let i = 1; i < ks.length; i++)
      if (uf.find(ks[0]) !== uf.find(ks[i])) {
        uf.union(ks[0], ks[i]);
        links.push({ a: ks[0], b: ks[i], why: `wspólny kontakt ${t}` });
      }
  // Kotwice z danych wejściowych.
  for (const k of keys) {
    const hit = [...identity.get(k)!, ...exposed.get(k)!].find((t) => seedTokens.has(t));
    if (hit) {
      uf.union(SEED, k);
      links.push({ a: 'dane wejściowe', b: k, why: `identyfikator wejściowy ${hit}` });
    }
  }
  for (const k of addressPublishers) {
    if (!meta.has(k)) continue;
    uf.union(SEED, k);
    links.push({ a: 'dane wejściowe', b: k, why: 'autor publikacji adresu wejściowego' });
  }

  // Grupy kont.
  const groups = new Map<string, string[]>();
  for (const k of keys) (groups.get(uf.find(k)) ?? groups.set(uf.find(k), []).get(uf.find(k))!).push(k);
  const seedRoot = uf.find(SEED);
  const nickSeeds = new Set(seeds.filter((s) => s.kind === 'nick').map((s) => normalizeHandle(s.value)));
  const confirmedRoots = new Map<string, string>();
  if (groups.has(seedRoot)) confirmedRoots.set(seedRoot, 'Zakotwiczona w danych wejściowych (e-mail, URL profilu lub publikacja adresu wejściowego)');
  // Dla nicka bez platformy: największa grupa ≥2 kont zawierająca ten nick.
  const nickGroups = [...groups.entries()].filter(([, ks]) => ks.length >= 2 && ks.some((k) => nickSeeds.has(normalizeHandle(meta.get(k)!.handle))));
  nickGroups.sort((a, b) => b[1].length - a[1].length);
  if (nickGroups[0] && !confirmedRoots.has(nickGroups[0][0]))
    confirmedRoots.set(nickGroups[0][0], `Największa grupa kont (${nickGroups[0][1].length}) zawierająca nick wejściowy, połączonych jawnymi odnośnikami lub wspólnym kontaktem`);

  const accounts = new Map<string, AccountInfo>();
  const components: IdentityComponent[] = [];
  let id = 0;
  for (const [root, ks] of groups) {
    id++;
    const confirmed = confirmedRoots.has(root);
    for (const k of ks) {
      const m = meta.get(k)!;
      accounts.set(k, { key: k, site: m.site, handle: m.handle, urls: [...m.urls], component: id, confirmed });
    }
    components.push({
      id,
      accounts: ks.map((k) => ({ site: meta.get(k)!.site, handle: meta.get(k)!.handle })),
      confirmed,
      reason: confirmedRoots.get(root) ?? (ks.length > 1 ? 'Grupa kont niepołączona z danymi wejściowymi ani z główną grupą' : 'Pojedyncze konto bez powiązań z innymi kontami badanego'),
      links: links.filter((l) => ks.includes(l.b) || ks.includes(l.a)).map((l) => `${l.a.replace('|', ' / ')} ↔ ${l.b.replace('|', ' / ')}: ${l.why}`),
    });
  }
  components.sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.accounts.length - a.accounts.length);
  return { accounts, components };
}
