// Klient REST API. Typy z backendu (import tylko typów – kod serwera nie trafia do bundla).
import type { RunResult, AddressResult, InvestigationOptions } from '../../api/src/engine/investigate.ts';
import type { Investigation, InvalidReason, RunRow, TrashItem } from '../../api/src/engine/store.ts';

export type { RunResult, AddressResult, InvestigationOptions, Investigation, InvalidReason, RunRow, TrashItem };

/** Powody unieważnienia przebiegu (te same kody co INVALID_REASONS na serwerze). */
export const INVALID_REASON_LABELS: Record<InvalidReason, string> = {
  'wrong-identifier': 'Błędny identyfikator',
  'wrong-sources': 'Złe źródła lub parametry',
  technical: 'Błąd techniczny',
  other: 'Inny powód',
};

export interface Meta {
  sources: { id: string; label: string; description: string; accepts: string[]; hosts: string[]; synthetic: boolean; available: boolean; note: string | null }[];
  identifierKinds: { id: string; label: string }[];
  contexts: Record<string, { label: string; base: number; band: string }>;
  bands: Record<string, string>;
  scoringParams: Record<string, number>;
  categories: Record<string, string>;
  defaults: InvestigationOptions;
  config: { database?: string; chainLive: boolean; ai: string; aiModel: string | null; sandboxUrl: string; allowedHosts: string[]; searxng: boolean };
}

export type InvestigationListItem = Investigation & { runCount: number; lastStatus: string | null; lastStats: Record<string, number> | null; topScore: number | null };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  // Token jest w ciasteczku HttpOnly (/api/login). Content-Type tylko z treścią – Fastify odrzuca JSON z pustym body.
  const headers = { ...(init?.body != null ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) };
  const res = await fetch(url, { credentials: 'same-origin', ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string; message?: string }).error ?? (body as { message?: string }).message ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

// Sygnał „lista analiz się zmieniła” – menu boczne i lista odświeżają się od razu, bez czekania na odpytanie.
export const INVESTIGATIONS_CHANGED = 'ogar:investigations-changed';
const notifyInvestigationsChanged = () => window.dispatchEvent(new Event(INVESTIGATIONS_CHANGED));
const changed = async <T,>(p: Promise<T>) => {
  const r = await p;
  notifyInvestigationsChanged();
  return r;
};

export const api = {
  login: (token: string) => req<{ ok: boolean }>('/api/login', { method: 'POST', body: JSON.stringify({ token }) }),
  approveHost: (id: string, host: string) => req(`/api/investigations/${id}/approved-hosts`, { method: 'POST', body: JSON.stringify({ host }) }),
  meta: () => req<Meta>('/api/meta'),
  list: () => req<InvestigationListItem[]>('/api/investigations'),
  create: (body: { name: string; caseRef?: string; seeds: { kind: string; value: string }[]; options: Partial<InvestigationOptions>; scheduleMinutes: number | null }) =>
    changed(req<{ investigation: Investigation; runId: string }>('/api/investigations', { method: 'POST', body: JSON.stringify(body) })),
  get: (id: string) => req<{ investigation: Investigation; runs: RunRow[] }>(`/api/investigations/${id}`),
  /** Przenosi analizę do kosza (przywracalna przez `trashDays` dni). */
  remove: (id: string) => changed(req<{ ok: boolean; trashDays: number }>(`/api/investigations/${id}`, { method: 'DELETE' })),
  trash: () => req<{ days: number; items: TrashItem[] }>('/api/trash'),
  restore: (id: string) => changed(req<{ ok: boolean }>(`/api/trash/${id}/restore`, { method: 'POST', body: '{}' })),
  purge: (id: string) => changed(req<{ ok: boolean }>(`/api/trash/${id}`, { method: 'DELETE' })),
  schedule: (id: string, minutes: number | null) => req(`/api/investigations/${id}/schedule`, { method: 'PUT', body: JSON.stringify({ minutes }) }),
  rerun: (id: string) => req<{ runId: string }>(`/api/investigations/${id}/runs`, { method: 'POST', body: '{}' }),
  run: (id: string) => req<{ run: RunRow; result: RunResult; investigation: Investigation }>(`/api/runs/${id}`),
  document: (runId: string, docId: string) => req<{ content: string; url: string; title: string; sha256: string; fetched_at: string }>(`/api/runs/${runId}/documents/${docId}`),
  /** Poprawienie parametrów analizy; opcjonalnie nowy przebieg i unieważnienie poprzedniego. */
  update: (
    id: string,
    body: { name: string; caseRef: string | null; seeds: { kind: string; value: string }[]; options: Partial<InvestigationOptions>; rerun?: boolean; invalidateRunId?: string; invalidReason?: InvalidReason; invalidNote?: string },
  ) => changed(req<{ investigation: Investigation; runId: string | null }>(`/api/investigations/${id}`, { method: 'PUT', body: JSON.stringify(body) })),
  invalidateRun: (runId: string, reason: InvalidReason, note?: string) => changed(req<{ ok: boolean }>(`/api/runs/${runId}/invalidate`, { method: 'POST', body: JSON.stringify({ reason, note }) })),
  revalidateRun: (runId: string) => changed(req<{ ok: boolean }>(`/api/runs/${runId}/revalidate`, { method: 'POST', body: '{}' })),
  compare: (a: string, b: string) => req<CompareResult>(`/api/compare?a=${a}&b=${b}`),
  extract: (text: string) => req<ExtractResult>('/api/extract', { method: 'POST', body: JSON.stringify({ text }) }),
  labels: () => req<{ custom: LabelRow[]; seed: LabelRow[] }>('/api/labels'),
  addLabel: (body: { chain: string; address: string; name: string; category: string; note?: string }) => req('/api/labels', { method: 'POST', body: JSON.stringify(body) }),
};

export interface LabelRow {
  chain: string;
  address: string;
  name: string;
  category: string;
  origin?: string;
  synthetic?: boolean;
  note?: string;
  added_at?: string;
}

export interface CompareResult {
  a: { id: string; seq: number; at: string };
  b: { id: string; seq: number; at: string };
  newAddresses: { key: string; chain: string; address: string; score: number; band: string }[];
  removedAddresses: { key: string; chain: string; address: string; score: number; band: string }[];
  scoreChanges: { key: string; chain: string; address: string; before: number; after: number }[];
  pageChanges: { url: string; removed: string[]; added: string[] }[];
  changedDocs: { url: string; title: string }[];
  newDocs: { url: string; title: string }[];
  goneDocs: { url: string; title: string }[];
  newIdentifiers: { kind: string; value: string }[];
  newCashOut: { address: string; title: string; detail: string }[];
}

export interface ExtractResult {
  matches: { chain: string; address: string; format: string; checksum: string; formatConfidence: string; context: string; notes: string[] }[];
  rejected: { candidate: string; reason: string }[];
  identifiers: { kind: string; value: string }[];
}

export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pl-PL') : '—');
export const fmtNum = (n?: number | null, max = 6) => (n === null || n === undefined ? '—' : n.toLocaleString('pl-PL', { maximumFractionDigits: max }));
/** Jak isAttributed w scoring/confidence.ts (bundle web importuje z backendu tylko typy). */
export const isAttributed = (a: AddressResult) => !a.score.excluded && a.score.score >= 40;
export const shortAddr = (a: string) => (a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a);
export const SCHEDULES: [number, string][] = [
  [0, 'ręcznie'],
  [1, 'co 1 min (demo)'],
  [60, 'co godzinę'],
  [1440, 'codziennie'],
  [10080, 'co tydzień'],
];
export const fmtSchedule = (m?: number | null) => (!m ? 'ręcznie' : (SCHEDULES.find(([v]) => v === m)?.[1] ?? `co ${m} min`));
