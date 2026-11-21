// REST API OGAR + serwowanie zbudowanego frontendu (apps/web/dist).
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { config, REPO_ROOT } from './config.ts';
import { audit, db, iso } from './db/db.ts';
import { describeSources } from './sources/registry.ts';
import { IDENTIFIER_LABELS, extractIdentifiers, type IdentifierKind } from './extract/identifiers.ts';
import { extractAddresses } from './extract/addresses.ts';
import { CONTEXT_INFO } from './scoring/context.ts';
import { BANDS, SCORING_PARAMS } from './scoring/confidence.ts';
import { CATEGORY_LABELS, type LabelCategory } from './chain/types.ts';
import { addCustomLabel, listLabels, refreshCustomLabels } from './chain/labels.ts';
import { DEFAULT_OPTIONS } from './engine/investigate.ts';
import {
  approveHost,
  compareRuns,
  createInvestigation,
  deleteInvestigation,
  getDocument,
  getInvestigation,
  getRunResult,
  listInvestigations,
  listRuns,
  startRun,
  startScheduler,
  updateSchedule,
} from './engine/store.ts';
import { renderReport } from './report/report.ts';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 1_000_000 });
await app.register(cors, { origin: [/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/] });

// Opcjonalny token API (w środowisku KAS – zastąpiony SSO/reverse proxy).
// Token przyjmujemy w nagłówku X-Api-Token albo w ciasteczku HttpOnly ustawianym przez /api/login –
// NIGDY w adresie URL (trafiałby do logów i historii przeglądarki).
const API_TOKEN = process.env.API_TOKEN;
const COOKIE = 'ogar_token';
const tokenOk = (v: unknown) => {
  if (!API_TOKEN || typeof v !== 'string') return false;
  const a = Buffer.from(v);
  const b = Buffer.from(API_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
};
const cookieToken = (header?: string) =>
  header
    ?.split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === COOKIE)?.[1];
app.addHook('onRequest', async (req, reply) => {
  if (!API_TOKEN || !req.url.startsWith('/api/') || req.url.startsWith('/api/login') || req.url.startsWith('/api/health')) return;
  if (tokenOk(req.headers['x-api-token']) || tokenOk(decodeURIComponent(cookieToken(req.headers.cookie) ?? ''))) return;
  return reply.code(401).send({ error: 'Brak autoryzacji', auth: true });
});

app.post<{ Body: { token: string } }>('/api/login', { schema: { body: { type: 'object', required: ['token'], properties: { token: { type: 'string', maxLength: 500 } } } } }, async (req, reply) => {
  if (!API_TOKEN) return { ok: true, auth: false };
  if (!tokenOk(req.body.token)) {
    await audit('auth.fail', {});
    return reply.code(401).send({ error: 'Nieprawidłowy token' });
  }
  await audit('auth.login', {});
  return reply.header('Set-Cookie', `${COOKIE}=${encodeURIComponent(req.body.token)}; HttpOnly; SameSite=Strict; Path=/api`).send({ ok: true });
});

const KINDS = Object.keys(IDENTIFIER_LABELS) as IdentifierKind[];

app.get('/api/health', async (_req, reply) => {
  try {
    await db().one('SELECT 1');
    return { ok: true, db: db().kind };
  } catch (e) {
    return reply.code(503).send({ ok: false, db: db().kind, error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/meta', async () => ({
  sources: describeSources(),
  identifierKinds: KINDS.map((k) => ({ id: k, label: IDENTIFIER_LABELS[k] })),
  contexts: CONTEXT_INFO,
  bands: BANDS,
  scoringParams: SCORING_PARAMS,
  categories: CATEGORY_LABELS,
  defaults: DEFAULT_OPTIONS,
  config: { database: db().kind === 'postgres' ? 'PostgreSQL (serwer)' : 'PostgreSQL (wbudowany – PGlite)', chainLive: config.chainLive, ai: config.ai.provider, aiModel: config.ai.provider === 'none' ? null : config.ai.model, sandboxUrl: config.sandboxUrl, allowedHosts: config.allowedHosts, searxng: !!config.searxngUrl },
}));

app.get('/api/investigations', async () => await listInvestigations());

app.post<{
  Body: { name: string; caseRef?: string; seeds: { kind: IdentifierKind; value: string }[]; options?: Record<string, unknown>; scheduleMinutes?: number | null; runNow?: boolean };
}>(
  '/api/investigations',
  {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'seeds'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          caseRef: { type: 'string', maxLength: 100 },
          seeds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', required: ['kind', 'value'], properties: { kind: { enum: KINDS }, value: { type: 'string', minLength: 1, maxLength: 500 } } } },
          options: {
            type: 'object',
            properties: {
              sources: { type: 'array', items: { type: 'string' } },
              maxDepth: { type: 'integer', minimum: 0, maximum: 3 },
              maxDocuments: { type: 'integer', minimum: 1, maximum: 500 },
              chainLookup: { type: 'boolean' },
              maxChainLookups: { type: 'integer', minimum: 0, maximum: 100 },
              useAi: { type: 'boolean' },
              stableThreshold: { type: 'number', minimum: 0 },
              approvedHosts: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 253, pattern: '^[A-Za-z0-9.-]+$' } },
            },
            additionalProperties: false,
          },
          scheduleMinutes: { type: ['integer', 'null'], minimum: 0, maximum: 43200 },
          runNow: { type: 'boolean' },
        },
      },
    },
  },
  async (req) => {
    const inv = await createInvestigation(req.body);
    const runId = req.body.runNow === false ? null : await startRun(inv.id, 'manual');
    return { investigation: inv, runId };
  },
);

app.get<{ Params: { id: string } }>('/api/investigations/:id', async (req, reply) => {
  const inv = await getInvestigation(req.params.id);
  if (!inv) return reply.code(404).send({ error: 'Nie znaleziono' });
  return { investigation: inv, runs: await listRuns(inv.id) };
});

app.delete<{ Params: { id: string } }>('/api/investigations/:id', async (req) => {
  await deleteInvestigation(req.params.id);
  return { ok: true };
});

app.put<{ Params: { id: string }; Body: { minutes: number | null } }>('/api/investigations/:id/schedule', async (req) => {
  await updateSchedule(req.params.id, req.body?.minutes ?? null);
  return { investigation: await getInvestigation(req.params.id) };
});

app.post<{ Params: { id: string }; Body: { host: string } }>(
  '/api/investigations/:id/approved-hosts',
  { schema: { body: { type: 'object', required: ['host'], properties: { host: { type: 'string', maxLength: 253, pattern: '^[A-Za-z0-9.-]+$' } } } } },
  async (req, reply) => {
    const inv = await approveHost(req.params.id, req.body.host);
    if (!inv) return reply.code(404).send({ error: 'Nie znaleziono' });
    return { investigation: inv };
  },
);

app.post<{ Params: { id: string } }>('/api/investigations/:id/runs', async (req, reply) => {
  try {
    return { runId: await startRun(req.params.id, 'manual') };
  } catch (e) {
    return reply.code(409).send({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
  const r = await getRunResult(req.params.id);
  if (!r) return reply.code(404).send({ error: 'Przebieg nie istnieje lub jeszcze trwa' });
  return r;
});

app.get<{ Params: { id: string } }>('/api/runs/:id/report.html', async (req, reply) => {
  const r = await getRunResult(req.params.id);
  if (!r) return reply.code(404).send('Brak przebiegu');
  await audit('report.view', { runId: req.params.id });
  return reply.type('text/html; charset=utf-8').send(renderReport(r.investigation, r.run, r.result));
});

app.get<{ Params: { id: string } }>('/api/runs/:id/export.json', async (req, reply) => {
  const r = await getRunResult(req.params.id);
  if (!r) return reply.code(404).send({ error: 'Brak przebiegu' });
  await audit('export.json', { runId: req.params.id });
  return reply
    .header('Content-Disposition', `attachment; filename="ogar-${r.investigation.name.replace(/[^\w-]+/g, '_')}-run${r.run.seq}.json"`)
    .type('application/json')
    .send(JSON.stringify({ investigation: r.investigation, run: r.run, result: r.result }, null, 2));
});

app.get<{ Params: { id: string } }>('/api/runs/:id/export.csv', async (req, reply) => {
  const r = await getRunResult(req.params.id);
  if (!r) return reply.code(404).send('Brak przebiegu');
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['siec', 'adres', 'wskaznik_pewnosci', 'przedzial', 'wykluczony', 'powod_wykluczenia', 'etykieta', 'zrodla', 'wskazniki_cash_out', 'liczba_tx'].join(';')];
  for (const a of r.result.addresses)
    rows.push(
      [a.chain, a.address, a.score.score, a.score.bandLabel, a.score.excluded ? 'tak' : 'nie', a.score.exclusionReason, a.label?.name, [...new Set(a.evidence.map((e) => e.url))].join(' | '), a.indicators.filter((i) => i.cashOut).map((i) => i.title).join(' | '), a.onchain?.txCount]
        .map(q)
        .join(';'),
    );
  return reply.header('Content-Disposition', `attachment; filename="ogar-run${r.run.seq}.csv"`).type('text/csv; charset=utf-8').send('﻿' + rows.join('\r\n'));
});

app.get<{ Params: { id: string; docId: string } }>('/api/runs/:id/documents/:docId', async (req, reply) => {
  const d = await getDocument(req.params.id, req.params.docId);
  if (!d) return reply.code(404).send({ error: 'Brak dokumentu' });
  return d;
});

app.get<{ Querystring: { a: string; b: string } }>('/api/compare', async (req, reply) => {
  try {
    return await compareRuns(req.query.a, req.query.b);
  } catch (e) {
    return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/labels', async () => await listLabels());
app.post<{ Body: { chain: 'BTC' | 'ETH' | 'TRX' | 'LTC' | 'DOGE' | 'SOL' | 'XMR'; address: string; name: string; category: LabelCategory; note?: string } }>(
  '/api/labels',
  { schema: { body: { type: 'object', required: ['chain', 'address', 'name', 'category'], properties: { chain: { enum: ['BTC', 'ETH', 'TRX', 'LTC', 'DOGE', 'SOL', 'XMR'] }, address: { type: 'string', maxLength: 120 }, name: { type: 'string', maxLength: 200 }, category: { enum: Object.keys(CATEGORY_LABELS) }, note: { type: 'string', maxLength: 500 } } } } },
  async (req) => {
    await addCustomLabel(req.body.chain, req.body.address.trim(), req.body.name, req.body.category, req.body.note);
    await audit('label.add', req.body);
    return { ok: true };
  },
);

app.post<{ Body: { text: string } }>('/api/extract', { schema: { body: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 200_000 } } } } }, async (req) => ({
  ...extractAddresses(req.body.text),
  identifiers: extractIdentifiers(req.body.text),
}));

app.get('/api/audit', async () =>
  (await db().query('SELECT id, ts, action, detail FROM audit_log ORDER BY id DESC LIMIT 300')).map((r) => ({ ...r, id: Number(r.id), ts: iso(r.ts) })),
);

// Frontend (po `npm run build`).
const webDist = path.join(REPO_ROOT, 'apps', 'web', 'dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Nie znaleziono' }) : reply.sendFile('index.html')));
}

// Baza (schemat) i etykiety analityków muszą być gotowe przed przyjęciem pierwszego żądania.
await refreshCustomLabels();
app.log.info(`Baza danych: ${db().kind === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : `PostgreSQL wbudowany (PGlite, ${config.dbPath})`}`);
startScheduler();
await app.listen({ port: config.port, host: config.host });
app.log.info(`OGAR API: http://${config.host}:${config.port}  (piaskownica: ${config.sandboxUrl})`);
