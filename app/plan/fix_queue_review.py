"""Queue review fixes: penalty stage mapping, schedule anchor, cash labels, sourcing tags."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert old in t, f"{name}: MISSING {old[:70]}"
        t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")


core = P / "queuecore.js"
t = core.read_text(encoding="utf-8")
a = t.index("/**\n * Cash and commitments by phase")
b = t.index("/** Federal clocks (days).")
t = t[:a] + '''/**
 * Cash and commitments by phase (vault §3). Readiness deposits are cumulative "top-up to" balances.
 * Withdrawal forfeits follow the four vault stages: cluster study (2× allocated study costs),
 * restudy (5% of NU), facilities study / draft LGIA (10%), post-LGIA (20%), each floored at the
 * study deposit. nuUSD = the project's allocated network-upgrade cost ($), or null when not held.
 */
export function commitments(mw, nuUSD, { needDepositInLieu = false } = {}) {
  const ds = studyDeposit(mw);
  if (ds == null) return { errors: [mw > 0 && mw <= 20 ? 'At or below 20 MW the large-generator pro forma may not apply (small-generator procedures, not modelled). The vault gives ≥20 MW for the first tier; the pro forma covers generators above 20 MW.' : 'Enter a project size.'], phases: [] };
  const lieu = needDepositInLieu ? Math.min(2e6, Math.max(5e5, 10000 * mw)) : 0;
  const nu = ok(nuUSD) ? nuUSD : null;
  // Assumption (not in the vault): a top-up never lowers the balance below the 2× study deposit already posted.
  const target = pct => (nu == null ? null : Math.max(2 * ds, pct * nu));
  const forfeit = pct => (nu == null ? null : Math.max(ds, pct * nu));
  const phases = [
    { phase: 'Cluster request', readiness: 2 * ds, penaltyIfWithdrawn: 0, penaltyLowerBound: false, penaltyNote: 'No penalty before the cluster study begins', studyDepositHeld: true },
    { phase: 'Cluster study', readiness: target(0.05), penaltyIfWithdrawn: ds, penaltyLowerBound: true, penaltyNote: 'Greater of study deposit or 2× allocated study costs (costs not held, so this is a lower bound). Readiness tops up to 5% after the cluster study report.', studyDepositHeld: true },
    { phase: 'Cluster restudy (if triggered)', readiness: target(0.05), penaltyIfWithdrawn: forfeit(0.05), penaltyLowerBound: false, penaltyNote: 'Greater of study deposit or 5% of network-upgrade cost', studyDepositHeld: true },
    { phase: 'Facilities study / draft LGIA', readiness: target(0.10), penaltyIfWithdrawn: forfeit(0.10), penaltyLowerBound: false, penaltyNote: 'Greater of study deposit or 10%', studyDepositHeld: true },
    { phase: 'After LGIA execution', readiness: target(0.20), penaltyIfWithdrawn: forfeit(0.20), penaltyLowerBound: false, penaltyNote: 'Greater of study deposit or 20%. The LGIA deposit is credited toward construction security.', studyDepositHeld: false },
  ];
  let prev = 0;
  for (const p of phases) {
    p.topUp = p.readiness == null ? null : Math.max(0, p.readiness - prev);
    if (p.readiness != null) prev = p.readiness;
    // Refundable study deposit is shown while studies run; it is settled against study costs afterwards.
    p.cashPosted = p.readiness == null ? null : p.readiness + (p.studyDepositHeld ? ds : 0) + lieu;
  }
  return { errors: [], studyDeposit: ds, depositInLieu: lieu, fee: 5000, phases, nuHeld: nu != null, boundary20: mw === 20 };
}

''' + t[b:]
t = t.replace("""export function scheduleBand(start, { restudy = false, longFacilities = false } = {}) {
  const t0 = Date.parse(start); if (!ok(t0)) return null;
  let d = 0; const rows = [];
  for (const c of CLOCKS) {""", """/** Band anchored on the request window CLOSE date: the 45-day window is already over, so it adds nothing. */
export function scheduleBand(windowClose, { restudy = false, longFacilities = false } = {}) {
  const t0 = Date.parse(windowClose); if (!ok(t0)) return null;
  let d = 0; const rows = [];
  for (const c of CLOCKS) {
    if (c.step === 'Cluster request window') { rows.push({ ...c, used: null, from: 'closed ' + new Date(t0).toISOString().slice(0, 10), note: 'Already elapsed at the anchor date' }); continue; }""")
t = t.replace("  clusterEraStart: '2024-08-12', // ISO-NE moved to cluster studies (memory isone-study-conditions-by-asset)",
              "  clusterEraStart: '2024-08-12', // ISO-NE moved to cluster studies (workspace memory; not in the vault)\n  clusterEraSource: 'A: workspace research note (ISO-NE compliance); not in the vault',")
core.write_text(t, encoding="utf-8")

patch("tests/queue.test.mjs", [
    ("test('schedule band is a minimum when a clock length is not held', () => {\n  const s = scheduleBand('2026-11-19');\n  assert.equal(s.minDays, 45 + 150 + 90);\n});",
     "test('schedule anchored on the window close adds cluster study + facilities only (no double-counted window)', () => {\n  const s = scheduleBand('2026-11-19');\n  assert.equal(s.minDays, 150 + 90);\n  assert.equal(s.earliest, '2027-07-17');\n});\n\n"
     "test('withdrawal forfeits follow the four vault stages (NU $10M, 100 MW)', () => {\n  const p = commitments(100, 10e6).phases.map(x => x.penaltyIfWithdrawn);\n  assert.deepEqual(p, [0, 150000, 500000, 1000000, 2000000]);\n});"),
])

patch("views/queue.js", [
    # Cash KPIs: out-of-pocket incl. fee vs posted (refundable/security)
    ("      ${kpi('Cash at request', usd(first.fee + first.studyDeposit + first.readiness + c.depositInLieu), '', `$5k fee + ${usd(first.studyDeposit)} study deposit + ${usd(first.readiness)} readiness${c.depositInLieu ? ' + deposit in lieu' : ''}`)}\n      ${kpi('Peak cash or security posted', ok(peak) ? `${nu == null ? '≥ ' : ''}${usd(peak)}` : 'not held', '', nu == null ? 'Later phases not held' : 'Readiness balance + study deposit')}\n      ${kpi('Forfeited if withdrawn after study starts', usd(c.phases[1].penaltyIfWithdrawn), '', 'Only if it materially affects equal- or lower-queued requests')}",
     "      ${kpi('Cash out at request', usd(c.fee + first.cashPosted), '', `$5k non-refundable fee + ${usd(first.cashPosted)} posted (study deposit + readiness${c.depositInLieu ? ' + deposit in lieu' : ''})`)}\n      ${kpi('Peak cash or security posted', ok(peak) ? `${nu == null ? '≥ ' : ''}${usd(Math.max(peak, first.cashPosted))}` : 'not held', '', nu == null ? 'Later phases not held' : 'Readiness balance + study deposit while studies run')}\n      ${kpi('Forfeited if withdrawn during the cluster study', `≥ ${usd(c.phases[1].penaltyIfWithdrawn)}`, '', 'Only if it materially affects equal- or lower-queued requests')}"),
    ("<td class=\"num\">${p.penaltyIfWithdrawn === 0 ? '$0 (true zero)' : usd(p.penaltyIfWithdrawn)}</td>",
     "<td class=\"num\">${p.penaltyIfWithdrawn === 0 ? '$0 (true zero)' : `${p.penaltyLowerBound && ok(p.penaltyIfWithdrawn) ? '≥ ' : ''}${usd(p.penaltyIfWithdrawn)}`}</td>"),
    ("    <label class=\"inline-check\"><input type=\"checkbox\" data-act=\"q-flag\" data-k=\"qLieu\"",
     "    ${c.boundary20 ? '<div class=\"notice warn\">Exactly 20 MW is a boundary case: the vault lists the first tier as ≥20 MW, while the pro forma covers generators above 20 MW. Confirm which procedure applies.</div>' : ''}\n    <label class=\"inline-check\"><input type=\"checkbox\" data-act=\"q-flag\" data-k=\"qLieu\""),
    ("<p class=\"audit-note\">Deposits and letters of credit are <b>cash posted, not capital cost</b>:",
     "<p class=\"audit-note\">The refundable study deposit is shown while studies run and settled against study costs afterwards. Keeping each readiness balance at least 2× the study deposit is an assumption, not in the vault. Deposits and letters of credit are <b>cash posted, not capital cost</b>:"),
    # Schedule: sourcing
    ("<label class=\"field\">Cluster request window closes <span class=\"pill\">A</span><input type=\"date\" data-act=\"ui-text\" data-k=\"qStart\" value=\"${esc(start)}\"><span class=\"audit-note\">Default: 19 Nov 2026, the close of ISO-NE's expected 5 Oct – 19 Nov 2026 window (ISO-NE process guide, web; confirm before relying on it)</span></label>",
     "<label class=\"field\">Cluster request window closes <span class=\"pill warn\">Web · not verified</span><input type=\"date\" data-act=\"ui-text\" data-k=\"qStart\" value=\"${esc(start)}\"><span class=\"audit-note\">Default 19 Nov 2026: the close of an expected 5 Oct – 19 Nov 2026 window cited from ISO-NE's process guide in Codex's plan (no URL or access date held; not in the vault). Confirm on iso-ne.com before relying on it.</span></label>"),
    ("      ${kpi('Earliest study completion', band ? band.earliest : '—', '', 'At least this late: two steps have no federal clock')}",
     "      ${kpi('Earliest study completion', band ? band.earliest : '—', '', 'Counted from the window close; at least this late, because two steps have no federal clock')}"),
    # Cluster tab: not-held MW separate; what-if only for the summer case
    ("  const notModelled = mw - modelled;",
     "  const notHeld = list.filter(x => x.inModel === 'not held').reduce((t, x) => t + (x.q.max_mw || 0), 0);\n  const notModelled = mw - modelled - notHeld;"),
    ("      ${kpi('Not in the study', fmt.mw(notModelled), '', 'Context only: not subtracted from headroom')}",
     "      ${kpi('Not in the study', fmt.mw(notModelled), '', `Context only, not subtracted${notHeld ? ` · ${fmt.mw(notHeld)} with study status not held` : ''}`)}"),
    ("  const whatIf = S.ui.qWhatIf && ok(ex.value) ? ex.value - list.filter(x => x.inModel !== 'modelled in summer study').reduce((t2, x) => t2 + (x.q.max_mw || 0), 0) : null;",
     "  const summerBinds = /Summer peak/.test(ex.row?.label || '');\n  const whatIf = S.ui.qWhatIf && ok(ex.value) && summerBinds ? ex.value - list.filter(x => x.inModel === 'not modelled').reduce((t2, x) => t2 + (x.q.max_mw || 0), 0) : null;"),
    ("${ok(whatIf) ? `${fmt.mw(ex.value)} − not-in-study MW = <b>${fmt.mw(whatIf)}</b>` : 'export limit not established'}",
     "${ok(whatIf) ? `${fmt.mw(ex.value)} − not-in-study MW = <b>${fmt.mw(whatIf)}</b>` : summerBinds ? 'export limit not established' : 'not available: the in-study tag covers the summer case only, and a different case binds here'}"),
    ("'<p>Cluster era = requested on or after 12 Aug 2024, when ISO-NE moved to cluster studies. Requests in the same cluster have equal priority; cluster membership itself is not held.</p>'",
     "'<p>Cluster era = requested on or after 12 Aug 2024, when ISO-NE moved to cluster studies (A: workspace research note, not in the vault). Requests in the same cluster have equal priority; cluster membership, and which serial-era requests joined the transitional cluster, are not held.</p>'"),
])
print("patched OK")
