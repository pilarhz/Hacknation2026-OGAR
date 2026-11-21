// Warstwa danych prototypu: SQLite (wbudowany node:sqlite – zero zależności natywnych; moduł wciąż
// oznaczony w Node jako eksperymentalny). To ODSTĘPSTWO od preferencji zadania (MySQL/PostgreSQL/
// MongoDB/MS SQL). Zapytania używają składni specyficznej dla SQLite (INSERT OR REPLACE,
// AUTOINCREMENT, PRAGMA), więc migracja na PostgreSQL wymaga przepisania tej warstwy i store.ts.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  schedule_minutes INTEGER,
  next_run_at TEXT,
  options_json TEXT NOT NULL,
  seeds_json TEXT NOT NULL,
  case_ref TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result_json TEXT,
  log_json TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS runs_inv ON runs(investigation_id, seq);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  author TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_run ON documents(run_id);
CREATE TABLE IF NOT EXISTS http_cache (
  url TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  status INTEGER NOT NULL,
  content_type TEXT,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chain_cache (
  key TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_labels (
  key TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT
);
`;

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instance) return instance;
  if (config.dbPath !== ':memory:') mkdirSync(path.dirname(config.dbPath), { recursive: true });
  instance = new DatabaseSync(config.dbPath);
  instance.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  instance.exec(SCHEMA);
  return instance;
}

export const now = () => new Date().toISOString();
export const newId = () => randomUUID();

export function audit(action: string, detail: unknown): void {
  db().prepare('INSERT INTO audit_log (ts, action, detail_json) VALUES (?, ?, ?)').run(now(), action, JSON.stringify(detail));
}

export function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
