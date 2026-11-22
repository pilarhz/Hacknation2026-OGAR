// PostgreSQL w dwóch trybach z tym samym schematem i SQL: serwer (DATABASE_URL, sterownik `pg`)
// albo wbudowany PGlite (WebAssembly w procesie Node) w katalogu DB_PATH (":memory:" w testach).
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS investigations (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  case_ref         TEXT,
  created_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL,
  schedule_minutes INTEGER,
  next_run_at      TIMESTAMPTZ,
  options          JSONB NOT NULL,
  seeds            JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id               TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  trigger          TEXT NOT NULL,
  status           TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL,
  finished_at      TIMESTAMPTZ,
  result           JSONB,
  error            TEXT,
  UNIQUE (investigation_id, seq)
);
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,
  url          TEXT NOT NULL,
  title        TEXT,
  author       TEXT,
  published_at TEXT,
  fetched_at   TIMESTAMPTZ NOT NULL,
  sha256       TEXT NOT NULL,
  content      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_run ON documents(run_id);
-- Kosz: usunięta analiza ma deleted_at; po 30 dniach jest kasowana na stałe (purgeExpiredTrash).
ALTER TABLE investigations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- Unieważnienie przebiegu: przebieg zostaje (ciągłość dowodowa), ale jest oznaczony jako błędny z powodem.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS invalid_reason TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS invalid_note TEXT;
CREATE INDEX IF NOT EXISTS investigations_deleted ON investigations(deleted_at);
CREATE TABLE IF NOT EXISTS http_cache (
  url          TEXT PRIMARY KEY,
  fetched_at   TIMESTAMPTZ NOT NULL,
  status       INTEGER NOT NULL,
  content_type TEXT,
  body         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chain_cache (
  key        TEXT PRIMARY KEY,
  fetched_at TIMESTAMPTZ NOT NULL,
  data       JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_labels (
  key      TEXT PRIMARY KEY,
  chain    TEXT NOT NULL,
  address  TEXT NOT NULL,
  name     TEXT NOT NULL,
  category TEXT NOT NULL,
  note     TEXT,
  added_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id     BIGSERIAL PRIMARY KEY,
  ts     TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL,
  detail JSONB
);
`;

export type Row = Record<string, unknown>;

export interface Db {
  readonly kind: 'postgres' | 'pglite';
  /** Zapytanie z parametrami $1, $2, … – zwraca wiersze. */
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Wiele instrukcji bez parametrów (schemat). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

interface Driver {
  kind: Db['kind'];
  query(sql: string, params: unknown[]): Promise<{ rows: Row[] }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

async function openDriver(): Promise<Driver> {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    return {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params),
      exec: async (sql) => void (await pool.query(sql)),
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const memory = config.dbPath === ':memory:';
  if (!memory) mkdirSync(config.dbPath, { recursive: true });
  const lite = memory ? new PGlite() : new PGlite(config.dbPath);
  await lite.waitReady;
  return {
    kind: 'pglite',
    query: (sql, params) => lite.query<Row>(sql, params),
    exec: async (sql) => void (await lite.exec(sql)),
    close: () => lite.close(),
  };
}

/** Postgres nie przyjmuje znaku NUL (\0) w TEXT/JSONB – treści z internetu go czasem zawierają. */
const stripNul = (v: unknown): unknown => (typeof v === 'string' ? v.replace(/\u0000/g, '') : v);

let ready: Promise<Driver> | null = null;
function driver(): Promise<Driver> {
  ready ??= openDriver().then(async (d) => {
    await d.exec(SCHEMA);
    return d;
  });
  return ready;
}

const instance: Db = {
  get kind() {
    return config.databaseUrl ? 'postgres' : 'pglite';
  },
  async query<T = Row>(sql: string, params: unknown[] = []) {
    const d = await driver();
    return (await d.query(sql, params.map(stripNul))).rows as T[];
  },
  async one<T = Row>(sql: string, params: unknown[] = []) {
    return (await instance.query<T>(sql, params))[0];
  },
  async exec(sql: string) {
    await (await driver()).exec(sql);
  },
  async close() {
    if (ready) await (await ready).close();
    ready = null;
  },
};

export function db(): Db {
  return instance;
}

export const now = () => new Date().toISOString();
export const newId = () => randomUUID();

/** Znacznik czasu z bazy (Date lub tekst) → ISO 8601. */
export function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

/** Serializacja do kolumny JSONB (bez znaków NUL, których Postgres nie akceptuje). */
// NUL usuwamy z wartości przed serializacją. Wycinanie sekwencji "\u0000" z gotowego JSON-a psuło
// teksty zawierające dosłownie „\u0000” (np. kod w gistach/README): JSON "\\u0000" tracił 6 znaków
// i zostawał samotny backslash – niepoprawny JSON i przebieg kończył się błędem.
const nulFree = (_k: string, val: unknown) => (typeof val === 'string' && val.includes('\u0000') ? val.replace(/\u0000/g, '') : val);
export function toJsonb(v: unknown): string {
  return JSON.stringify(v, nulFree);
}

export async function audit(action: string, detail: unknown): Promise<void> {
  try {
    await db().query('INSERT INTO audit_log (action, detail) VALUES ($1, $2::jsonb)', [action, toJsonb(detail ?? null)]);
  } catch {
    /* dziennik nie może przerwać operacji użytkownika */
  }
}
