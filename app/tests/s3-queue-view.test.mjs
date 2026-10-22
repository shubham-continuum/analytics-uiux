// S3: the Queue rule widgets and traces render the engine's figures with their citations (no browser needed).
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S3) · 2026-10-06 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RX from '../rules/isone.js';
import { queueInputs, scheduleBand, commitments, depositCurve, penaltyExemptions } from '../queuecore.js';
import { profileSwitch, costToEnterBody, siteControlBody, depositNarrative } from '../views/queue-rules.js';
import { traceSchedule, traceCash, traceDepositCurve } from '../views/queue-trace.js';
import { traceExemptions } from '../views/queue-trace-v5.js';

const S = (ui = {}) => ({ tech: 'solar', exportMW: 150, importMW: 0, ui });

test('acceptance: Queue › Cost to enter at 150 MW shows "$800k total, $300k cash" with "Sched 22 §3.4.1.1 · corrected"', () => {
  const h = costToEnterBody(RX.entryCost({ mw: 150 }));
  assert.match(h, /\$800k total, \$300k cash/);
  assert.match(h, /Sched 22 §3\.4\.1\.1 · corrected · effective 2024-08-12/);
  assert.match(h, /\$800,000/); assert.match(h, /\$300,000 cash/);
});

test('profile switch: ISO-NE active by default; the pro forma shows the labelled-fallback warning', () => {
  assert.match(profileSwitch(S()), /data-v="isone" class="active"/);
  assert.doesNotMatch(profileSwitch(S()), /Labelled fallback/);
  const p = profileSwitch(S({ qProfile: 'proforma' }));
  assert.match(p, /data-v="proforma" class="active"/); assert.match(p, /Labelled fallback/);
});

test('F016 on screen: Land not held → the blocked notice, and the demonstrated case named as an assumption', () => {
  const q = queueInputs(S()), h = siteControlBody(S(), q, RX.queueCash(q));
  assert.match(h, /blocked: site control not held/);
  assert.match(h, /assumption, not Land/);
  assert.match(h, /<span class="pill warn">Open<\/span>/);
});

test('S-1 on screen: 95% in Land → Fail with "ISO-NE requires 100% at request"', () => {
  const st = S({ land: { control: 95 }, qService: 'CNRIS' }), q = queueInputs(st);
  const h = siteControlBody(st, q, RX.queueCash(q));
  assert.match(h, /pill bad">Fail/); assert.match(h, /ISO-NE requires 100% at request/);
});

test('assumption paragraph is written from the rules file (ISO-NE and pro forma)', () => {
  assert.match(depositNarrative('isone'), /\$50,000 \+ study deposit \$250,000/);
  assert.match(depositNarrative('proforma'), /\$35,000 \+ \$1,000\/MW below 80 MW/);
});

test('traces render, and their independent raw-rules checks agree with the engine (no ✗)', () => {
  const band = scheduleBand(undefined, {});
  const ts = traceSchedule('2026-11-19', band, { restudy: false, facilities: 90 });
  assert.match(ts, /2027-10-15/);
  for (const prof of ['isone', 'proforma']) {
    const c = commitments(150, 10e6, { profile: prof });
    const tc = traceCash(150, c, 10e6, 0, 'user', prof), td = traceDepositCurve(depositCurve(Array.from({ length: 496 }, (_, i) => 5 + i), prof), 150, prof);
    for (const h of [ts, tc, td]) { assert.doesNotMatch(h, /Does not reconcile/, prof); assert.match(h, /Reconciles/); }
  }
  const te = traceExemptions(penaltyExemptions({ priorReport: 10, current: 13, reportType: 'restudy' }));
  assert.match(te, /Sched 22 §3\.7\.1/);
});
