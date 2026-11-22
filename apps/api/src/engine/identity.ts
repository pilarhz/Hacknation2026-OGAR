// Tożsamość: konta (serwis + nick) łączone w grupy wyłącznie twardymi powiązaniami – jawnym odnośnikiem,
// wspólnym kontaktem (e-mail, Telegram, telefon) albo kotwicą w danych wejściowych.
// Ten sam nick w dwóch serwisach to nie dowód; konto łączone tylko nickiem dostaje karę R9.
import { extractIdentifiers, handleFromSocial, normalizeHandle, type Identifier } from '../extract/identifiers.ts';

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

/** Token do porównań (znormalizowany) + czytelna postać do uzasadnień w raporcie. */
type Token = [token: string, label: string];

function identifierTokens(i: Identifier, siteOf: (url: string) => string): Token[] {
  const v = i.value.trim();
  switch (i.kind) {
    case 'email':
      return [[`email:${v.toLowerCase()}`, `e-mail ${v}`]];
    case 'telegram':
      return [[`telegram:${normalizeHandle(v)}`, `Telegram @${v.replace(/^@/, '')}`]];
    case 'phone':
      return [[`phone:${v.replace(/\D/g, '').slice(-9)}`, `telefon ${v}`]];
    case 'url':
      return [[`url:${normUrl(v)}`, v], [`site:${siteOf(v)}`, `strona ${siteOf(v)}`]];
    case 'social': {
      const h = handleFromSocial(v);
      return [[`url:${normUrl(v)}`, v], ...(h ? [[`handle:${normalizeHandle(h)}@${siteOf(v)}`, `konto ${h} (${siteOf(v)})`] as Token] : [])];
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
  const shown = new Map<string, string>();
  const add = (set: Set<string>, [t, label]: Token) => {
    set.add(t);
    if (!shown.has(t)) shown.set(t, label);
  };
  const show = (t: string) => shown.get(t) ?? t;
  const acc = (k: string) => (meta.has(k) ? `${meta.get(k)!.site} / ${meta.get(k)!.handle}` : k);
  const ensure = (site: string, author: string) => {
    const k = accountKey(site, author);
    if (!meta.has(k)) {
      meta.set(k, { site, handle: author, urls: new Set() });
      identity.set(k, new Set());
      add(identity.get(k)!, [`handle:${normalizeHandle(author)}@${site}`, `konto ${author} (${site})`]);
      exposed.set(k, new Set());
      if (author.includes('@')) add(identity.get(k)!, [`email:${author.toLowerCase()}`, `e-mail ${author}`]);
    }
    return k;
  };
  const expose = (k: string, text: string, linked: Identifier[] = []) => {
    for (const i of [...extractIdentifiers(text), ...linked]) for (const t of identifierTokens(i, siteOf)) add(exposed.get(k)!, t);
  };

  for (const d of docs) {
    if (d.author) {
      const k = ensure(d.site, d.author);
      meta.get(k)!.urls.add(d.url);
      add(identity.get(k)!, [`url:${normUrl(d.url)}`, d.url]);
      if (d.kind === 'website') add(identity.get(k)!, [`site:${d.site}`, `strona ${d.site}`]);
      if (d.kind === 'channel') add(identity.get(k)!, [`telegram:${normalizeHandle(d.author)}`, `Telegram @${d.author}`]);
      // Pełna treść należy do autora dokumentu tylko, gdy nie ma fragmentów innych autorów.
      const foreign = (d.segments ?? []).some((s) => s.author && normalizeHandle(s.author) !== normalizeHandle(d.author!));
      expose(k, foreign ? '' : d.content, d.linked);
    }
    for (const s of d.segments ?? []) {
      if (!s.author) continue;
      const k = ensure(d.site, s.author);
      meta.get(k)!.urls.add(d.url);
      if (s.kind === 'channel') add(identity.get(k)!, [`telegram:${normalizeHandle(s.author)}`, `Telegram @${s.author}`]);
      expose(k, s.text);
    }
  }

  const uf = new UnionFind();
  const SEED = '__SEED__';
  uf.find(SEED);
  const seedTokens = new Set<string>();
  for (const s of seeds) for (const t of identifierTokens(s, siteOf)) add(seedTokens, t);
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
          links.push({ a: k, b: other, why: `odnośnik/kontakt: ${show(t)}` });
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
        links.push({ a: ks[0], b: ks[i], why: `wspólny kontakt: ${show(t)}` });
      }
  // Kotwice z danych wejściowych.
  for (const k of keys) {
    const hit = [...identity.get(k)!, ...exposed.get(k)!].find((t) => seedTokens.has(t));
    if (hit) {
      uf.union(SEED, k);
      links.push({ a: 'dane wejściowe', b: k, why: `identyfikator wejściowy: ${show(hit)}` });
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
      links: links.filter((l) => ks.includes(l.b) || ks.includes(l.a)).map((l) => `${acc(l.a)} ↔ ${acc(l.b)}: ${l.why}`),
    });
  }
  components.sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.accounts.length - a.accounts.length);
  return { accounts, components };
}
