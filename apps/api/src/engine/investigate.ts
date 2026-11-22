// Silnik analizy: BFS po źródłach Web2 z pivotem → ekstrakcja adresów → przypisanie autorstwa →
// dane on-chain i wskaźniki → Wskaźnik Pewności, graf, chronologia i wnioski do weryfikacji.
import { config } from '../config.ts';
import { sha256Hex } from '../extract/encoding.ts';
import { addressKey, extractAddresses, type AddressMatch, type Chain } from '../extract/addresses.ts';
import { extractIdentifiers, handleFromSocial, handleMatch, IDENTIFIER_LABELS, type Identifier, type IdentifierKind } from '../extract/identifiers.ts';
import { withRunScope, type RequestLogEntry } from '../http/fetcher.ts';
import { accountKey, buildIdentity, type IdentityComponent } from './identity.ts';
import { getSources } from '../sources/registry.ts';
import type { Segment, SourceDocument } from '../sources/types.ts';
import { classifyContext, CONTEXT_INFO } from '../scoring/context.ts';
import { isAttributed, scoreAddress, type Evidence, type ScoreResult } from '../scoring/confidence.ts';
import { lookupLabel } from '../chain/labels.ts';
import { getChainSummary } from '../chain/providers.ts';
import { computeIndicators } from '../chain/indicators.ts';
import { CATEGORY_LABELS, EXCLUDED_CATEGORIES, type AddressLabel, type ChainSummary, type Indicator } from '../chain/types.ts';
import { getAiProvider } from '../ai/provider.ts';

export const ENGINE_VERSION = '0.1.0';

export interface InvestigationOptions {
  sources: string[];
  maxDepth: number;
  maxDocuments: number;
  chainLookup: boolean;
  maxChainLookups: number;
  useAi: boolean;
  stableThreshold: number;
  /** Hosty zatwierdzone przez analityka dla URL-i ujawnionych w trakcie pivotu. */
  approvedHosts: string[];
}

export const DEFAULT_OPTIONS: InvestigationOptions = {
  sources: config.defaultSources,
  maxDepth: 2,
  maxDocuments: 120,
  chainLookup: true,
  maxChainLookups: 25,
  useAi: false,
  stableThreshold: 1000,
  approvedHosts: [],
};

export interface SubjectIdentifier extends Identifier {
  depth: number;
  origin: 'input' | 'pivot';
  via?: { docId: string; url: string; rule: string };
  /** Identyfikator wywnioskowany wyłącznie z publikacji adresu wejściowego (kara R10). */
  weak?: boolean;
}

/** Wypowiedź ostrzegająca przed adresem (cytat oszustwa) – jej autor nie jest właścicielem adresu. */
const WARNING_CONTEXT = /\b(scam\w*|oszust\w*|oszuk\w*|uwaga na|nie wysyłaj\w*|nie wpłacaj\w*|phishing\w*|fałszyw\w*|podróbk\w*|fraud\w*|ostrzega\w*|ostrzeżeni\w*|zgłoś\w*|report(ed)?|kradzie\w*|ukradzion\w*)\b/i;

export interface DocRecord {
  id: string;
  source: string;
  url: string;
  site: string;
  title: string;
  kind: SourceDocument['kind'];
  author?: string;
  publishedAt?: string;
  fetchedAt: string;
  sha256: string;
  query?: string;
  subjectMatch?: SourceDocument['subjectMatch'];
  verified: boolean;
  archiveOf?: string;
  depth: number;
  viaIdentifier: string;
  ownedBySubject: boolean;
  ownershipRule: string;
  addressCount: number;
  synthetic: boolean;
}

export interface AddressResult {
  key: string;
  chain: Chain;
  address: string;
  format: string;
  checksum: AddressMatch['checksum'];
  formatNotes: string[];
  evidence: Evidence[];
  label: AddressLabel | null;
  onchain: ChainSummary | null;
  indicators: Indicator[];
  score: ScoreResult;
  aiSuggestions: { docId: string; category: string; reason: string }[];
}

export interface TimelineEvent {
  time: string | null;
  address: string;
  chain: Chain;
  hash: string;
  direction: 'in' | 'out' | 'self';
  asset: string;
  amount: number;
  counterparty: string | null;
  counterpartyLabel: string | null;
  counterpartyCategory: string | null;
  cashOut: boolean;
  synthetic: boolean;
}

export interface Conclusion {
  level: 'high' | 'medium' | 'low';
  text: string;
  basis: string[];
  verify: string;
}

export interface GraphNode {
  id: string;
  type: 'identifier' | 'document' | 'address' | 'service';
  label: string;
  meta?: Record<string, unknown>;
}
export interface GraphEdge {
  source: string;
  target: string;
  type: 'found' | 'pivot' | 'mentions' | 'mentions-other' | 'onchain' | 'service';
  label?: string;
}

export interface RunResult {
  engineVersion: string;
  startedAt: string;
  finishedAt: string;
  options: InvestigationOptions;
  seeds: Identifier[];
  identifiers: SubjectIdentifier[];
  documents: DocRecord[];
  addresses: AddressResult[];
  rejected: { candidate: string; reason: string; docId: string; url: string }[];
  timeline: TimelineEvent[];
  conclusions: Conclusion[];
  swaps: { url: string; before: string[]; after: string[]; beforeAt?: string; afterAt?: string; chain: string }[];
  identity: IdentityComponent[];
  /** Adresy URL ujawnione w trakcie pivotu, ale niepobrane – host wymaga zatwierdzenia przez analityka. */
  skippedUrls: { url: string; host: string; foundIn: string }[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  stats: Record<string, number>;
  notes: string[];
  requestLog: RequestLogEntry[];
  configSnapshot: Record<string, unknown>;
}

export interface StoredDocument {
  id: string;
  source: string;
  url: string;
  title: string;
  author?: string;
  publishedAt?: string;
  fetchedAt: string;
  sha256: string;
  content: string;
}

const HANDLE_KINDS: IdentifierKind[] = ['nick', 'telegram', 'email', 'messenger'];

/** Hosty należące do tego samego serwisu (konto GitHub = gisty = README). */
const SITE_ALIASES: Record<string, string> = {
  'gist.github.com': 'github.com',
  'raw.githubusercontent.com': 'github.com',
  'gist.githubusercontent.com': 'github.com',
  'old.reddit.com': 'reddit.com',
  'twitter.com': 'x.com',
};

export function siteOf(url: string, archiveOf?: string): string {
  try {
    const u = new URL(archiveOf ?? url);
    const sandbox = new URL(config.sandboxUrl);
    if (u.host === sandbox.host) {
      const m = u.pathname.match(/^\/s\/([^/]+)/);
      return m ? m[1] : 'piaskownica';
    }
    const host = u.hostname.replace(/^www\./, '');
    return SITE_ALIASES[host] ?? host;
  } catch {
    return url;
  }
}

const idKey = (i: Identifier) => `${i.kind}:${i.value.toLowerCase().replace(/\/$/, '')}`;

type RunOutput = { result: RunResult; storedDocs: StoredDocument[] };

/** Każdy przebieg ma własny zakres sieciowy: zatwierdzone hosty i cache tylko z tego przebiegu (http/fetcher.ts). */
export function runInvestigation(seedsIn: Identifier[], optionsIn: Partial<InvestigationOptions> = {}, onProgress?: (msg: string) => void): Promise<RunOutput> {
  const options: InvestigationOptions = { ...DEFAULT_OPTIONS, ...optionsIn };
  const startedAt = new Date().toISOString();
  return withRunScope({ approvedHosts: new Set(options.approvedHosts.map((h) => h.toLowerCase())), cacheSince: Date.parse(startedAt) }, () => runInScope(seedsIn, options, startedAt, onProgress));
}

async function runInScope(seedsIn: Identifier[], options: InvestigationOptions, startedAt: string, onProgress?: (msg: string) => void): Promise<RunOutput> {
  const log: RequestLogEntry[] = [];
  const notes: string[] = [];
  const sources = getSources(options.sources);
  const seeds = seedsIn.map((s) => ({ kind: s.kind, value: s.value.trim() })).filter((s) => s.value);

  // ---------- 1. Identyfikatory i kolejka BFS ----------
  const identifiers: SubjectIdentifier[] = [];
  const idSeen = new Set<string>();
  const queue: SubjectIdentifier[] = [];
  const enqueue = (i: SubjectIdentifier) => {
    const k = idKey(i);
    if (idSeen.has(k)) return;
    idSeen.add(k);
    identifiers.push(i);
    queue.push(i);
    // Profil społecznościowy → również nick (pivot do innych serwisów).
    if (i.kind === 'social') {
      const h = handleFromSocial(i.value);
      if (h) enqueue({ kind: 'nick', value: h, depth: i.depth, origin: i.origin, via: i.via ?? { docId: '-', url: i.value, rule: 'Nick wyodrębniony z adresu URL profilu' } });
    }
  };
  for (const s of seeds) {
    // Adres wejściowy walidujemy i kanonizujemy.
    if (s.kind === 'address') {
      const m = extractAddresses(s.value).matches[0];
      if (!m) notes.push(`Wejściowy adres "${s.value}" nie przeszedł walidacji formatu/sumy kontrolnej – wyszukiwany jako tekst.`);
      enqueue({ kind: 'address', value: m?.address ?? s.value, depth: 0, origin: 'input' });
    } else enqueue({ ...s, depth: 0, origin: 'input' });
  }
  const subjectHandles = () => identifiers.filter((i) => HANDLE_KINDS.includes(i.kind) || (i.kind === 'social' && handleFromSocial(i.value)));
  const matchSubject = (author?: string): { id: SubjectIdentifier; strength: ReturnType<typeof handleMatch> } | null => {
    if (!author) return null;
    let best: { id: SubjectIdentifier; strength: ReturnType<typeof handleMatch> } | null = null;
    const order = { exact: 3, normalized: 2, partial: 1, none: 0 };
    for (const id of subjectHandles()) {
      const val = id.kind === 'social' ? (handleFromSocial(id.value) ?? '') : id.value;
      const st = handleMatch(author, val);
      if (st !== 'none' && (!best || order[st] > order[best.strength] || (order[st] === order[best.strength] && id.depth < best.id.depth))) best = { id, strength: st };
    }
    return best;
  };

  // ---------- 2. Zbieranie dokumentów ----------
  interface RawDoc {
    rec: DocRecord;
    doc: SourceDocument;
    via: SubjectIdentifier;
  }
  const raw: RawDoc[] = [];
  const urlSeen = new Map<string, RawDoc>();
  const skippedUrls: RunResult['skippedUrls'] = [];
  const addressPublishers = new Set<string>();
  let docCounter = 0;

  while (queue.length && raw.length < options.maxDocuments) {
    const ident = queue.shift()!;
    const applicable = sources.filter((s) => s.accepts.includes(ident.kind));
    for (const src of applicable) {
      onProgress?.(`${src.label}: ${IDENTIFIER_LABELS[ident.kind]} "${ident.value}"`);
      let docs: SourceDocument[] = [];
      try {
        docs = await src.search(ident, { log, notes, origin: ident.origin, foundIn: ident.via?.url, skipped: skippedUrls });
      } catch (e) {
        notes.push(`Źródło ${src.label} – błąd dla "${ident.value}": ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      for (const doc of docs) {
        if (raw.length >= options.maxDocuments) {
          notes.push(`Osiągnięto limit ${options.maxDocuments} dokumentów – część wyników pominięto.`);
          break;
        }
        if (urlSeen.has(doc.url)) continue;
        const id = `D${++docCounter}`;
        // Własność dokumentu: autor = identyfikator badanego albo zasób pobrany bezpośrednio dla identyfikatora badanego.
        const authorMatch = matchSubject(doc.author);
        let owned = false;
        let ownershipRule = 'Dokument nie należy do badanego (autor nieustalony lub inny)';
        if (authorMatch && authorMatch.strength !== 'partial') {
          owned = true;
          ownershipRule = `Autor/właściciel "${doc.author}" ↔ identyfikator badanego "${authorMatch.id.value}" (${authorMatch.strength === 'exact' ? 'dokładne dopasowanie' : 'dopasowanie po normalizacji'})`;
        } else if (doc.subjectMatch === 'direct' && ident.kind !== 'address' && ident.kind !== 'name') {
          owned = true;
          ownershipRule = `Zasób pobrany bezpośrednio dla identyfikatora badanego "${ident.value}" (${src.label})`;
        }
        const rec: DocRecord = {
          id,
          source: doc.source,
          url: doc.url,
          site: siteOf(doc.url, doc.archiveOf),
          title: doc.title,
          kind: doc.kind,
          author: doc.author,
          publishedAt: doc.publishedAt,
          fetchedAt: doc.fetchedAt,
          sha256: sha256Hex(doc.content),
          query: doc.query,
          subjectMatch: doc.subjectMatch,
          verified: !!doc.verified,
          archiveOf: doc.archiveOf,
          depth: ident.depth,
          viaIdentifier: `${IDENTIFIER_LABELS[ident.kind]}: ${ident.value}`,
          ownedBySubject: owned,
          ownershipRule,
          addressCount: 0,
          synthetic: doc.source === 'sandbox',
        };
        const r: RawDoc = { rec, doc, via: ident };
        raw.push(r);
        urlSeen.set(doc.url, r);

        // ---------- Pivot: nowe identyfikatory ----------
        const nextDepth = ident.depth + 1;
        if (nextDepth > options.maxDepth) continue;
        const pivotFrom: { text: string; rule: string }[] = [];
        if (owned) pivotFrom.push({ text: doc.content, rule: 'Identyfikator ujawniony w dokumencie należącym do badanego' });
        else
          for (const seg of doc.segments ?? []) {
            const m = matchSubject(seg.author);
            if (m && m.strength !== 'partial') pivotFrom.push({ text: seg.text, rule: `Identyfikator ujawniony w wypowiedzi badanego (${seg.author})` });
          }
        if (owned) for (const li of doc.linkedIdentifiers ?? []) enqueue({ ...li, depth: nextDepth, origin: 'pivot', via: { docId: id, url: doc.url, rule: `Pole profilu w ${src.label}` } });
        for (const p of pivotFrom) for (const li of extractIdentifiers(p.text)) enqueue({ ...li, depth: nextDepth, origin: 'pivot', via: { docId: id, url: doc.url, rule: p.rule } });
        // Wyszukiwanie odwrotne: autor publikacji zawierającej adres wejściowy.
        // Autor, który ostrzega przed adresem lub go cytuje, nie jest jego właścicielem – nie pivotujemy.
        if (ident.kind === 'address') {
          const segs: Segment[] = doc.segments ?? [{ author: doc.author, text: doc.content }];
          for (const seg of segs) {
            if (!seg.author || !seg.text.toLowerCase().includes(ident.value.toLowerCase())) continue;
            const warn = seg.text.match(WARNING_CONTEXT);
            if (warn) {
              notes.push(`Pominięto autora "${seg.author}" (${doc.url}) – adres wejściowy występuje w kontekście ostrzeżenia ("${warn[0]}"), autor nie jest jego właścicielem.`);
              continue;
            }
            addressPublishers.add(accountKey(siteOf(doc.url, doc.archiveOf), seg.author));
            enqueue({ kind: 'nick', value: seg.author, depth: nextDepth, origin: 'pivot', weak: true, via: { docId: id, url: doc.url, rule: `Autor publikacji zawierającej adres wejściowy ${ident.value}` } });
          }
        }
      }
    }
  }

  // ---------- 3. Ekstrakcja adresów i przypisanie autorstwa ----------
  interface Mention {
    match: AddressMatch;
    rd: RawDoc;
    seg: Segment;
    structured: boolean;
  }
  const mentions: Mention[] = [];
  const rejected: RunResult['rejected'] = [];
  const docKeys = new Map<RawDoc, Set<string>>(); // klucze adresów w każdym dokumencie
  for (const rd of raw) {
    const segs: Segment[] = rd.doc.segments?.length ? rd.doc.segments : [{ author: rd.doc.author, text: rd.doc.content, kind: rd.doc.kind }];
    const keys = new Set<string>();
    segs.forEach((seg) => {
      const ex = extractAddresses(seg.text);
      const inSeg = new Set<string>();
      for (const m of ex.matches) {
        if (inSeg.has(m.key)) continue;
        inSeg.add(m.key);
        keys.add(m.key);
        mentions.push({ match: m, rd, seg, structured: false });
      }
      for (const rj of ex.rejected) rejected.push({ ...rj, docId: rd.rec.id, url: rd.rec.url });
    });
    for (const sa of rd.doc.structuredAddresses ?? []) {
      const m = extractAddresses(sa.address).matches[0];
      if (!m) {
        rejected.push({ candidate: sa.address, reason: 'Adres z pola strukturalnego nie przeszedł walidacji', docId: rd.rec.id, url: rd.rec.url });
        continue;
      }
      keys.add(m.key);
      mentions.push({ match: { ...m, context: `Pole profilu: ${sa.label ?? ''} ${sa.address}` }, rd, seg: { author: rd.doc.author, text: sa.address, kind: rd.doc.kind }, structured: true });
    }
    rd.rec.addressCount = keys.size;
    docKeys.set(rd, keys);
  }

  // Adresy obecne w aktualnych wersjach stron (do oznaczenia adresów tylko-archiwalnych).
  const currentByUrl = new Map<string, Set<string>>();
  for (const m of mentions) if (m.rd.doc.kind !== 'archive') (currentByUrl.get(m.rd.doc.url) ?? currentByUrl.set(m.rd.doc.url, new Set()).get(m.rd.doc.url)!).add(m.match.key);

  // ---------- 3a. Tożsamość: grupy kont połączonych twardymi powiązaniami ----------
  const identity = buildIdentity(
    raw.map((r) => ({ site: r.rec.site, url: r.rec.url, kind: r.doc.kind, author: r.doc.author, owned: r.rec.ownedBySubject, content: r.doc.content, segments: r.doc.segments, linked: r.doc.linkedIdentifiers ?? [] })),
    seeds,
    addressPublishers,
    (u) => siteOf(u),
  );

  const ai = options.useAi ? getAiProvider() : null;
  let aiCalls = 0;
  const groups = new Map<string, { match: AddressMatch; evidence: Evidence[]; ai: AddressResult['aiSuggestions'] }>();
  for (const mn of mentions) {
    const { rd, seg, match } = mn;
    const segAuthor = seg.author ?? rd.doc.author;
    const am = matchSubject(segAuthor);
    let attribution: Evidence['attribution'] = 'unknown';
    let attributionRule = 'Brak autora – nie można przypisać';
    let linkStrength: Evidence['linkStrength'] = 'none';
    let depth = rd.rec.depth;
    let viaNickOnly = false;
    let weakIdentity = false;
    if (am) {
      attribution = 'subject';
      linkStrength = am.strength;
      depth = am.id.depth;
      viaNickOnly = am.id.kind === 'nick' || am.id.kind === 'social';
      weakIdentity = !!am.id.weak;
      attributionRule = `Autor treści "${segAuthor}" ↔ identyfikator badanego "${am.id.value}" (${am.strength === 'exact' ? 'dokładne' : am.strength === 'normalized' ? 'po normalizacji' : 'częściowe'})`;
    } else if (rd.rec.ownedBySubject && (!seg.author || seg.author === rd.doc.author)) {
      attribution = 'subject';
      linkStrength = 'exact';
      viaNickOnly = rd.via.kind === 'nick' || rd.via.kind === 'social';
      weakIdentity = !!rd.via.weak;
      attributionRule = rd.rec.ownershipRule;
    } else if (segAuthor) {
      attribution = 'other';
      attributionRule = `Adres opublikował "${segAuthor}" – brak powiązania z identyfikatorami badanego`;
    }
    const ownDoc = attribution === 'subject' && rd.rec.ownedBySubject;
    const context = classifyContext(rd.doc.kind, ownDoc, match.context, seg.hint, seg.kind, rd.doc.title);
    const archived = rd.doc.kind === 'archive' && !!rd.doc.archiveOf && !(currentByUrl.get(rd.doc.archiveOf)?.has(match.key) ?? false);
    const acc = segAuthor ? identity.accounts.get(accountKey(rd.rec.site, segAuthor)) : undefined;
    const identityConfirmed = !!acc?.confirmed;
    const identityRule = acc
      ? `konto ${acc.site} / ${acc.handle}: ${acc.confirmed ? 'w potwierdzonej grupie kont badanego' : 'niepołączone z innymi kontami badanego'}`
      : 'brak konta autora';
    const ev: Evidence = {
      docId: rd.rec.id,
      url: rd.rec.url,
      site: rd.rec.site,
      source: rd.rec.source,
      title: rd.rec.title,
      kind: seg.kind ?? rd.doc.kind,
      fetchedAt: rd.rec.fetchedAt,
      publishedAt: seg.publishedAt ?? rd.doc.publishedAt,
      author: segAuthor,
      attribution,
      attributionRule,
      linkStrength,
      depth,
      context,
      snippet: match.context,
      structured: mn.structured,
      verified: rd.rec.verified,
      archived,
      viaNickOnly,
      identityConfirmed,
      identityRule,
      weakIdentity,
    };
    const g = groups.get(match.key) ?? groups.set(match.key, { match, evidence: [], ai: [] }).get(match.key)!;
    g.evidence.push(ev);
    if (ai && aiCalls < 10 && attribution === 'subject' && context.rule.startsWith('K8')) {
      aiCalls++;
      const sug = await ai.suggestContext(match.context, log);
      if (sug) g.ai.push({ docId: rd.rec.id, category: CONTEXT_INFO[sug.category].label, reason: sug.reason });
    }
  }

  // ---------- 4. Dane on-chain ----------
  const results: AddressResult[] = [];
  const ordered = [...groups.values()].sort((a, b) => Number(b.evidence.some((e) => e.attribution === 'subject')) - Number(a.evidence.some((e) => e.attribution === 'subject')));
  let lookups = 0;
  for (const g of ordered) {
    const label = lookupLabel(g.match.chain, g.match.address);
    let onchain: ChainSummary | null = null;
    const knownExcluded = label && EXCLUDED_CATEGORIES.includes(label.category) && label.origin === 'seed-list';
    if (options.chainLookup && !knownExcluded && lookups < options.maxChainLookups) {
      onProgress?.(`On-chain: ${g.match.chain} ${g.match.address}`);
      lookups++;
      onchain = await getChainSummary(g.match.chain, g.match.address, log);
    }
    results.push({
      key: g.match.key,
      chain: g.match.chain,
      address: g.match.address,
      format: g.match.format,
      checksum: g.match.checksum,
      formatNotes: g.match.notes,
      evidence: g.evidence,
      label: label ?? onchain?.label ?? null,
      onchain,
      indicators: [],
      score: scoreAddress({ evidence: g.evidence, label: label ?? onchain?.label ?? null, isContract: onchain?.isContract ?? null, indicators: [], linkedToStrongAddress: false }),
      aiSuggestions: g.ai,
    });
  }

  // ---------- 5. Wskaźniki i ostateczny wynik (2. przebieg – powiązania on-chain) ----------
  const attributedKeys = new Map(results.filter((r) => isAttributed(r.score)).map((r) => [r.key, r.address]));
  for (const r of results) {
    if (r.onchain) r.indicators = computeIndicators(r.onchain, { linkedKeys: new Map([...attributedKeys].filter(([k]) => k !== r.key)), stableThreshold: options.stableThreshold, highActivityTx: 5000 });
  }
  const strong = new Set(results.filter((r) => !r.score.excluded && r.score.score >= 60).map((r) => r.key));
  for (const r of results) {
    const linkedToStrong = !!r.onchain?.txs.some((t) => t.counterparty && strong.has(addressKey(r.chain, t.counterparty)));
    r.score = scoreAddress({ evidence: r.evidence, label: r.label, isContract: r.onchain?.isContract ?? null, indicators: r.indicators, linkedToStrongAddress: linkedToStrong });
  }
  results.sort((a, b) => b.score.score - a.score.score);

  // ---------- 6. Podmiany adresów (ta sama strona, różne wersje w czasie) ----------
  const swaps: RunResult['swaps'] = [];
  const byOrigin = new Map<string, { at?: string; keys: Set<string>; chainOf: Map<string, string> }[]>();
  for (const rd of raw) {
    const origin = rd.doc.archiveOf ?? rd.doc.url;
    const keys = docKeys.get(rd)!;
    if (!keys.size) continue;
    const chainOf = new Map([...keys].map((k) => [k, k.split(':')[0]]));
    (byOrigin.get(origin) ?? byOrigin.set(origin, []).get(origin)!).push({ at: rd.doc.kind === 'archive' ? rd.doc.publishedAt : rd.doc.fetchedAt, keys, chainOf });
  }
  for (const [url, versions] of byOrigin) {
    if (versions.length < 2) continue;
    versions.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
    for (let i = 1; i < versions.length; i++) {
      const prev = versions[i - 1];
      const cur = versions[i];
      for (const chain of new Set([...prev.chainOf.values(), ...cur.chainOf.values()])) {
        const before = [...prev.keys].filter((k) => k.startsWith(chain + ':'));
        const after = [...cur.keys].filter((k) => k.startsWith(chain + ':'));
        if (before.length && after.length && before.sort().join() !== after.sort().join())
          swaps.push({ url, chain, before: before.map((k) => k.split(':').slice(1).join(':')), after: after.map((k) => k.split(':').slice(1).join(':')), beforeAt: prev.at, afterAt: cur.at });
      }
    }
  }

  // ---------- 7. Chronologia przepływu środków (adresy przypisane, niewykluczone) ----------
  const timeline: TimelineEvent[] = [];
  for (const r of results) {
    if (r.score.excluded || r.score.score < 40 || !r.onchain) continue;
    const cashTx = new Set(r.indicators.filter((i) => i.cashOut).flatMap((i) => i.txs));
    for (const t of r.onchain.txs)
      timeline.push({ time: t.time, address: r.address, chain: r.chain, hash: t.hash, direction: t.direction, asset: t.asset, amount: t.amount, counterparty: t.counterparty, counterpartyLabel: t.counterpartyLabel?.name ?? null, counterpartyCategory: t.counterpartyLabel?.category ?? null, cashOut: cashTx.has(t.hash) && !!t.counterpartyLabel, synthetic: r.onchain.synthetic });
  }
  timeline.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

  // ---------- 8. Graf powiązań ----------
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const addNode = (n: GraphNode) => {
    if (!nodeIds.has(n.id)) {
      nodeIds.add(n.id);
      nodes.push(n);
    }
  };
  const addEdgeOnce = (e: GraphEdge) => {
    const k = `${e.type}|${e.source}|${e.target}`;
    if (!edgeIds.has(k)) {
      edgeIds.add(k);
      edges.push(e);
    }
  };
  for (const i of identifiers) addNode({ id: `id:${idKey(i)}`, type: 'identifier', label: i.value, meta: { kind: i.kind, depth: i.depth, origin: i.origin } });
  for (const rd of raw) {
    if (!rd.rec.addressCount && !identifiers.some((i) => i.via?.docId === rd.rec.id)) continue;
    addNode({ id: `doc:${rd.rec.id}`, type: 'document', label: rd.rec.title.slice(0, 48), meta: { url: rd.rec.url, owned: rd.rec.ownedBySubject, site: rd.rec.site } });
    edges.push({ source: `id:${idKey(rd.via)}`, target: `doc:${rd.rec.id}`, type: 'found' });
  }
  for (const i of identifiers) if (i.via && nodeIds.has(`doc:${i.via.docId}`)) edges.push({ source: `doc:${i.via.docId}`, target: `id:${idKey(i)}`, type: 'pivot', label: 'pivot' });
  for (const r of results) {
    addNode({ id: `addr:${r.key}`, type: 'address', label: `${r.chain} ${r.address.slice(0, 8)}…${r.address.slice(-4)}`, meta: { score: r.score.score, band: r.score.band, excluded: r.score.excluded } });
    for (const e of r.evidence) if (nodeIds.has(`doc:${e.docId}`)) edges.push({ source: `doc:${e.docId}`, target: `addr:${r.key}`, type: e.attribution === 'subject' ? 'mentions' : 'mentions-other' });
    for (const t of r.onchain?.txs ?? []) {
      if (!t.counterparty) continue;
      const ck = addressKey(r.chain, t.counterparty);
      if (groups.has(ck) && ck !== r.key) {
        const [a, b] = [r.key, ck].sort();
        addEdgeOnce({ source: `addr:${a}`, target: `addr:${b}`, type: 'onchain', label: 'on-chain' });
      } else if (t.counterpartyLabel) {
        const sid = `svc:${t.counterpartyLabel.name}`;
        addNode({ id: sid, type: 'service', label: t.counterpartyLabel.name, meta: { category: t.counterpartyLabel.category } });
        addEdgeOnce({ source: `addr:${r.key}`, target: sid, type: 'service', label: CATEGORY_LABELS[t.counterpartyLabel.category] });
      }
    }
  }

  // ---------- 9. Wnioski wymagające weryfikacji ----------
  const conclusions: Conclusion[] = [];
  for (const r of results) {
    if (r.score.excluded) {
      if (r.evidence.some((e) => e.attribution === 'subject'))
        conclusions.push({ level: 'low', text: `Badany posługiwał się adresem ${r.address} należącym do podmiotu "${r.label?.name}" – odnotowano interakcję, adres nie jest prywatnym portfelem.`, basis: r.evidence.filter((e) => e.attribution === 'subject').map((e) => e.url), verify: r.label?.category === 'CEX' ? `Portfel giełdy jest wspólny dla wielu klientów – pytać ${r.label?.name} o klienta, który zlecił konkretne transakcje badanego (hashe w chronologii przepływu środków), a nie o sam adres.` : 'Brak dalszych działań wobec samego adresu.' });
      continue;
    }
    if (r.score.score < 40) continue;
    const top = r.evidence.find((e) => e.docId === r.score.bestEvidenceDocId);
    conclusions.push({
      level: r.score.score >= 80 ? 'high' : r.score.score >= 60 ? 'medium' : 'low',
      text: `Adres ${r.chain} ${r.address} powiązany z identyfikatorami badanego – Wskaźnik Pewności ${r.score.score}% (${r.score.bandLabel}).`,
      basis: [...new Set(r.evidence.filter((e) => e.attribution === 'subject').map((e) => e.url))],
      verify: top ? `Potwierdzić, że konto "${top.author ?? top.site}" (${top.site}) należy do badanej osoby – powiązanie z identyfikatorem wejściowym nie przesądza o tożsamości (np. dane rejestrowe serwisu, korelacja z innymi danymi KAS).` : 'Potwierdzić tożsamość autora publikacji.',
    });
    for (const ind of r.indicators.filter((i) => i.cashOut))
      conclusions.push({ level: 'high', text: `Możliwe wyjście do walut tradycyjnych z adresu ${r.address}: ${ind.title}. ${ind.detail}`, basis: ind.txs, verify: 'Zweryfikować u wskazanego podmiotu (giełda/kantor) dane KYC i wypłaty fiat; porównać z zeznaniem PIT-38.' });
    for (const ind of r.indicators.filter((i) => i.code === 'MIXER'))
      conclusions.push({ level: 'high', text: `Interakcja z mikserem z adresu ${r.address}: ${ind.detail}`, basis: ind.txs, verify: 'Ustalić pochodzenie i dalszy los środków przepuszczonych przez mikser (adresy po drugiej stronie, kwoty, czas) – możliwe ukrywanie źródła lub przychodu.' });
  }
  for (const s of swaps) conclusions.push({ level: 'medium', text: `Podmiana adresu ${s.chain} na stronie ${s.url}: ${s.before.join(', ')} → ${s.after.join(', ')}.`, basis: [s.url], verify: 'Sprawdzić, czy oba adresy należą do badanego (wspólna kontrola) – nowy adres powinien zostać objęty analizą.' });

  const finishedAt = new Date().toISOString();
  const stats = {
    identifiers: identifiers.length,
    documents: raw.length,
    documentsWithAddresses: raw.filter((r) => r.rec.addressCount > 0).length,
    addresses: results.length,
    attributed: results.filter((r) => isAttributed(r.score)).length,
    highConfidence: results.filter((r) => r.score.score >= 80).length,
    excluded: results.filter((r) => r.score.excluded).length,
    rejectedCandidates: rejected.length,
    cashOutSignals: results.reduce((a, r) => a + (r.score.excluded ? 0 : r.indicators.filter((i) => i.cashOut).length), 0),
    requests: log.length,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
  };

  return {
    result: {
      engineVersion: ENGINE_VERSION,
      startedAt,
      finishedAt,
      options,
      seeds,
      identifiers,
      documents: raw.map((r) => r.rec),
      addresses: results,
      rejected,
      timeline,
      conclusions,
      swaps,
      identity: identity.components,
      skippedUrls,
      graph: { nodes, edges },
      stats,
      notes,
      requestLog: log,
      configSnapshot: { allowedHosts: config.allowedHosts, chainLive: config.chainLive, ai: config.ai.provider === 'none' ? 'wyłączone' : `${config.ai.provider} / ${config.ai.model}`, blockscout: config.blockscoutUrl, esplora: config.esploraUrl },
    },
    storedDocs: raw.map((r) => ({ id: r.rec.id, source: r.rec.source, url: r.rec.url, title: r.rec.title, author: r.rec.author, publishedAt: r.rec.publishedAt, fetchedAt: r.rec.fetchedAt, sha256: r.rec.sha256, content: r.doc.content })),
  };
}
