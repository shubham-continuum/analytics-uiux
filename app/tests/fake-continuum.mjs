// A fake LMP Continuum service (:5034 stand-in) for the suite and smoke-continuum: replays tests/fixtures/continuum/index.json.
// Provenance: Claude Opus 5.5 (integrator, round 1) · one-studio/design/14-lift-projects-configurator-continuum.md L4 · 2026-10-13 · sign-off pending · v1
// Key = path + '?' + the query's k=v pairs sorted and joined by '&' (no query: the path alone). A held route answers its
// recorded status and body; anything else is 404 {"error":"nothing held here (fake)"}. Never calls the real :5034.
//   continuumAnswer(url) -> {status, body} | null (null = not a /api/v2/ route: the caller answers it)
//   startFakeContinuum() -> {port, hits, close()} (a standalone fake on 127.0.0.1, ephemeral port)
import http from 'node:http';
import { readFileSync } from 'node:fs';

const DIR = new URL('./fixtures/continuum/', import.meta.url);
const INDEX = JSON.parse(readFileSync(new URL('index.json', DIR), 'utf8')).routes;
const cache = new Map();
export const fixtureKey = url => {
  const u = new URL(url, 'http://fake'), q = [...u.searchParams].map(([k, v]) => `${k}=${v}`).sort();
  return q.length ? `${u.pathname}?${q.join('&')}` : u.pathname;
};
/** The recorded body for a key (parsed, cached) or null. */
export function fixtureBody(key) {
  const e = INDEX[key]; if (!e) return null;
  if (!cache.has(key)) cache.set(key, JSON.parse(readFileSync(new URL(e.file, DIR), 'utf8')));
  return cache.get(key).body;
}
export function continuumAnswer(url) {
  if (!String(url).startsWith('/api/v2/')) return null;
  const key = fixtureKey(url), e = INDEX[key];
  return e ? { status: e.status, body: fixtureBody(key) } : { status: 404, body: { error: 'nothing held here (fake)' } };
}
export async function startFakeContinuum() {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const a = continuumAnswer(req.url) || { status: 404, body: { error: 'nothing held here (fake)' } };
    res.writeHead(a.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(a.body));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, hits, close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(() => r()); }) };
}
