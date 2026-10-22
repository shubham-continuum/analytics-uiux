// Decision v4: per-fuel verdict. Thresholds are visible defaults labelled as assumptions; a user entry overrides
// and says so. Unknown never passes: every test Holds when its input is not held. Re-exported by decisioncore.js.
import { analyzePrices, dailySpreads } from './prices.js';
import { clearSky } from './solar.js';
import { coreBasis } from './basis.js';
import { stampHour } from './economics.js';
import { revenueFor, cape5Excluded, popValue } from './decisioncore.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const CAPE5_REASON = '5-yr run input under review at this Cape bus: not used in comparisons';

export const THRESHOLDS = {
  // Findings F003: a 90% default failed nearly every ISO-NE solar bus (fleet ≈ 72%). No default until it is agreed.
  capture: { default: null, label: 'Capture ratio ≥', unit: '%', unset: true,
    note: 'Not set: open decision #2, which capture basis governs (modelled clear-sky or the ISO-NE fleet shape) and what ratio is acceptable, has not been agreed (owner: Ganesh). Enter your own to test against it' },
  curtail: { default: 2, label: 'Curtailment ≤', unit: '%', note: 'Assumption; ISO curtailment is not held, POI clipping is shown instead' },
  tb4: { default: 10, label: 'TB4 spread >', unit: '$/MWh', note: 'Assumption (spec pack storage gate)' },
  oppLoss: { default: 5, label: 'Opportunity loss ≤', unit: '%', note: 'Assumption: share of battery power the grid limits cannot carry' },
  dcPrice: { default: null, label: 'LMP 2030 ≤', unit: '$/MWh', note: 'Derived: mean LMP 2030 over the buses holding it' },
  dcVol: { default: 25, label: 'Price volatility <', unit: '$/MWh', note: 'Assumption: standard deviation of the hourly price' },
  dcOutlets: { default: 3, label: 'Substation outlets ≥', unit: 'lines', note: 'Assumption: supply redundancy for a large load' },
};
export const FUEL_TESTS = {
  solar: ['curtail', 'capture'], wind: ['curtail', 'capture'], storage: ['tb4', 'oppLoss'],
  hybrid: ['curtail', 'capture', 'tb4'], datacenter: ['dcPrice', 'dcVol', 'dcOutlets'],
};

const num = v => (v === '' || v == null ? null : Number(v));
/** Thresholds for a fuel: { key: { value, default, source: assumption|user|derived|not held, label, unit, note } }. */
export function thresholdsFor(tech, { user = {}, pop = null } = {}) {
  const out = {};
  for (const [k, d] of Object.entries(THRESHOLDS)) {
    let def = d.default, src = d.unset ? 'not set' : 'assumption';
    if (k === 'dcPrice') {
      const v = (pop?.values?.lmp_2030 || []).filter(ok);
      def = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      src = def == null ? 'not held' : 'derived';
    }
    const u = num(user?.[k]);
    out[k] = ok(u) ? { ...d, value: u, default: def, source: 'user' } : { ...d, value: def, default: def, source: src };
  }
  return out;
}

/**
 * How many ISO-NE buses reach a capture threshold (%) on the market population's solar-hour ratio (2025, mart_bus_month
 * solar weighting) — context beside a capture verdict (F003), never a verdict itself. null when either is not held.
 */
export function capturePassCount(pop, thPct) {
  const v = (pop?.values?.solar_ratio || []).filter(ok);
  if (!ok(thPct) || !v.length) return null;
  const pass = v.filter(x => 100 * x >= thPct).length;
  return { pass, of: v.length, text: `${pass.toLocaleString('en-US')} of ${v.length.toLocaleString('en-US')} ISO-NE buses reach ${thPct}% on the 2025 solar-hour price ratio` };
}

/** Capture over rows with a per-hour weight g(row, i); hours with no weight still count in the average price. */
export function captureRatio(rows, g) {
  let n = 0, den = 0, hours = 0, sum = 0, missing = 0;
  rows.forEach((r, i) => {
    sum += r.price * r.dtHours; hours += r.dtHours;
    const w = g(r, i);
    if (w == null || !Number.isFinite(w)) { missing += r.dtHours; return; }
    n += w * r.price * r.dtHours; den += w * r.dtHours;
  });
  if (!den || !hours) return { capture: null, ratio: null, avg: hours ? sum / hours : null, missingHours: missing };
  const avg = sum / hours, cap = n / den;
  return { capture: cap, ratio: avg ? cap / avg : null, avg, missingHours: missing };
}

/**
 * ISO-NE fleet shape for each record: the same clock hour, else the 2025 reference hour; a solar night hour absent
 * from the feed is 0; any other gap stays null (not held). prof = { solar: { 'YYYY-MM-DDTHH': MW }, wind: {...} }.
 */
export function fleetShapeFor(recs, prof, fuel, isNight = () => false) {
  const src = prof?.[fuel];
  if (!src || !Object.keys(src).length) return null;
  let usedRef = 0, nightZero = 0, unfilled = 0;
  const shape = recs.map((r, i) => {
    const k = stampHour(r.timestamp);
    if (ok(src[k])) return src[k];
    const ref = `2025${k.slice(4)}`;
    if (ok(src[ref])) { usedRef++; return src[ref]; }
    if (fuel === 'solar' && isNight(r, i)) { nightZero++; return 0; }
    unfilled++; return null;
  });
  return { shape, usedRef, nightZero, unfilled };
}

function tb4Of(rows) { const sp = dailySpreads(rows, 4); return sp.length ? { value: sp.reduce((t, d) => t + d.spread, 0) / sp.length, days: sp.length } : null; }

/** The per-fuel metrics fuelVerdict reads, each from its home method. m = { exportLimit, importLimit, envelopeOnly }. */
export function fuelMetrics(data, node, basis, p, { fleet = null, m = null, pop = null } = {}) {
  const tech = p.tech, out = { tech, capture: { clearSky: null, fleet: null }, clip: null, tb4: null, oppLoss: null, dc: null };
  if (cape5Excluded(data, node, basis)) return { ...out, reason: CAPE5_REASON };
  const res = analyzePrices(data, coreBasis({ ...basis, nodeId: String(node.id) }));
  if (!res.summary) return { ...out, reason: res.errors.join(' ') || 'No prices on this basis' };
  const rows = res.rows, sky = r => clearSky(r.timestamp, node.latitude, node.longitude);
  const gen = ['solar', 'wind', 'hybrid'].includes(tech);
  if (tech === 'solar' || tech === 'hybrid') {
    const c = captureRatio(rows, sky);
    out.capture.clearSky = ok(c.ratio) ? { ...c, label: 'clear-sky shape (assumption)' } : null;
  }
  if (gen && fleet) {
    const fuel = tech === 'wind' ? 'wind' : 'solar', fs = fleetShapeFor(rows, fleet, fuel, r => sky(r) === 0);
    if (fs) { const c = captureRatio(rows, (r, i) => fs.shape[i]); out.capture.fleet = ok(c.ratio) ? { ...c, label: `ISO-NE ${fuel} fleet shape`, usedRef: fs.usedRef, unfilled: fs.unfilled } : null; }
  }
  if (gen && m && ok(m.exportLimit)) {
    const r = revenueFor(data, node, basis, tech, p.exportMW, { cf: p.cf, lossPct: p.lossPct, exportLimit: m.exportLimit, fleet });
    if (ok(r.genMWh) && r.genMWh > 0) out.clip = { share: r.spillMWh / r.genMWh, spillMWh: r.spillMWh, genMWh: r.genMWh, evidence: (m.envelopeOnly || []).some(l => /export/i.test(l)) ? 'envelope' : 'element' };
  }
  if (tech === 'storage' || tech === 'hybrid') out.tb4 = tb4Of(rows);
  if (tech === 'storage' && m) {
    const share = (lim, mw) => (ok(lim) && mw > 0 ? 100 * Math.max(0, 1 - Math.min(lim, mw) / mw) : null);
    const want = [Number(p.exportMW), Number(p.importMW)].filter(x => x > 0).length;
    const ex = share(m.exportLimit, Number(p.exportMW)), im = share(m.importLimit, Number(p.importMW)), held = [ex, im].filter(ok);
    if (held.length && held.length === want) out.oppLoss = { value: Math.max(...held), export: ex, import: im, evidence: (m.envelopeOnly || []).length ? 'envelope' : 'element' };
  }
  if (tech === 'datacenter') {
    const pv = k => (pop ? popValue(pop, k, node.id) : null);
    const hrs = rows.reduce((t, r) => t + r.dtHours, 0), mean = rows.reduce((t, r) => t + r.price * r.dtHours, 0) / hrs;
    const sd = Math.sqrt(rows.reduce((t, r) => t + (r.price - mean) ** 2 * r.dtHours, 0) / hrs);
    out.dc = { lmp2030: pv('lmp_2030'), std: pv('std') ?? sd, outlets: pv('outlets') };
  }
  return out;
}

const pct = v => `${v.toFixed(1)}%`;
/** Per-fuel verdict list: [{ test, value, threshold, verdict, why, bases? }]. Nothing held → Hold, never Pass. */
export function fuelVerdict(metrics = {}, tech, t = thresholdsFor(tech)) {
  const out = [];
  for (const k of FUEL_TESTS[tech] || []) {
    const th = t?.[k]?.value ?? null;
    const src = t?.[k]?.source, qualifier = src === 'user' ? 'your threshold' : src === 'assumption' ? 'assumed threshold' : src === 'derived' ? 'derived threshold' : null;
    // A Pass or Fail always says whose threshold it rests on (F003: "Fail (assumed threshold)", never a bare Fail).
    const row = (value, verdict, why, extra = {}) => out.push({ test: k, label: THRESHOLDS[k].label, unit: THRESHOLDS[k].unit, value, threshold: th, verdict, why, source: src, qualifier: verdict === 'Hold' ? null : qualifier, ...extra });
    if (k === 'capture') {
      const names = tech === 'wind' ? ['fleet'] : ['clear-sky', 'fleet'];
      const bases = names.map(b => { const r = (b === 'fleet' ? metrics.capture?.fleet : metrics.capture?.clearSky)?.ratio; return { basis: b, ratio: ok(r) ? r : null }; });
      const held = bases.filter(b => b.ratio != null), value = held.length ? Math.min(...held.map(b => 100 * b.ratio)) : null;
      const pass = held.filter(b => 100 * b.ratio >= th).length;
      const desc = bases.map(b => `${b.basis} ${b.ratio == null ? 'not held' : pct(100 * b.ratio)}`).join(', ');
      if (!ok(th)) row(value, 'Hold', `${desc}: threshold not set (open decision #2, owner Ganesh), so the capture test cannot pass or fail`, { bases });
      else if (held.length < bases.length) row(value, 'Hold', `${desc}: a basis is not held, so the capture test cannot pass or fail`, { bases });
      else if (pass === bases.length) row(value, 'Pass', `${desc}: every basis ≥ ${th}%`, { bases });
      else if (!pass) row(value, 'Fail', `${desc}: every basis < ${th}%`, { bases });
      else row(value, 'Hold', `${desc}: the bases disagree; the governing basis is open decision #2`, { bases });
    } else if (k === 'curtail') {
      const c = metrics.clip, v = c && ok(c.share) ? 100 * c.share : null;
      if (v == null) row(null, 'Hold', 'ISO curtailment not held; POI clipping not computed (no export limit held)');
      else if (c.evidence !== 'element') row(v, 'Hold', `POI clipping ${pct(v)} against an envelope-only limit (vendor-asserted); ISO curtailment not held`);
      else if (v > th) row(v, 'Fail', `POI clipping ${pct(v)} > ${th}% on element-study evidence`);
      else row(v, 'Hold', `POI clipping ${pct(v)} ≤ ${th}%, but ISO curtailment is not held, so this cannot pass`);
    } else if (k === 'tb4') {
      const v = metrics.tb4?.value;
      if (!ok(v) || !ok(th)) row(ok(v) ? v : null, 'Hold', 'TB4 spread not held on this basis');
      else row(v, v > th ? 'Pass' : 'Fail', `TB4 $${v.toFixed(2)}/MWh ${v > th ? '>' : '≤'} $${th}`);
    } else if (k === 'oppLoss') {
      const o = metrics.oppLoss;
      if (!o || !ok(o.value)) row(null, 'Hold', 'Grid limits not held for every requested direction');
      else if (o.evidence !== 'element') row(o.value, 'Hold', `${pct(o.value)} of power not carried, on envelope-only limits (vendor-asserted)`);
      else row(o.value, o.value <= th ? 'Pass' : 'Fail', `${pct(o.value)} of battery power the grid limits cannot carry (${o.value <= th ? '≤' : '>'} ${th}%)`);
    } else {
      const d = metrics.dc || {}, v = k === 'dcPrice' ? d.lmp2030 : k === 'dcVol' ? d.std : d.outlets;
      const what = k === 'dcPrice' ? 'LMP 2030' : k === 'dcVol' ? 'Price volatility' : 'Substation outlets';
      const f = x => (k === 'dcOutlets' ? String(x) : `$${x.toFixed(2)}`);
      if (!ok(v)) row(null, 'Hold', `${what} not held`);
      else if (!ok(th)) row(v, 'Hold', `${what} ${f(v)}: no market mean held to compare against`);
      else {
        const pass = k === 'dcPrice' ? v <= th : k === 'dcVol' ? v < th : v >= th;
        row(v, pass ? 'Pass' : 'Fail', `${what} ${f(v)} ${pass ? 'meets' : 'misses'} ${THRESHOLDS[k].label} ${f(th)}`);
      }
    }
  }
  return out;
}
