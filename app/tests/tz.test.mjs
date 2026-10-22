// Must also pass with TZ=America/New_York (run: set TZ=America/New_York && node --test tests/tz.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePrices, dailySpreads, rowsOf } from '../prices.js';
import { clearSky } from '../solar.js';
const data = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));

test(`forecast runs analyse under TZ=${process.env.TZ || 'system'}`, () => {
  const r = analyzePrices(data, { nodeId: '111403', mode: 'forecast', market: 'model', run: 'pcr2030', years: [2030], weighting: 'duration', includePartial: true, strict: true });
  assert.equal(r.errors.length, 0, r.errors.join(' '));
  assert.equal(r.summary.mean.toFixed(2), '47.17');
});

test('partial year cannot take an equal or custom weight', () => {
  const r = analyzePrices(data, { nodeId: '111403', mode: 'historical', market: 'RT', years: [2025, 2026], weighting: 'equal', includePartial: true, strict: true });
  assert.ok(r.errors.some(e => /partial year/.test(e)));
});

test('clear-sky honours the -04:00 summer offset (same instant, same output)', () => {
  assert.equal(clearSky('2025-07-01T13:00:00-04:00', 41.6, -70.5).toFixed(6), clearSky('2025-07-01T12:00:00-05:00', 41.6, -70.5).toFixed(6));
});

test('a DST fall-back day needs 25 records to count as complete', () => {
  const s = data.series.find(x => x.nodeId === '111403' && x.mode === 'historical' && x.market === 'RT' && x.year === 2025);
  const days = new Set(dailySpreads(rowsOf(s), 4).map(d => d.day));
  const nov2 = rowsOf(s).filter(r => r.timestamp.startsWith('2025-11-02')).length;
  assert.equal(days.has('2025-11-02'), nov2 === 25);
});
