// Serwer piaskownicy: strony + prosta wyszukiwarka pełnotekstowa + przełącznik okresu.
import http from 'node:http';
import { PAGES } from './sites.ts';

const PORT = Number(process.env.SANDBOX_PORT ?? 4100);
const HOST = process.env.SANDBOX_HOST ?? '127.0.0.1';
const BASE = process.env.SANDBOX_PUBLIC_URL ?? `http://${HOST}:${PORT}`;
let period = 1;

const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', BASE);
  const send = (code: number, type: string, body: string) => {
    res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  if (url.pathname === '/api/search') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const results = q.length < 3 ? [] : PAGES.filter((p) => text(p.render(period, BASE)).toLowerCase().includes(q)).map((p) => ({ url: `${BASE}${p.path}`, title: p.title }));
    return send(200, 'application/json', JSON.stringify({ query: q, period, results }));
  }
  if (url.pathname === '/__admin/period') {
    if (req.method === 'POST') {
      const v = Number(url.searchParams.get('value'));
      if (v === 1 || v === 2) period = v;
    }
    return send(200, 'application/json', JSON.stringify({ period }));
  }
  const page = PAGES.find((p) => p.path === url.pathname || p.path === url.pathname + '/');
  if (page) return send(200, 'text/html', page.render(period, BASE));
  if (url.pathname === '/') {
    return send(
      200,
      'text/html',
      `<!doctype html><meta charset="utf-8"><title>Piaskownica OŁCyŚ</title><body style="font-family:system-ui;max-width:760px;margin:24px auto">
<h1>🧪 Piaskownica testowa OŁCyŚ</h1><p>Fikcyjne strony do scenariuszy testowych. Aktualny okres: <b>${period}</b>
<form method="post" action="/__admin/period?value=${period === 1 ? 2 : 1}" style="display:inline"><button>Przełącz na okres ${period === 1 ? 2 : 1}</button></form></p>
<ul>${PAGES.map((p) => `<li><a href="${p.path}">${p.title}</a> <small>${p.path}</small></li>`).join('')}</ul>
<p>Wyszukiwarka: <code>/api/search?q=...</code></p></body>`,
    );
  }
  send(404, 'text/plain', 'Nie znaleziono');
});

server.listen(PORT, HOST, () => console.log(`Piaskownica OŁCyŚ: ${BASE} (okres ${period})`));
