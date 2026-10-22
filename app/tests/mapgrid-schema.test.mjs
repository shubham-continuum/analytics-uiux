// M2 mapgrid schema gate: every published field group has a complete column spec, a reason for its nulls,
// row counts equal to meta, the generation id on meta, and no engine-class field. Skips until a generation is built.
// Provenance: Claude Opus 5.5 (data agent) · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(APP, 'data', 'mapgrid');
const CUR = path.join(DIR, 'current.json');
const built = existsSync(CUR);
const skip = built ? false : 'no published mapgrid generation (python plan/build_mapgrid.py --db …)';
const read = f => JSON.parse(readFileSync(f, 'utf8'));
const gdir = built ? path.join(DIR, read(CUR).dir) : null;
const meta = built ? read(path.join(gdir, 'meta.json')) : null;

// The column-spec cells 04 requires on every field (mapgrid-schema.test: none blank).
const SPEC = ['unit', 'interval', 'tz', 'weighting', 'level', 'null_render', 'source'];
// Engine-class names (04a §1/§2): served by the preview engine, never by api_mapgrid.
const ENGINE = /^(headroom|hr|hr_.*|sto_.*|storage_headroom|cost|cost\d+|kw\d+|curt.*|lmp(_\d+|\d+_pb)?|price.*|basis.*|decomp|energy|cong|cong_part|loss_part|cap_.*|capture|tb\d+(_\d+)?|exclusions|clear_.*|disc_.*|score|rank|gates?|p5|p95|std|hneg|rt_neg|h200)$/;

test('meta carries the generation, DB stamp and schema hash', { skip }, () => {
  for (const k of ['generation', 'db_path', 'db_mtime_ns', 'schema_hash', 'builder_version', 'built_at'])
    assert.ok(meta[k] != null && meta[k] !== '', k);
  assert.equal(read(CUR).generation, meta.generation);
});

test('every field group: spec complete, counts match, nulls carry a reason', { skip }, () => {
  const problems = [];
  for (const [g, f] of Object.entries(meta.fields)) {
    for (const c of SPEC) if (!String((f.spec || {})[c] ?? '').trim()) problems.push(`${g}: blank spec cell ${c}`);
    if (!existsSync(path.join(gdir, `${g}.json`))) { problems.push(`${g}: file missing`); continue; }
    if (f.nulls > 0 && !f.nullReason) problems.push(`${g}: ${f.nulls} nulls without nullReason`);
    if (typeof f.rows !== 'number') problems.push(`${g}: rows not a number`);
  }
  assert.deepEqual(problems, []);
});

test('no engine-class field name anywhere in the output', { skip }, () => {
  const hits = new Set();
  const walk = o => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (ENGINE.test(k)) hits.add(k); walk(v); }
  };
  for (const g of Object.keys(meta.fields)) {
    const d = read(path.join(gdir, `${g}.json`));
    walk(d);
    if (g === 'identity') d.cols.forEach(c => { if (ENGINE.test(c)) hits.add(c); });
  }
  assert.deepEqual([...hits], []);
});

test('identity is columnar, one row per spine bus, never a zero for a missing number', { skip }, () => {
  const d = read(path.join(gdir, 'identity.json'));
  assert.ok(Array.isArray(d.cols) && Array.isArray(d.rows));
  assert.equal(d.rows.length, meta.coverage.spine_buses);
  for (const r of d.rows) assert.equal(r.length, d.cols.length);
  // gen_mw / load_mw: a bus with no modelled unit is null, not 0
  const gi = d.cols.indexOf('gen_mw');
  assert.ok(d.rows.filter(r => r[gi] === null).length > 0);
});
