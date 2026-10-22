// fixture-parity.mjs never reaches the real :5034: both spawned servers carry explicit export and Continuum targets,
// the --db server's Continuum target is the in-process replay fake, and a :5034 target is refused before any server starts.
// Provenance: Claude Opus 5.5 (fixer, parity-5034) · one-studio/design/14-lift-projects-configurator-continuum.md L5 · 2026-10-14 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = mkdtempSync(path.join(process.env.SUITE_SCRATCH || tmpdir(), 'gsone-fxguard-'));
writeFileSync(path.join(FIX, 'index.json'), JSON.stringify({ id: 'guard-test', paths: {} }));
const dry = extra => spawnSync(process.execPath, ['tests/fixture-parity.mjs', '--fixtures', FIX, '--dry-run', ...extra], { cwd: APP, encoding: 'utf8', timeout: 30000 });
const targets = args => Object.fromEntries(['--export-target', '--continuum-target'].map(k => [k, args[args.indexOf(k) + 1]]).filter(([, v]) => v));

test('both servers get explicit targets; none is :5034; the db server proxies Continuum to the replay fake', () => {
  const r = dry([]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const plan = JSON.parse(r.stdout.trim().split('\n').at(-1));
  for (const side of ['db', 'fixtures']) {
    const t = targets(plan[side]);
    assert.ok(t['--export-target'] && t['--continuum-target'], `${side}: both targets explicit (${JSON.stringify(plan[side])})`);
    for (const v of Object.values(t)) assert.ok(!/:5034$/.test(v), `${side}: ${v} is not :5034`);
  }
  assert.equal(targets(plan.db)['--continuum-target'], `127.0.0.1:${plan.fakePort}`, 'db server → the replay fake');
});

test('a :5034 target is refused before any server starts', () => {
  const r = dry(['--continuum-fake', '127.0.0.1:5034']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /refused.*5034/i);
});
