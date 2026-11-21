// Jedyny punkt wyjścia aplikacji do sieci.
// - biała lista hostów (brak wysyłania danych do niezatwierdzonych usług),
// - limit tempa per host, timeout, identyfikujący User-Agent,
// - cache w bazie (odtwarzalność + oszczędzanie limitów API),
// - rejestr wszystkich zapytań w logu przebiegu.
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '../config.ts';
import { db, iso, now } from '../db/db.ts';

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  fetchedAt: string;
  fromCache: boolean;
}

export class FetchBlockedError extends Error {}

export interface RequestLogEntry {
  ts: string;
  url: string;
  status: number | string;
  cache: boolean;
  ms: number;
}

const lastHit = new Map<string, number>();

/**
 * Zakres przebiegu (AsyncLocalStorage): hosty zatwierdzone dla TEGO przebiegu i moment jego startu.
 * Dzięki temu dopuszczenie hosta nie "przecieka" do innych analiz, a cache nie zwraca danych
 * sprzed bieżącego przebiegu (analiza cykliczna zawsze widzi aktualny stan źródeł).
 */
export interface RunScope {
  approvedHosts: Set<string>;
  cacheSince: number;
}
const runScope = new AsyncLocalStorage<RunScope>();

export function withRunScope<T>(scope: RunScope, fn: () => Promise<T>): Promise<T> {
  return runScope.run(scope, fn);
}

/** Dopuszcza host w bieżącym przebiegu (np. strona podana przez analityka w danych wejściowych). */
export function allowHostForRun(host: string): void {
  runScope.getStore()?.approvedHosts.add(host.toLowerCase());
}

export function currentCacheSince(): number {
  return runScope.getStore()?.cacheSince ?? 0;
}

export function isHostAllowed(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  // Hosty skonfigurowane przez administratora (AI, SearXNG, piaskownica) są zatwierdzone z definicji.
  const operatorHosts = [config.sandboxUrl, config.searxngUrl, config.ai.provider !== 'none' ? config.ai.baseUrl : ''].map(safeHost);
  return config.allowedHosts.includes(host) || operatorHosts.includes(host) || !!runScope.getStore()?.approvedHosts.has(host);
}

function safeHost(u: string | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function throttle(host: string) {
  const last = lastHit.get(host) ?? 0;
  const wait = last + config.perHostDelayMs - Date.now();
  lastHit.set(host, Math.max(Date.now(), last + config.perHostDelayMs));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export async function fetchText(
  url: string,
  opts: { log?: RequestLogEntry[]; headers?: Record<string, string>; useCache?: boolean; accept?: string } = {},
): Promise<FetchResult> {
  if (!isHostAllowed(url)) {
    opts.log?.push({ ts: now(), url, status: 'BLOCKED (host spoza białej listy)', cache: false, ms: 0 });
    throw new FetchBlockedError(`Host spoza białej listy: ${url}`);
  }
  const useCache = opts.useCache ?? true;
  const local = /^(127\.0\.0\.1|localhost)$/.test(new URL(url).hostname);
  if (useCache && !local) {
    const row = await db().one<{ fetched_at: unknown; status: number; content_type: string; body: string }>('SELECT * FROM http_cache WHERE url = $1', [url]);
    const fetchedAt = row ? iso(row.fetched_at)! : '';
    const fetched = row ? Date.parse(fetchedAt) : 0;
    if (row && Date.now() - fetched < config.cacheTtlMinutes * 60_000 && fetched >= currentCacheSince()) {
      opts.log?.push({ ts: now(), url, status: row.status, cache: true, ms: 0 });
      return { url, status: row.status, contentType: row.content_type, body: row.body, fetchedAt, fromCache: true };
    }
  }
  const host = new URL(url).hostname;
  if (!local) await throttle(host);
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': config.userAgent, Accept: opts.accept ?? '*/*', ...opts.headers },
    });
    // Przekierowanie poza białą listę traktujemy jako zablokowane.
    if (res.url && !isHostAllowed(res.url)) throw new FetchBlockedError(`Przekierowanie poza białą listę: ${res.url}`);
    const body = (await res.text()).slice(0, 2_000_000);
    const fetchedAt = now();
    const contentType = res.headers.get('content-type') ?? '';
    opts.log?.push({ ts: fetchedAt, url, status: res.status, cache: false, ms: Date.now() - started });
    if (res.ok && !local) {
      await db().query(
        `INSERT INTO http_cache (url, fetched_at, status, content_type, body) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (url) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, status = EXCLUDED.status, content_type = EXCLUDED.content_type, body = EXCLUDED.body`,
        [url, fetchedAt, res.status, contentType, body],
      );
    }
    return { url, status: res.status, contentType, body, fetchedAt, fromCache: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    opts.log?.push({ ts: now(), url, status: `ERROR: ${msg}`, cache: false, ms: Date.now() - started });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, opts: Parameters<typeof fetchText>[1] = {}): Promise<{ data: T | null; res: FetchResult }> {
  const res = await fetchText(url, { accept: 'application/json', ...opts });
  if (res.status < 200 || res.status >= 300) return { data: null, res };
  try {
    return { data: JSON.parse(res.body) as T, res };
  } catch {
    return { data: null, res };
  }
}
