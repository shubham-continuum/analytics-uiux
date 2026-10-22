// Battery charge caps by hour: the studied charge limits applied to the dispatch, with the governing case named.
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S2-EM) · 2026-10-06 · sign-off pending · v1
// Finding F008 (blocker): the dispatch charged at 100 MW all year on the shoulder envelope while the element study
// limits summer-peak withdrawal at Hatchville to 20.4 MW. Acceptance (02-inputs-outputs): "dispatch never charges
// above the governing charge limit; the card says which case governs".
// Rules:
//  - ISO-NE studies storage charging at net shoulder load, never at peak (PP5-6 §9; REGISTER "Storage charging study
//    basis", verified; rules interconnection.schedule22.storage_charging_study_basis). So the shoulder charge case
//    governs every hour; when it is held by the vendor envelope only, results are conditional (D6.1: the element study
//    is the source of record, the envelope is context).
//  - Screening cap: in the summer-peak hour set the dispatch is also held to the summer-peak withdrawal limit from
//    the element study (never the envelope). It is not an ISO-NE storage study condition, so the card says so; it stops
//    the dispatch from charging above a limit the element study shows. The hour set comes from the rules file
//    (interconnection.storage_charge_screen.peak_window; Lead wiring W1); without it the screen is not applied and
//    the card says why. Value at the governing caps is shown beside the shoulder-only value.
import { caseTable, elementLimit, envelope } from './gridrules.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mw = v => `${Math.abs(v - Math.round(v)) < 1e-9 ? v.toFixed(0) : v.toFixed(1)} MW`;

/** Shoulder charge (governing) and summer-peak withdrawal (element study only) for a storage request of `size` MW. */
export function chargeLimits(grid, bus, size) {
  const row = caseTable(grid, bus, 'storage', size, size).find(r => r.key === 'shoulder|charge');
  const el = elementLimit(grid, bus, 'summer_peak|charge');
  return {
    shoulder: { value: ok(row?.governing) ? row.governing : null, basis: row?.basis || 'Not studied', envelopeOnly: /^Envelope/.test(row?.basis || '') },
    peak: { value: el.status === 'held' ? el.limit : null, basis: el.status === 'held' ? 'Element study' : el.status === 'noViolation' ? 'No violations found (no limit published)' : 'No element-study limit', facility: el.facility || null, envelope: envelope(grid, bus, 'summer_peak|charge') },
  };
}

/** Rules window {months:[6..9], heFrom, heTo} (hour ending). True when a source-clock stamp falls inside it. */
export function isPeakHour(timestamp, w) {
  const m = /^\d{4}-(\d{2})-\d{2}T(\d{2})/.exec(String(timestamp));
  if (!m || !w) return false;
  const he = Number(m[2]) + 1;
  return w.months.includes(Number(m[1])) && he >= w.heFrom && he <= w.heTo;
}
export const peakWindowLabel = w => (w ? `${MON[Math.min(...w.months) - 1]}–${MON[Math.max(...w.months) - 1]}, HE${w.heFrom}–HE${w.heTo}` : 'not in the rules file');
/**
 * The rules-file entry (interconnection.storage_charge_screen.peak_window) → {months, heFrom, heTo}, or null when it is
 * absent or incomplete. S3 wrote the entry with `he_start` / `he_end` (hour ending); the earlier draft read `he_from` /
 * `he_to`, so the window was silently never applied (W-B close-out, 2026-10-07). Both spellings are accepted here, once.
 */
export function windowFromRules(w) {
  if (!w || !Array.isArray(w.months) || !w.months.length) return null;
  const from = ok(w.he_start) ? w.he_start : w.he_from, to = ok(w.he_end) ? w.he_end : w.he_to;
  return ok(from) && ok(to) ? { months: w.months, heFrom: from, heTo: to } : null;
}

/**
 * Per-record charge cap (MW). other hours: min(nameplate, shoulder); summer-peak hours: also ≤ the element-study
 * summer-peak withdrawal limit. Returns {caps, peakHours, applied, conditional, governing, note, capOther, capPeak}.
 */
export function chargeCaps(records, { nameplate, shoulder, peak, window }) {
  const sh = ok(shoulder?.value) ? shoulder.value : null, pk = ok(peak?.value) ? peak.value : null;
  const capOther = sh == null ? nameplate : Math.min(nameplate, sh);
  const applied = !!window && pk != null && pk < capOther;
  const capPeak = applied ? Math.min(capOther, pk) : capOther;
  let peakHours = 0;
  const caps = records.map(r => { if (applied && isPeakHour(r.timestamp, window)) { peakHours++; return capPeak; } return capOther; });
  const conditional = sh == null || !!shoulder?.envelopeOnly;
  const shText = sh == null ? 'Shoulder charge limit not established (not studied or on hold): charging capped at nameplate, so every result is conditional' : `Shoulder charge governs (ISO-NE studies storage charging at shoulder, never at peak): ${mw(capOther)}${shoulder?.envelopeOnly ? ' on the vendor envelope only (conditional)' : ''}`;
  const pkText = applied ? `; screening cap ${mw(capPeak)} in summer-peak hours (${peakWindowLabel(window)}, element study)` : '';
  const note = !window ? 'Summer-peak screening cap not applied: the summer-peak hour window is not in the rules file.' : pk == null ? `Summer-peak screening cap not applied: ${peak?.basis || 'no element-study limit'}.` : !applied ? `Summer-peak withdrawal limit ${mw(pk)} does not bind below ${mw(capOther)}.` : '';
  return { caps, peakHours, applied, conditional, capOther, capPeak, governing: `${shText}${pkText}.`, note };
}
