// Analizy (sprawy), przebiegi, cykliczne uruchamianie i porównywanie wyników (PostgreSQL).
import { audit, db, iso, newId, now, toJsonb, type Row } from '../db/db.ts';
import { config } from '../config.ts';
import type { Identifier } from '../extract/identifiers.ts';
import { refreshCustomLabels } from '../chain/labels.ts';
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
const nextRun = (minutes: number | null) => (minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null);

function rowToInv(r: Row): Investigation {
  return {
    id: String(r.id),
    name: String(r.name),
    caseRef: (r.case_ref as string) ?? null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    scheduleMinutes: (r.schedule_minutes as number) ?? null,
    nextRunAt: iso(r.next_run_at),
    options: { ...DEFAULT_OPTIONS, ...((r.options as Partial<InvestigationOptions>) ?? {}) },
    seeds: (r.seeds as Identifier[]) ?? [],
  };
}

function rowToRun(r: Row): RunRow {
  return {
    id: String(r.id),
    investigationId: String(r.investigation_id),
    seq: Number(r.seq),
    trigger: r.trigger as RunRow['trigger'],
    status: r.status as RunRow['status'],
    startedAt: iso(r.started_at)!,
    finishedAt: iso(r.finished_at),
    error: (r.error as string) ?? null,
  };
}

export async function listInvestigations() {
  // Ostatni zakończony przebieg pobieramy częściowo (statystyki + najwyższy niewykluczony wynik),
  // żeby lista spraw nie przesyłała z bazy pełnych wyników JSON.
  const rows = await db().query(
    `SELECT i.*,
            (SELECT COUNT(*) FROM runs r WHERE r.investigation_id = i.id) AS run_count,
            (SELECT r.status FROM runs r WHERE r.investigation_id = i.id ORDER BY seq DESC LIMIT 1) AS last_status,
            last.result -> 'stats' AS last_stats,
            (SELECT MAX((a -> 'score' ->> 'score')::int) FROM jsonb_array_elements(last.result -> 'addresses') a
              WHERE NOT (a -> 'score' ->> 'excluded')::boolean) AS top_score
     FROM investigations i
     LEFT JOIN LATERAL (SELECT r.result FROM runs r WHERE r.investigation_id = i.id AND r.status = 'done' ORDER BY seq DESC LIMIT 1) last ON true
     WHERE i.deleted_at IS NULL
     ORDER BY i.updated_at DESC`,
  );
  return rows.map((r) => ({
    ...rowToInv(r),
    runCount: Number(r.run_count),
    lastStatus: (r.last_status as string) ?? null,
    lastStats: (r.last_stats as Record<string, number>) ?? null,
    topScore: r.top_score === null || r.top_score === undefined ? null : Number(r.top_score),
  }));
}

export async function getInvestigation(id: string): Promise<Investigation | null> {
  // analiza w koszu jest dla reszty aplikacji niewidoczna (404), dopóki nie zostanie przywrócona
  const r = await db().one('SELECT * FROM investigations WHERE id = $1 AND deleted_at IS NULL', [id]);
  return r ? rowToInv(r) : null;
}

export async function createInvestigation(input: { name: string; caseRef?: string; seeds: Identifier[]; options?: Partial<InvestigationOptions>; scheduleMinutes?: number | null }): Promise<Investigation> {
  const id = newId();
  const ts = now();
  const sched = input.scheduleMinutes && input.scheduleMinutes > 0 ? input.scheduleMinutes : null;
  await db().query(
    `INSERT INTO investigations (id, name, case_ref, created_at, updated_at, schedule_minutes, next_run_at, options, seeds)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7::jsonb, $8::jsonb)`,
    [id, input.name, input.caseRef ?? null, ts, sched, nextRun(sched), toJsonb({ ...DEFAULT_OPTIONS, ...input.options }), toJsonb(input.seeds)],
  );
  await audit('investigation.create', { id, name: input.name, seeds: input.seeds.length });
  return (await getInvestigation(id))!;
}

export async function updateSchedule(id: string, minutes: number | null) {
  const sched = minutes && minutes > 0 ? minutes : null;
  await db().query('UPDATE investigations SET schedule_minutes = $1, next_run_at = $2, updated_at = $3 WHERE id = $4', [sched, nextRun(sched), now(), id]);
  await audit('investigation.schedule', { id, minutes: sched });
}

/** Analityk zatwierdza host strony ujawnionej w pivocie – zapisywane w parametrach analizy (audyt). */
export async function approveHost(id: string, host: string): Promise<Investigation | null> {
  const inv = await getInvestigation(id);
  if (!inv) return null;
  const hosts = [...new Set([...(inv.options.approvedHosts ?? []), host.toLowerCase()])];
  await db().query('UPDATE investigations SET options = $1::jsonb, updated_at = $2 WHERE id = $3', [toJsonb({ ...inv.options, approvedHosts: hosts }), now(), id]);
  await audit('investigation.approve-host', { id, host });
  return getInvestigation(id);
}

/** Trwałe usunięcie analizy razem z przebiegami i dokumentami (ON DELETE CASCADE). */
export async function deleteInvestigation(id: string) {
  await db().query('DELETE FROM investigations WHERE id = $1', [id]);
  await audit('investigation.delete', { id });
}

// ---------------- Kosz ----------------
/** Ile dni analiza leży w koszu, zanim zostanie usunięta na stałe. */
export const TRASH_DAYS = 30;

export interface TrashItem {
  id: string;
  name: string;
  caseRef: string | null;
  deletedAt: string;
  purgeAt: string;
  runCount: number;
}

/** Przeniesienie do kosza: analiza znika z listy, harmonogram jej nie uruchamia; można ją przywrócić przez TRASH_DAYS dni. */
export async function trashInvestigation(id: string): Promise<boolean> {
  const rows = await db().query('UPDATE investigations SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id', [id]);
  if (rows.length) await audit('investigation.trash', { id });
  return rows.length > 0;
}

export async function restoreInvestigation(id: string): Promise<boolean> {
  // po przywróceniu analiza cykliczna nie nadrabia zaległych przebiegów: następny termin liczony od teraz
  const rows = await db().query(
    `UPDATE investigations SET deleted_at = NULL, updated_at = now(),
       next_run_at = CASE WHEN schedule_minutes IS NULL THEN NULL ELSE now() + make_interval(mins => schedule_minutes) END
     WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id`,
    [id],
  );
  if (rows.length) await audit('investigation.restore', { id });
  return rows.length > 0;
}

export async function listTrash(): Promise<TrashItem[]> {
  const rows = await db().query(
    `SELECT i.id, i.name, i.case_ref, i.deleted_at,
            (SELECT COUNT(*) FROM runs r WHERE r.investigation_id = i.id) AS run_count
     FROM investigations i WHERE i.deleted_at IS NOT NULL ORDER BY i.deleted_at DESC`,
  );
  return rows.map((r) => {
    const deletedAt = iso(r.deleted_at)!;
    return {
      id: String(r.id),
      name: String(r.name),
      caseRef: (r.case_ref as string) ?? null,
      deletedAt,
      purgeAt: new Date(Date.parse(deletedAt) + TRASH_DAYS * 86_400_000).toISOString(),
      runCount: Number(r.run_count),
    };
  });
}

/** Trwałe usunięcie analizy, która jest w koszu (analizy spoza kosza nie da się tak skasować). */
export async function purgeTrashed(id: string): Promise<boolean> {
  const rows = await db().query('DELETE FROM investigations WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id', [id]);
  if (rows.length) await audit('investigation.purge', { id });
  return rows.length > 0;
}

/** Usuwa na stałe analizy leżące w koszu dłużej niż TRASH_DAYS dni. */
export async function purgeExpiredTrash(): Promise<number> {
  const rows = await db().query(
    `DELETE FROM investigations WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => ${TRASH_DAYS}) RETURNING id`,
  );
  if (rows.length) await audit('trash.purge-expired', { count: rows.length });
  return rows.length;
}

export async function listRuns(investigationId: string): Promise<RunRow[]> {
  const rows = await db().query(
    `SELECT id, investigation_id, seq, trigger, status, started_at, finished_at, error, result -> 'stats' AS stats
     FROM runs WHERE investigation_id = $1 ORDER BY seq DESC`,
    [investigationId],
  );
  return rows.map((r) => ({ ...rowToRun(r), progress: progress.get(String(r.id)), stats: (r.stats as Record<string, number>) ?? undefined }));
}

export async function getRunResult(runId: string): Promise<{ run: RunRow; result: RunResult; investigation: Investigation } | null> {
  const r = await db().one('SELECT * FROM runs WHERE id = $1', [runId]);
  if (!r || !r.result) return null;
  const inv = await getInvestigation(String(r.investigation_id));
  if (!inv) return null;
  return { run: rowToRun(r), result: r.result as RunResult, investigation: inv };
}

export async function getDocument(runId: string, docId: string) {
  const d = await db().one('SELECT * FROM documents WHERE run_id = $1 AND id = $2', [runId, `${runId}:${docId}`]);
  return d ? { ...d, fetched_at: iso(d.fetched_at) } : undefined;
}

const running = new Set<string>();

/** Uruchamia przebieg w tle; zwraca id przebiegu natychmiast po zapisaniu go w bazie. */
export async function startRun(investigationId: string, trigger: RunRow['trigger']): Promise<string> {
  const inv = await getInvestigation(investigationId);
  if (!inv) throw new Error('Nie znaleziono analizy');
  if (running.has(investigationId)) throw new Error('Przebieg tej analizy już trwa');
  running.add(investigationId);
  const runId = newId();
  try {
    const last = await db().one<{ m: number }>('SELECT COALESCE(MAX(seq), 0) AS m FROM runs WHERE investigation_id = $1', [investigationId]);
    const seq = Number(last?.m ?? 0) + 1;
    await db().query('INSERT INTO runs (id, investigation_id, seq, trigger, status, started_at) VALUES ($1, $2, $3, $4, $5, $6)', [runId, investigationId, seq, trigger, 'running', now()]);
    await db().query('UPDATE investigations SET updated_at = $1 WHERE id = $2', [now(), investigationId]);
    await audit('run.start', { investigationId, runId, seq, trigger });
  } catch (e) {
    running.delete(investigationId);
    throw e;
  }
  void (async () => {
    try {
      await refreshCustomLabels(); // etykiety analityków aktualne na start przebiegu
      const { result, storedDocs } = await runInvestigation(inv.seeds, inv.options, (m) => progress.set(runId, m));
      for (const d of storedDocs)
        await db().query(
          'INSERT INTO documents (id, run_id, source, url, title, author, published_at, fetched_at, sha256, content) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [`${runId}:${d.id}`, runId, d.source, d.url, d.title, d.author ?? null, d.publishedAt ?? null, d.fetchedAt, d.sha256, d.content],
        );
      await db().query('UPDATE runs SET status = $1, finished_at = $2, result = $3::jsonb WHERE id = $4', ['done', now(), toJsonb(result), runId]);
      await audit('run.done', { runId, stats: result.stats });
    } catch (e) {
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      await db()
        .query('UPDATE runs SET status = $1, finished_at = $2, error = $3 WHERE id = $4', ['error', now(), msg, runId])
        .catch(() => {});
      await audit('run.error', { runId, error: msg });
    } finally {
      running.delete(investigationId);
      progress.delete(runId);
    }
  })();
  return runId;
}

// ---------------- Porównanie przebiegów ----------------
export async function compareRuns(aId: string, bId: string) {
  const a = await getRunResult(aId);
  const b = await getRunResult(bId);
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
  let busy = false;
  let lastPurge = 0;
  return setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      // sprzątanie kosza raz na godzinę (i przy pierwszym cyklu po starcie)
      if (Date.now() - lastPurge > 3_600_000) {
        lastPurge = Date.now();
        await purgeExpiredTrash();
      }
      // UPDATE … RETURNING: termin przesuwany atomowo – przy kilku instancjach API przebieg nie uruchomi się podwójnie.
      const due = await db().query<{ id: string }>(
        `UPDATE investigations SET next_run_at = now() + make_interval(mins => schedule_minutes)
         WHERE schedule_minutes IS NOT NULL AND deleted_at IS NULL AND next_run_at <= now() RETURNING id`,
      );
      for (const d of due) await startRun(d.id, 'schedule').catch(() => {}); // przebieg już trwa – kolejna próba w następnym cyklu
    } catch {
      /* baza chwilowo niedostępna – kolejna próba w następnym cyklu */
    } finally {
      busy = false;
    }
  }, config.schedulerTickMs);
}
