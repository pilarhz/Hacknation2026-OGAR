// Analizy (sprawy), przebiegi, cykliczne uruchamianie i porównywanie wyników.
import { audit, db, json, newId, now } from '../db/db.ts';
import { config } from '../config.ts';
import type { Identifier } from '../extract/identifiers.ts';
import { DEFAULT_OPTIONS, runInvestigation, type InvestigationOptions, type RunResult } from './investigate.ts';

export interface Investigation {
  id: string;
  name: string;
  caseRef: string | null;
  createdAt: string;
  updatedAt: string;
  scheduleMinutes: number | null;
  nextRunAt: string | null;
  options: InvestigationOptions;
  seeds: Identifier[];
}

export interface RunRow {
  id: string;
  investigationId: string;
  seq: number;
  trigger: 'manual' | 'schedule';
  status: 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  progress?: string;
  stats?: Record<string, number>;
}

const progress = new Map<string, string>();

function rowToInv(r: Record<string, unknown>): Investigation {
  return {
    id: String(r.id),
    name: String(r.name),
    caseRef: (r.case_ref as string) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    scheduleMinutes: (r.schedule_minutes as number) ?? null,
    nextRunAt: (r.next_run_at as string) ?? null,
    options: { ...DEFAULT_OPTIONS, ...json<Partial<InvestigationOptions>>(r.options_json, {}) },
    seeds: json<Identifier[]>(r.seeds_json, []),
  };
}

export function listInvestigations() {
  const rows = db()
    .prepare(
      `SELECT i.*, (SELECT COUNT(*) FROM runs r WHERE r.investigation_id = i.id) AS run_count,
              (SELECT r.result_json FROM runs r WHERE r.investigation_id = i.id AND r.status = 'done' ORDER BY seq DESC LIMIT 1) AS last_result,
              (SELECT r.status FROM runs r WHERE r.investigation_id = i.id ORDER BY seq DESC LIMIT 1) AS last_status
       FROM investigations i ORDER BY i.updated_at DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => {
    const last = json<RunResult | null>(r.last_result, null);
    return { ...rowToInv(r), runCount: Number(r.run_count), lastStatus: r.last_status ?? null, lastStats: last?.stats ?? null, topScore: last?.addresses.find((a) => !a.score.excluded)?.score.score ?? null };
  });
}

export function getInvestigation(id: string): Investigation | null {
  const r = db().prepare('SELECT * FROM investigations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? rowToInv(r) : null;
}

export function createInvestigation(input: { name: string; caseRef?: string; seeds: Identifier[]; options?: Partial<InvestigationOptions>; scheduleMinutes?: number | null }): Investigation {
  const id = newId();
  const ts = now();
  const sched = input.scheduleMinutes && input.scheduleMinutes > 0 ? input.scheduleMinutes : null;
  db()
    .prepare('INSERT INTO investigations (id, name, created_at, updated_at, schedule_minutes, next_run_at, options_json, seeds_json, case_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.name, ts, ts, sched, sched ? new Date(Date.now() + sched * 60_000).toISOString() : null, JSON.stringify({ ...DEFAULT_OPTIONS, ...input.options }), JSON.stringify(input.seeds), input.caseRef ?? null);
  audit('investigation.create', { id, name: input.name, seeds: input.seeds.length });
  return getInvestigation(id)!;
}

export function updateSchedule(id: string, minutes: number | null) {
  const sched = minutes && minutes > 0 ? minutes : null;
  db().prepare('UPDATE investigations SET schedule_minutes = ?, next_run_at = ?, updated_at = ? WHERE id = ?').run(sched, sched ? new Date(Date.now() + sched * 60_000).toISOString() : null, now(), id);
  audit('investigation.schedule', { id, minutes: sched });
}

/** Analityk zatwierdza host strony ujawnionej w pivocie – zapisywane w parametrach analizy (audyt). */
export function approveHost(id: string, host: string): Investigation | null {
  const inv = getInvestigation(id);
  if (!inv) return null;
  const hosts = [...new Set([...(inv.options.approvedHosts ?? []), host.toLowerCase()])];
  db().prepare('UPDATE investigations SET options_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...inv.options, approvedHosts: hosts }), now(), id);
  audit('investigation.approve-host', { id, host });
  return getInvestigation(id);
}

export function deleteInvestigation(id: string) {
  db().prepare('DELETE FROM investigations WHERE id = ?').run(id);
  audit('investigation.delete', { id });
}

export function listRuns(investigationId: string): RunRow[] {
  const rows = db().prepare('SELECT id, investigation_id, seq, trigger, status, started_at, finished_at, error, result_json FROM runs WHERE investigation_id = ? ORDER BY seq DESC').all(investigationId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    investigationId: String(r.investigation_id),
    seq: Number(r.seq),
    trigger: r.trigger as RunRow['trigger'],
    status: r.status as RunRow['status'],
    startedAt: String(r.started_at),
    finishedAt: (r.finished_at as string) ?? null,
    error: (r.error as string) ?? null,
    progress: progress.get(String(r.id)),
    stats: json<RunResult | null>(r.result_json, null)?.stats,
  }));
}

export function getRunResult(runId: string): { run: RunRow; result: RunResult; investigation: Investigation } | null {
  const r = db().prepare('SELECT * FROM runs WHERE id = ?').get(runId) as Record<string, unknown> | undefined;
  if (!r || !r.result_json) return null;
  const inv = getInvestigation(String(r.investigation_id));
  if (!inv) return null;
  return {
    run: { id: String(r.id), investigationId: String(r.investigation_id), seq: Number(r.seq), trigger: r.trigger as RunRow['trigger'], status: r.status as RunRow['status'], startedAt: String(r.started_at), finishedAt: (r.finished_at as string) ?? null, error: (r.error as string) ?? null },
    result: json<RunResult>(r.result_json, null as unknown as RunResult),
    investigation: inv,
  };
}

export function getDocument(runId: string, docId: string) {
  return db().prepare('SELECT * FROM documents WHERE run_id = ? AND id = ?').get(runId, `${runId}:${docId}`) as Record<string, unknown> | undefined;
}

const running = new Set<string>();

/** Uruchamia przebieg w tle; zwraca id przebiegu natychmiast. */
export function startRun(investigationId: string, trigger: RunRow['trigger']): string {
  const inv = getInvestigation(investigationId);
  if (!inv) throw new Error('Nie znaleziono analizy');
  if (running.has(investigationId)) throw new Error('Przebieg tej analizy już trwa');
  const seq = Number((db().prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM runs WHERE investigation_id = ?').get(investigationId) as { m: number }).m) + 1;
  const runId = newId();
  db().prepare('INSERT INTO runs (id, investigation_id, seq, trigger, status, started_at) VALUES (?, ?, ?, ?, ?, ?)').run(runId, investigationId, seq, trigger, 'running', now());
  db().prepare('UPDATE investigations SET updated_at = ? WHERE id = ?').run(now(), investigationId);
  audit('run.start', { investigationId, runId, seq, trigger });
  running.add(investigationId);
  void (async () => {
    try {
      const { result, storedDocs } = await runInvestigation(inv.seeds, inv.options, (m) => progress.set(runId, m));
      const ins = db().prepare('INSERT INTO documents (id, run_id, source, url, title, author, published_at, fetched_at, sha256, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const d of storedDocs) ins.run(`${runId}:${d.id}`, runId, d.source, d.url, d.title, d.author ?? null, d.publishedAt ?? null, d.fetchedAt, d.sha256, d.content);
      db().prepare('UPDATE runs SET status = ?, finished_at = ?, result_json = ? WHERE id = ?').run('done', now(), JSON.stringify(result), runId);
      audit('run.done', { runId, stats: result.stats });
    } catch (e) {
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      db().prepare('UPDATE runs SET status = ?, finished_at = ?, error = ? WHERE id = ?').run('error', now(), msg, runId);
      audit('run.error', { runId, error: msg });
    } finally {
      running.delete(investigationId);
      progress.delete(runId);
    }
  })();
  return runId;
}

// ---------------- Porównanie przebiegów ----------------
export function compareRuns(aId: string, bId: string) {
  const a = getRunResult(aId);
  const b = getRunResult(bId);
  if (!a || !b) throw new Error('Nie znaleziono przebiegu');
  const ka = new Map(a.result.addresses.map((x) => [x.key, x]));
  const kb = new Map(b.result.addresses.map((x) => [x.key, x]));
  const newAddresses = [...kb.values()].filter((x) => !ka.has(x.key)).map((x) => ({ key: x.key, chain: x.chain, address: x.address, score: x.score.score, band: x.score.bandLabel }));
  const removedAddresses = [...ka.values()].filter((x) => !kb.has(x.key)).map((x) => ({ key: x.key, chain: x.chain, address: x.address, score: x.score.score, band: x.score.bandLabel }));
  const scoreChanges = [...kb.values()]
    .filter((x) => ka.has(x.key) && ka.get(x.key)!.score.score !== x.score.score)
    .map((x) => ({ key: x.key, chain: x.chain, address: x.address, before: ka.get(x.key)!.score.score, after: x.score.score }));
  // Zmiany adresów na tych samych stronach (np. podmiana portfela w profilu).
  const addrByUrl = (res: RunResult) => {
    const m = new Map<string, Set<string>>();
    for (const ad of res.addresses) for (const e of ad.evidence) if (e.attribution === 'subject') (m.get(e.url) ?? m.set(e.url, new Set()).get(e.url)!).add(ad.key);
    return m;
  };
  const ua = addrByUrl(a.result);
  const ub = addrByUrl(b.result);
  const pageChanges: { url: string; removed: string[]; added: string[] }[] = [];
  for (const url of new Set([...ua.keys(), ...ub.keys()])) {
    const before = ua.get(url) ?? new Set();
    const after = ub.get(url) ?? new Set();
    const removed = [...before].filter((k) => !after.has(k));
    const added = [...after].filter((k) => !before.has(k));
    if ((removed.length || added.length) && ua.has(url) && ub.has(url)) pageChanges.push({ url, removed, added });
  }
  const docsA = new Map(a.result.documents.map((d) => [d.url, d]));
  const docsB = new Map(b.result.documents.map((d) => [d.url, d]));
  const changedDocs = [...docsB.values()].filter((d) => docsA.has(d.url) && docsA.get(d.url)!.sha256 !== d.sha256).map((d) => ({ url: d.url, title: d.title }));
  const newDocs = [...docsB.values()].filter((d) => !docsA.has(d.url)).map((d) => ({ url: d.url, title: d.title }));
  const goneDocs = [...docsA.values()].filter((d) => !docsB.has(d.url)).map((d) => ({ url: d.url, title: d.title }));
  const idsA = new Set(a.result.identifiers.map((i) => `${i.kind}:${i.value.toLowerCase()}`));
  const newIdentifiers = b.result.identifiers.filter((i) => !idsA.has(`${i.kind}:${i.value.toLowerCase()}`));
  const sigA = new Set(a.result.addresses.flatMap((x) => x.indicators.filter((i) => i.cashOut).map((i) => `${x.key}|${i.code}`)));
  const newCashOut = b.result.addresses.flatMap((x) => x.indicators.filter((i) => i.cashOut && !sigA.has(`${x.key}|${i.code}`)).map((i) => ({ address: x.address, title: i.title, detail: i.detail })));
  return {
    a: { id: a.run.id, seq: a.run.seq, at: a.result.finishedAt },
    b: { id: b.run.id, seq: b.run.seq, at: b.result.finishedAt },
    newAddresses,
    removedAddresses,
    scoreChanges,
    pageChanges,
    changedDocs,
    newDocs,
    goneDocs,
    newIdentifiers,
    newCashOut,
  };
}

// ---------------- Harmonogram (cykliczne analizy) ----------------
export function startScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    const due = db().prepare("SELECT id, schedule_minutes FROM investigations WHERE schedule_minutes IS NOT NULL AND next_run_at <= ?").all(now()) as { id: string; schedule_minutes: number }[];
    for (const d of due) {
      db().prepare('UPDATE investigations SET next_run_at = ? WHERE id = ?').run(new Date(Date.now() + d.schedule_minutes * 60_000).toISOString(), d.id);
      try {
        startRun(d.id, 'schedule');
      } catch {
        /* przebieg już trwa – następna próba w kolejnym cyklu */
      }
    }
  }, config.schedulerTickMs);
}
