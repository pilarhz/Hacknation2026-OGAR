// Test integracyjny warstwy danych (PostgreSQL): sprawy, przebiegi, dokumenty, porównania, etykiety,
// harmonogram, audyt, usuwanie kaskadowe. Domyślnie wbudowany PostgreSQL (PGlite) w pamięci;
// z ustawionym DATABASE_URL ten sam test sprawdza prawdziwy serwer PostgreSQL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4198;
if (!process.env.DATABASE_URL) process.env.DB_PATH = ':memory:';
process.env.SANDBOX_URL = `http://127.0.0.1:${PORT}`;
process.env.CHAIN_LIVE = 'false';
process.env.SCHEDULER_TICK_MS = '300';
const here = path.dirname(fileURLToPath(import.meta.url));
let sandbox: ChildProcess;

const { db } = await import('../src/db/db.ts');
const store = await import('../src/engine/store.ts');
const labels = await import('../src/chain/labels.ts');

before(async () => {
  sandbox = spawn(process.execPath, [path.join(here, '..', '..', 'sandbox', 'server.ts')], { env: { ...process.env, SANDBOX_PORT: String(PORT) }, stdio: 'pipe' });
  await new Promise<void>((resolve, reject) => {
    sandbox.stdout!.on('data', (d) => String(d).includes('Piaskownica') && resolve());
    sandbox.on('error', reject);
    setTimeout(() => reject(new Error('sandbox timeout')), 8000);
  });
  // Czysty stan także na współdzielonym serwerze PostgreSQL.
  await db().exec('TRUNCATE investigations, custom_labels, audit_log, http_cache, chain_cache CASCADE');
});
after(async () => {
  sandbox?.kill();
  await db().close();
});

const waitDone = async (invId: string) => {
  for (let i = 0; i < 100; i++) {
    const runs = await store.listRuns(invId);
    if (runs.length && runs.every((r) => r.status !== 'running')) return runs;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('przebieg nie zakończył się');
};

test('Sprawa → przebieg → wynik JSONB, dokumenty, lista spraw (zapytanie LATERAL/jsonb)', async () => {
  const inv = await store.createInvestigation({ name: 'Test DB', caseRef: 'KAS/1', seeds: [{ kind: 'nick', value: 'cryptojanek' }], options: { sources: ['sandbox', 'web'] } });
  assert.equal(inv.options.sources.join(), 'sandbox,web');
  assert.match(inv.createdAt, /^\d{4}-\d\d-\d\dT/);
  const runId = await store.startRun(inv.id, 'manual');
  await assert.rejects(store.startRun(inv.id, 'manual'), /już trwa/);
  const runs = await waitDone(inv.id);
  assert.equal(runs[0].status, 'done', runs[0].error ?? '');
  assert.equal(runs[0].seq, 1);
  assert.ok(runs[0].stats!.addresses >= 5);

  const r = (await store.getRunResult(runId))!;
  assert.equal(r.investigation.id, inv.id);
  assert.ok(r.result.addresses.some((a) => a.score.score === 99));

  const doc = (await store.getDocument(runId, r.result.documents[0].id)) as { content: string; sha256: string; fetched_at: string };
  assert.ok(doc.content.length > 0);
  assert.equal(doc.sha256, r.result.documents[0].sha256);
  assert.match(doc.fetched_at, /Z$/);

  const list = await store.listInvestigations();
  const item = list.find((x) => x.id === inv.id)!;
  assert.equal(item.runCount, 1);
  assert.equal(item.lastStatus, 'done');
  assert.equal(item.topScore, 99);
  assert.equal(item.lastStats!.addresses, runs[0].stats!.addresses);
});

test('Porównanie przebiegów, zatwierdzanie hosta, etykiety analityka, audyt', async () => {
  const inv = await store.createInvestigation({ name: 'Porównanie', seeds: [{ kind: 'nick', value: 'nowak_btc' }], options: { sources: ['sandbox'] } });
  await store.startRun(inv.id, 'manual');
  await waitDone(inv.id);
  await store.startRun(inv.id, 'manual');
  const runs = await waitDone(inv.id);
  assert.deepEqual(runs.map((r) => r.seq), [2, 1]);
  const cmp = await store.compareRuns(runs[1].id, runs[0].id);
  assert.equal(cmp.newAddresses.length, 0);

  const approved = (await store.approveHost(inv.id, 'Przyklad.Example'))!;
  assert.deepEqual(approved.options.approvedHosts, ['przyklad.example']);

  await labels.addCustomLabel('BTC', 'bc1qfzspkgc3zjlltz2nd32xudvrg38ytx58w9z59w', 'Testowa giełda', 'CEX');
  await labels.addCustomLabel('BTC', 'bc1qfzspkgc3zjlltz2nd32xudvrg38ytx58w9z59w', 'Testowa giełda (poprawiona)', 'CEX'); // upsert
  assert.equal(labels.lookupLabel('BTC', 'bc1qfzspkgc3zjlltz2nd32xudvrg38ytx58w9z59w')?.name, 'Testowa giełda (poprawiona)');
  const all = await labels.listLabels();
  assert.equal(all.custom.length, 1);

  // Etykieta analityka działa w kolejnym przebiegu: adres "zimnego portfela" nowak_btc jest teraz wykluczony.
  await store.startRun(inv.id, 'manual');
  const after3 = await waitDone(inv.id);
  const res = (await store.getRunResult(after3[0].id))!;
  assert.equal(res.result.addresses.find((a) => a.address === 'bc1qfzspkgc3zjlltz2nd32xudvrg38ytx58w9z59w')!.score.band, 'EXCLUDED');

  const audit = await db().query<{ action: string }>('SELECT action FROM audit_log');
  for (const a of ['investigation.create', 'run.start', 'run.done', 'investigation.approve-host']) assert.ok(audit.some((x) => x.action === a), a);
});

test('Harmonogram uruchamia analizę cykliczną; usunięcie sprawy usuwa kaskadowo przebiegi i dokumenty', async () => {
  const inv = await store.createInvestigation({ name: 'Cykliczna', seeds: [{ kind: 'nick', value: 'nowak_btc' }], options: { sources: ['sandbox'] }, scheduleMinutes: 60 });
  await db().query("UPDATE investigations SET next_run_at = now() - interval '1 minute' WHERE id = $1", [inv.id]);
  const timer = store.startScheduler();
  try {
    let runs: Awaited<ReturnType<typeof store.listRuns>> = [];
    for (let i = 0; i < 60 && !runs.length; i++) {
      await new Promise((r) => setTimeout(r, 100));
      runs = await store.listRuns(inv.id);
    }
    assert.equal(runs[0]?.trigger, 'schedule');
    await waitDone(inv.id);
    const next = (await store.getInvestigation(inv.id))!.nextRunAt!;
    assert.ok(Date.parse(next) > Date.now() + 50 * 60_000, 'termin przesunięty o interwał');
  } finally {
    clearInterval(timer);
  }
  await store.trashInvestigation(inv.id);
  assert.equal(await store.purgeTrashed(inv.id), true);
  assert.equal(await store.getInvestigation(inv.id), null);
  const orphans = await db().one<{ n: string }>('SELECT COUNT(*) AS n FROM runs WHERE investigation_id = $1', [inv.id]);
  assert.equal(Number(orphans!.n), 0);
});

test('Kosz: usunięta analiza znika z listy, wraca po przywróceniu, a po 30 dniach jest kasowana na stałe', async () => {
  const inv = await store.createInvestigation({ name: 'kosz-test', seeds: [{ kind: 'nick', value: 'kosz' }] });
  assert.equal(await store.trashInvestigation(inv.id), true);
  assert.equal(await store.trashInvestigation(inv.id), false, 'drugi raz już nic nie robi');
  assert.equal(await store.getInvestigation(inv.id), null, 'analiza w koszu jest niewidoczna');
  assert.ok(!(await store.listInvestigations()).some((i) => i.id === inv.id));
  const item = (await store.listTrash()).find((t) => t.id === inv.id);
  assert.ok(item, 'jest w koszu');
  assert.equal(Date.parse(item!.purgeAt) - Date.parse(item!.deletedAt), store.TRASH_DAYS * 86_400_000);

  assert.equal(await store.restoreInvestigation(inv.id), true);
  assert.ok((await store.listInvestigations()).some((i) => i.id === inv.id), 'wraca na listę');
  assert.ok(!(await store.listTrash()).some((t) => t.id === inv.id));
  assert.equal(await store.purgeTrashed(inv.id), false, 'analizy spoza kosza nie da się skasować na stałe');

  await store.trashInvestigation(inv.id);
  await db().query("UPDATE investigations SET deleted_at = now() - interval '31 days' WHERE id = $1", [inv.id]);
  assert.ok((await store.purgeExpiredTrash()) >= 1);
  const left = await db().one<{ n: string }>('SELECT COUNT(*) AS n FROM investigations WHERE id = $1', [inv.id]);
  assert.equal(Number(left!.n), 0, 'po 30 dniach usunięta na stałe');
});

test('Unieważnienie przebiegu: zostaje w historii z powodem, nie liczy się na liście spraw, da się je cofnąć; poprawa parametrów', async () => {
  const inv = await store.createInvestigation({ name: 'uniewaznienie', seeds: [{ kind: 'nick', value: 'cryptojanek' }], options: { sources: ['sandbox'] } });
  const runId = await store.startRun(inv.id, 'manual');
  assert.equal(await store.invalidateRun(runId, 'wrong-identifier'), 'running', 'trwającego przebiegu nie da się unieważnić');
  await waitDone(inv.id);
  const listed = () => store.listInvestigations().then((l) => l.find((i) => i.id === inv.id)!);
  assert.ok((await listed()).topScore !== null, 'przed unieważnieniem lista pokazuje wynik');

  assert.equal(await store.invalidateRun(runId, 'wrong-identifier', 'literówka w nicku'), 'ok');
  const [run] = await store.listRuns(inv.id);
  assert.equal(run.invalidated?.reason, 'wrong-identifier');
  assert.equal(run.invalidated?.note, 'literówka w nicku');
  assert.equal((await listed()).topScore, null, 'unieważniony przebieg nie jest „najnowszym wynikiem”');
  assert.ok(await store.getRunResult(runId), 'przebieg i jego wynik zostają w bazie');

  assert.equal(await store.revalidateRun(runId), true);
  assert.equal((await store.listRuns(inv.id))[0].invalidated, null);
  assert.equal(await store.revalidateRun(runId), false);

  const upd = await store.updateInvestigation(inv.id, { name: 'uniewaznienie (poprawione)', caseRef: 'RP/1', seeds: [{ kind: 'nick', value: 'nowak_btc' }], options: { sources: ['sandbox'] } });
  assert.equal(upd?.name, 'uniewaznienie (poprawione)');
  assert.equal(upd?.seeds[0].value, 'nowak_btc');
  assert.equal(upd?.caseRef, 'RP/1');
  assert.equal((await store.listRuns(inv.id)).length, 1, 'poprawa parametrów nie rusza istniejących przebiegów');
  await store.trashInvestigation(inv.id);
  await store.purgeTrashed(inv.id);
});

test('Znak NUL w treści z internetu nie psuje zapisu (Postgres go nie akceptuje w TEXT/JSONB)', async () => {
  const { toJsonb } = await import('../src/db/db.ts');
  await db().query('INSERT INTO http_cache (url, fetched_at, status, content_type, body) VALUES ($1, now(), 200, $2, $3)', ['https://nul.example/', 'text/plain', 'a\u0000b']);
  const row = await db().one<{ body: string }>('SELECT body FROM http_cache WHERE url = $1', ['https://nul.example/']);
  assert.equal(row!.body, 'ab');
  await db().query('INSERT INTO chain_cache (key, fetched_at, data) VALUES ($1, now(), $2::jsonb)', ['X:nul', toJsonb({ s: 'a\u0000b' })]);
});
