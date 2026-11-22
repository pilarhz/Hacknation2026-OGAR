// Biała lista hostów a przekierowania: host docelowy przekierowania jest sprawdzany ZANIM
// zostanie do niego wysłane zapytanie (wcześniej redirect: 'follow' łączył się najpierw z hostem).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.DB_PATH = ':memory:';
// Tylko 127.0.0.1 na białej liście; „localhost” udaje host spoza listy (ten sam komputer, inna nazwa).
process.env.ALLOWED_HOSTS = '127.0.0.1';
process.env.SANDBOX_URL = 'http://127.0.0.1:1';

const { fetchText, FetchBlockedError } = await import('../src/http/fetcher.ts');
const { db } = await import('../src/db/db.ts');

let outsideHits = 0;
let outside: http.Server;
let allowed: http.Server;
let base = '';

const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));

before(async () => {
  outside = http.createServer((_req, res) => {
    outsideHits++;
    res.end('sekret');
  });
  const outsidePort = await listen(outside);
  allowed = http.createServer((req, res) => {
    if (req.url === '/to-outside') res.writeHead(302, { Location: `http://localhost:${outsidePort}/leak?q=dane` }).end();
    else if (req.url === '/hop1') res.writeHead(301, { Location: '/hop2' }).end();
    else if (req.url === '/hop2') res.writeHead(302, { Location: `${base}/final` }).end();
    else if (req.url === '/loop') res.writeHead(302, { Location: '/loop' }).end();
    else if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      const chunk = 'x'.repeat(1_000_000);
      for (let i = 0; i < 12; i++) res.write(chunk);
      res.end();
    } else res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`ok ${req.url}`);
  });
  base = `http://127.0.0.1:${await listen(allowed)}`;
});
after(async () => {
  outside.close();
  allowed.close();
  await db().close();
});

test('Przekierowanie na host spoza białej listy jest blokowane bez łączenia się z tym hostem', async () => {
  const log: { url: string; status: number | string }[] = [];
  await assert.rejects(fetchText(`${base}/to-outside`, { log: log as never }), (e) => e instanceof FetchBlockedError);
  assert.equal(outsideHits, 0, 'host spoza listy nie może dostać żadnego zapytania');
  assert.ok(log.some((l) => String(l.status).startsWith('BLOCKED') && l.url.includes('localhost')));
});

test('Przekierowania w obrębie białej listy (także względne) są obsługiwane', async () => {
  const r = await fetchText(`${base}/hop1`);
  assert.equal(r.status, 200);
  assert.equal(r.body, 'ok /final');
});

test('Pętla przekierowań kończy się błędem, a nie zawieszeniem', async () => {
  await assert.rejects(fetchText(`${base}/loop`), /przekierowań/);
});

test('Odpowiedź jest odczytywana z limitem rozmiaru (strona 12 MB nie trafia w całości do pamięci)', async () => {
  const r = await fetchText(`${base}/big`);
  assert.equal(r.body.length, 2_000_000); // limit treści dokumentu (jak dotąd)
});
