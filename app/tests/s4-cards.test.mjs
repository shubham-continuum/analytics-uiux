// S4 render + grid columns: the revenue-stack, capacity-path and PfP cards, and the two grid columns, over rules/revenue.js.
// Provenance: Claude Opus 5.5 (S4 agent) · one-studio/design (T3, slice S4) · 2026-10-06 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { revenueStack, capacityPath, pfpReplay, zeroOutput } from '../rules/revenue.js';
import { revenueStackCard, capacityPathCard, pfpCard, revenueCards, revenueUiOpts, revenueTools } from '../views/cards-revenue.js';
import { revenueColumns, columnValue, REVENUE_COLUMN_IDS } from '../columns/revenue.js';

const R = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url)));
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const HATCH = { bus_id: 111209, lat: 41.62, lon: -70.52, state: 'MA' };

test('revenue-stack card: every stream shows its regime and source; not held reads "not held" with the reason, never $0', () => {
  const st = revenueStack(R, { tech: 'solar', mw: 100, state: 'MA', cod: 2029, lat: HATCH.lat, lon: HATCH.lon, annualMWh: 200000 });
  const h = revenueStackCard(st), t = text(h);
  for (const s of st.streams) { assert.ok(t.includes(s.label), s.label); assert.ok(h.includes(`data-stream="${s.id}"`), s.id); }
  assert.match(t, /Energy .* not held/); assert.match(t, /computed on Economics › Revenue/);
  assert.match(t, /n\/a/); // DA A/S and regulation for solar
  assert.ok(!/\$0(?![.\d])/.test(t.replace(/Regulation[^|]*?\$0\.00/, '')), 'no bare $0 stands in for not held');
  assert.match(t, /Prompt Annual Capacity Auction/); assert.match(t, /slide 64/);
  assert.match(h, /data-trace="r-stack"/);
});

test('capacity-path card: one row per CCP, regime and price tag per row, cleared history shown as history with "FCA 18, 2027/28 only"', () => {
  const p = capacityPath(R, { tech: 'solar', mw: 100, cod: 2029, years: 4 });
  const t = text(capacityPathCard(p));
  for (const r of p.rows) assert.ok(t.includes(r.ccp), r.ccp);
  assert.match(t, /FCA 18, 2027\/28 only/); assert.match(t, /history only/i); assert.match(t, /prefilled from cleared history/i);
  assert.match(t, /Monthly qualification route/); assert.match(t, /1 January 2029 assumed/);
  const sa = text(capacityPathCard(capacityPath(R, { tech: 'solar', mw: 100, cod: 2029, years: 2, regime: 'mric' })));
  assert.match(sa, /not held/); assert.match(sa, /no default from FCA 18/i); assert.match(sa, /pending/);
});

test('PfP card: seven events with the 2022-12-24 window 16:40–18:05, expected $/yr and $/kW-yr, stop-loss source', () => {
  const pf = pfpReplay(R, { cso: 39.8, mw: 100, output: zeroOutput });
  const t = text(pfpCard(pf));
  assert.match(t, /2022-12-24 16:40–18:05/); assert.equal((t.match(/20\d\d-\d\d-\d\d \d\d:\d\d–/g) || []).length, 7);
  assert.match(t, /\/kW-yr/); assert.match(t, /III\.13\.7\.3/); assert.match(t, /3,500/);
  const nh = text(pfpCard(pfpReplay(R, { cso: 1, mw: 1, output: null })));
  assert.match(nh, /not held/i);
});

test('revenueCards(): the three cards the lead wires into Economics, in order', () => {
  const html = revenueCards(R, { tech: 'storage', mw: 100, durationH: 4, state: 'MA', cod: 2029 });
  const ids = [...html.matchAll(/data-trace="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids, ['r-stack', 'r-capacity', 'r-pfp']);
});

test('capacity tools: S.ui strings map to options; the MRIC price box appears only under CAR-SA; unknown values fall back', () => {
  assert.deepEqual(revenueUiOpts({}), { regime: 'qc', band: 'low', mricPrice: null, fca18Cso: false });
  assert.deepEqual(revenueUiOpts({ capRegime: 'mric', capBand: 'high', capMric: '4.5', fca18Cso: true }), { regime: 'mric', band: 'high', mricPrice: 4.5, fca18Cso: true });
  assert.deepEqual(revenueUiOpts({ capRegime: 'x', capBand: 'y', capMric: 'abc' }), { regime: 'qc', band: 'low', mricPrice: null, fca18Cso: false });
  assert.ok(!/data-k="capMric"/.test(revenueTools({})));
  assert.match(revenueTools({ capRegime: 'mric' }), /data-k="capMric"/);
  const html = revenueCards(R, { tech: 'solar', mw: 100, state: 'MA', cod: 2029 }, { capRegime: 'mric', capMric: '5' });
  assert.match(text(html), /Seasonal CAR/); assert.match(html, /data-act="q-flag" data-k="fca18Cso"/);
});

test('grid columns: capacity $/kW-mo for the COD year and PfP expected $/kW-yr; not held carries a why', () => {
  const cols = revenueColumns(() => ({ tech: 'solar', mw: 100, cod: 2029 }), () => R);
  assert.deepEqual(cols.map(c => c.id), REVENUE_COLUMN_IDS);
  for (const c of cols) for (const k of ['id', 'label', 'unit', 'family', 'source', 'get', 'why', 'hint']) assert.ok(c[k] != null, `${c.id}.${k}`);
  const row = { n: HATCH };
  const cap = cols[0].get(row);
  assert.ok(Math.abs(cap - 0.398 * 3.58) < 1e-9, String(cap));
  const pf = cols[1].get(row);
  assert.ok(pf < 0 && pf > -3.68 * 0.398, String(pf)); // a 39.8% CSO with some evening output pays less than the zero-output bound
  assert.equal(columnValue('pfp_exp', { bus_id: 1, lat: null, lon: null }, { tech: 'solar', mw: 100, cod: 2029 }, R).value, null);
  assert.match(columnValue('pfp_exp', { bus_id: 1, lat: null, lon: null }, { tech: 'solar', mw: 100, cod: 2029 }, R).why, /location/i);
  const wind = columnValue('cap_cod', HATCH, { tech: 'wind', mw: 100, cod: 2029 }, R);
  assert.equal(wind.value, null); assert.match(wind.why, /QC/);
  assert.equal(columnValue('cap_cod', HATCH, { tech: 'dc', mw: 100, cod: 2029 }, R).value, null);
  const bess = revenueColumns(() => ({ tech: 'bess', mw: 100, cod: 2029, durationH: 4 }), () => R);
  assert.ok(bess[0].get(row) > 3.5, 'storage: ~99.6% QC × $3.58');
  assert.equal(revenueColumns(() => ({ tech: 'solar', mw: 100, cod: null }), () => R)[0].get(row), null);
  assert.match(revenueColumns(() => ({ tech: 'solar', mw: 100, cod: null }), () => R)[0].why(row), /COD/);
  assert.equal(revenueColumns(() => ({ tech: 'solar', mw: 100, cod: 2029 }), () => null)[0].get(row), null);
});
