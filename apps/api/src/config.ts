// Konfiguracja przez zmienne środowiskowe (plik .env nie jest wymagany – patrz .env.example).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const API_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(API_ROOT, '..', '..');

// Minimalny loader .env (bez zależności).
const envFile = path.join(REPO_ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    const quoted = m[2].match(/^(["'])(.*)\1/);
    // Wartość w cudzysłowie – bez zmian; inaczej obcinamy komentarz "  # ..." na końcu linii.
    process.env[m[1]] = quoted ? quoted[2] : m[2].replace(/\s+#.*$/, '');
  }
}

const env = (k: string, d = '') => process.env[k] ?? d;
const list = (k: string, d: string) => env(k, d).split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(env('PORT', '8080')),
  host: env('HOST', '127.0.0.1'),
  dbPath: env('DB_PATH', path.join(API_ROOT, 'data', 'ogar.db')),
  /** Adres syntetycznego "internetu" do scenariuszy testowych. */
  sandboxUrl: env('SANDBOX_URL', 'http://127.0.0.1:4100'),
  /** Źródła włączone domyślnie (można nadpisać per analiza). */
  defaultSources: list('SOURCES', 'github,keybase,gravatar,hackernews,web,wayback'),
  /** Czy odpytywać publiczne API blockchain (Blockscout/Esplora). false = tylko dane syntetyczne/cache. */
  chainLive: env('CHAIN_LIVE', 'true') === 'true',
  blockscoutUrl: env('BLOCKSCOUT_URL', 'https://eth.blockscout.com'),
  esploraUrl: env('ESPLORA_URL', 'https://blockstream.info/api'),
  tronscanUrl: env('TRONSCAN_URL', 'https://apilist.tronscanapi.com'),
  /** Klucz Tronscan (opcjonalny – daje etykiety adresów). Bez klucza używany jest TronGrid. */
  tronscanApiKey: env('TRONSCAN_API_KEY'),
  trongridUrl: env('TRONGRID_URL', 'https://api.trongrid.io'),
  githubToken: env('GITHUB_TOKEN'),
  searxngUrl: env('SEARXNG_URL'),
  /**
   * Biała lista hostów, do których aplikacja może wysyłać zapytania.
   * Zgodnie z wymaganiem: brak wysyłania danych do niezatwierdzonych usług.
   */
  allowedHosts: list(
    'ALLOWED_HOSTS',
    '127.0.0.1,localhost,api.github.com,github.com,raw.githubusercontent.com,gist.githubusercontent.com,keybase.io,gravatar.com,en.gravatar.com,api.gravatar.com,www.reddit.com,hn.algolia.com,web.archive.org,eth.blockscout.com,blockstream.info,apilist.tronscanapi.com,api.trongrid.io',
  ),
  /**
   * Czy strona podana WPROST przez analityka w danych wejściowych może być pobrana (zgoda na jej host
   * obowiązuje tylko w danym przebiegu). Strony ujawnione w pivocie zawsze wymagają zatwierdzenia hosta.
   */
  allowUserUrls: env('ALLOW_USER_URLS', 'true') === 'true',
  userAgent: env('USER_AGENT', 'OGAR-OSINT-research/0.1 (+public-sources-only)'),
  requestTimeoutMs: Number(env('REQUEST_TIMEOUT_MS', '12000')),
  perHostDelayMs: Number(env('PER_HOST_DELAY_MS', '400')),
  cacheTtlMinutes: Number(env('CACHE_TTL_MINUTES', '30')),
  ai: {
    /** none | openai-compatible (np. lokalna Ollama/vLLM/LM Studio pod /v1). */
    provider: env('AI_PROVIDER', 'none'),
    baseUrl: env('AI_BASE_URL', 'http://127.0.0.1:11434/v1'),
    model: env('AI_MODEL', 'llama3.1:8b'),
    apiKey: env('AI_API_KEY'),
  },
  schedulerTickMs: Number(env('SCHEDULER_TICK_MS', '30000')),
};

export type Config = typeof config;
