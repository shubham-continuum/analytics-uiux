// Provenance: Claude Opus 5.5 · one-studio/design (T3, plan 14 suite fix) · 2026-10-14 · sign-off pending · v1
// One suite step as a child process, with progress a forced report can read: a START line (PID, timeout, step log) when it
// begins, a heartbeat with its elapsed time and last output line while it runs, a TIMEOUT line when it is stopped BY PID,
// and logDir/current-step.json naming the running step so an outside stopper can stop it by PID. The child's output is
// streamed to its own log file and also returned whole on close.
import { spawn } from 'node:child_process';
import { createWriteStream, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

let nSteps = 0;
const slug = s => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);

export function runStep({ label, cmd, args = [], cwd, env, timeout = 420000, logDir, heartbeatMs = 30000, print = console.log }) {
  const t0 = Date.now(), secs = () => ((Date.now() - t0) / 1000).toFixed(0);
  const log = path.join(logDir, `step-${String(++nSteps).padStart(2, '0')}-${slug(label)}.log`);
  const marker = path.join(logDir, 'current-step.json');
  const sink = createWriteStream(log);
  return new Promise(done => {
    let c;
    try { c = spawn(cmd, args, { cwd, env }); }
    catch (e) { sink.end(); done({ status: null, text: String(e), log, timedOut: false }); return; }
    const out = [];
    let last = '', timedOut = false, finished = false;
    const take = d => {
      out.push(d); sink.write(d);
      const ls = d.toString('utf8').split('\n').map(l => l.trim()).filter(Boolean);
      if (ls.length) last = ls.at(-1).slice(0, 160);
    };
    c.stdout?.on('data', take); c.stderr?.on('data', take);
    if (c.pid) {
      print(`START ${label} · pid ${c.pid} · timeout ${(timeout / 1000).toFixed(0)}s · log ${log}`);
      try { writeFileSync(marker, JSON.stringify({ label, pid: c.pid, startedAt: new Date(t0).toISOString(), log })); } catch { /* progress only */ }
    }
    const beat = setInterval(() => print(`… ${label} running ${secs()}s${last ? ` · last: ${last}` : ''}`), heartbeatMs);
    const t = setTimeout(() => {
      timedOut = true;
      print(`TIMEOUT ${label} after ${secs()}s · stopped pid ${c.pid}`);
      try { process.kill(c.pid); } catch { /* already gone */ }
    }, timeout);
    const finish = (status, extra = '') => {
      if (finished) return; finished = true;
      clearTimeout(t); clearInterval(beat);
      try { rmSync(marker, { force: true }); } catch { /* progress only */ }
      sink.end();
      const text = Buffer.concat(out).toString('utf8') + extra;
      done({ status: timedOut && status === 0 ? 1 : status, text, log, timedOut });
    };
    c.on('error', e => finish(null, String(e)));
    c.on('close', code => finish(code));
  });
}
