// Provenance: Claude Opus 5.5 · one-studio/design (T3, plan 14 suite fix) · 2026-10-14 · sign-off pending · v1
// The suite runner's step helper: a forced report (or a killed run) must still show which step was running, for how long,
// its last output line and the PID to stop. Before this, run-suite printed nothing until a step ended, so a report forced
// inside the 71 s unit step read "no step results" and green was unknown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runStep } from './suite-step.mjs';

const node = process.execPath;
const dir = () => mkdtempSync(path.join(tmpdir(), 'suite-step-'));

test('prints START with the PID before the step ends, and heartbeats with the last output line while it runs', async () => {
  const lines = [], logDir = dir();
  const p = runStep({ label: 'slow', cmd: node, args: ['-e', "console.log('first line'); setTimeout(() => console.log('done'), 900)"],
    logDir, heartbeatMs: 150, print: l => lines.push(l) });
  await new Promise(r => setTimeout(r, 500));
  assert.match(lines[0], /^START slow · pid \d+ · timeout 420s · log .+/);
  const beats = lines.filter(l => l.startsWith('… slow running'));
  assert.ok(beats.length >= 1, lines.join('\n'));
  assert.match(beats.at(-1), /last: first line/);
  // the step marker names the running step and its PID for a stop-by-PID
  const cur = JSON.parse(readFileSync(path.join(logDir, 'current-step.json'), 'utf8'));
  assert.equal(cur.label, 'slow');
  assert.ok(Number.isInteger(cur.pid));
  const r = await p;
  assert.equal(r.status, 0);
  assert.match(r.text, /first line[\s\S]*done/);
  assert.equal(existsSync(path.join(logDir, 'current-step.json')), false);
  // the step's own log holds its output (streamed, not only on close)
  assert.match(readFileSync(r.log, 'utf8'), /first line[\s\S]*done/);
});

test('a step past its timeout is stopped by PID, reported as TIMEOUT, and returns a non-zero status', async () => {
  const lines = [], logDir = dir();
  const r = await runStep({ label: 'hang', cmd: node, args: ['-e', 'setInterval(() => {}, 1000)'], logDir, timeout: 400, heartbeatMs: 10000, print: l => lines.push(l) });
  assert.notEqual(r.status, 0);
  assert.equal(r.timedOut, true);
  assert.ok(lines.some(l => /^TIMEOUT hang after 0s · stopped pid \d+/.test(l)), lines.join('\n'));
  assert.equal(existsSync(path.join(logDir, 'current-step.json')), false);
});

test('a command that cannot start returns a null status and its error text, never hangs', async () => {
  const r = await runStep({ label: 'missing', cmd: path.join(dir(), 'no-such-binary.exe'), args: [], logDir: dir(), heartbeatMs: 10000, print: () => {} });
  assert.equal(r.status, null);
  assert.match(r.text, /ENOENT/);
});
