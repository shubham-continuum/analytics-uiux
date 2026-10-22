// ISO-NE rules file: every constant carries a source and a status; the headline arithmetic matches the research.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const R = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url)));
const STATUSES = new Set(['verified', 'corrected', 'assumption', 'pending', 'contingent', 'unverifiable']);

function leaves(o, path = []) {
  const out = [];
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith('_')) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('status' in v) out.push([path.concat(k).join('.'), v]);
      else out.push(...leaves(v, path.concat(k)));
    }
  }
  return out;
}

test('every rule entry has a known status, and a source unless it is the pending large-load block itself', () => {
  const all = leaves(R);
  assert.ok(all.length >= 40, `${all.length} entries`);
  for (const [p, v] of all) {
    assert.ok(STATUSES.has(v.status), `${p}: status ${v.status}`);
    if (p !== 'large_load') assert.ok(v.src, `${p}: source missing`);
  }
});

test('Schedule 22 entry cost: $50k + $250k cash + 2 × $250k readiness = $800k, of which $300k is cash', () => {
  const s = R.interconnection.schedule22;
  const cash = s.initial_deposit.value + s.study_deposit.value, readiness = s.readiness_deposit_initial.multiple_of_study_deposit * s.study_deposit.value;
  assert.equal(cash, 300000); assert.equal(cash + readiness, 800000);
  assert.equal(s.site_control_at_request.value, 1.0);
  assert.equal(s.cluster_study_days.value, 270); assert.equal(s.customer_engagement_window_days.value, 60);
  assert.equal(s.cost_allocation.dfax_threshold, 0.03);
});

test('PfP events: seven, in order, with the observation window used for the annual rate', () => {
  const ev = R.pfp.events.rows;
  assert.equal(ev.length, 7);
  assert.deepEqual(ev.map(e => e.date), [...ev.map(e => e.date)].sort());
  assert.ok(Math.abs(ev.length / R.pfp.events.years_observed - 0.84) < 0.01);
  assert.equal(R.pfp.ppr.value, 3500);
});

test('tax constants match the statute as researched; contingent items are flagged, never asserted as settled', () => {
  assert.equal(R.tax.itc_rate.pwa, 0.30); assert.equal(R.tax.wind_solar_cutoffs.boc_by, '2026-07-04'); assert.equal(R.tax.wind_solar_cutoffs.pis_by, '2027-12-31');
  assert.equal(R.tax.notice_2025_42.status, 'contingent');
  assert.equal(R.large_load.status, 'pending');
  assert.equal(R.recs_ma.class1_acp.value, 40);
});
