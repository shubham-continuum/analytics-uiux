// Clear-sky solar shape (assumption, not a measured profile). Returns per-MW output 0..1 from
// solar elevation at the bus location. Used only when no generation profile is supplied, and every
// result that uses it is labelled "clear-sky assumption".
const RAD = Math.PI / 180;

// The stamp-only half (declination, clock hour in EST) is memoised per stamp string: every bus reads the same stamps
// (Grid pfp_exp: 2,678 buses × every CSC interval at page load). Same operations in the same order, so bit-identical
// (tests/load-perf.test.mjs keeps the unmemoised formula as the reference).
const STAMP = new Map();
function stampPart(timestamp) {
  const key = String(timestamp);
  let v = STAMP.get(key);
  if (v !== undefined) return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(key);
  if (!m) v = null;
  else {
    const [y, mo, d, h] = m.slice(1).map(Number);
    const doy = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
    const decl = 23.44 * Math.sin(RAD * (360 / 365) * (doy - 81));
    // Convert the clock hour to Eastern Standard Time using the stamp's own offset (-04:00 in summer).
    // Offset-less forecast stamps have no recorded clock basis and are read as standard time.
    const off = /([+-])(\d\d):(\d\d)$/.exec(key);
    const offsetH = off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) + Number(off[3]) / 60) : -5;
    v = { standardHour: h - (offsetH - -5), sinDecl: Math.sin(RAD * decl), cosDecl: Math.cos(RAD * decl) };
  }
  if (STAMP.size >= 200000) STAMP.clear();
  STAMP.set(key, v);
  return v;
}

export function clearSky(timestamp, lat, lon) {
  const t = stampPart(timestamp);
  if (!t || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const solarHour = t.standardHour + 0.5 + (lon - -75) / 15;
  const ha = 15 * (solarHour - 12);
  const sinEl = Math.sin(RAD * lat) * t.sinDecl + Math.cos(RAD * lat) * t.cosDecl * Math.cos(RAD * ha);
  return Math.max(0, sinEl);
}

// S2-EM D5 (2026-10-06): one solar window and one label format. The window is the unified mart's definition
// (mart_bus_month.solar_lmp: mean over hours beginning 9–16, i.e. HE10–HE17; api_prices.py documents it). Every
// surface that shows a solar-window figure labels it with solarWindowLabel(); Market's 2030 ratio uses the same window.
export const MART_SOLAR_WINDOW = Object.freeze({ hbFrom: 9, hbTo: 16, src: 'unified mart_bus_month.solar_lmp window' });
/** "HE10–HE17 (hours beginning 9–16, 8 h)": hour-ending first (ISO-NE convention), the clock hours after. */
export function solarWindowLabel(w = MART_SOLAR_WINDOW) {
  return `HE${w.hbFrom + 1}–HE${w.hbTo + 1} (hours beginning ${w.hbFrom}–${w.hbTo}, ${w.hbTo - w.hbFrom + 1} h)`;
}
/** True when a clock hour (hour beginning, 0–23) is inside the window. */
export const inSolarWindow = (hour, w = MART_SOLAR_WINDOW) => hour >= w.hbFrom && hour <= w.hbTo;

/** Capture price over rows [{timestamp, price, dtHours}] with a per-MW shape g(row). */
export function capture(rows, g) {
  let num = 0, den = 0, hours = 0, sum = 0;
  for (const r of rows) {
    const w = g(r);
    if (w == null) continue;
    num += w * r.price * r.dtHours; den += w * r.dtHours;
    sum += r.price * r.dtHours; hours += r.dtHours;
  }
  if (!den || !hours) return { capture: null, ratio: null, avg: null, energyPerMW: null };
  const avg = sum / hours, cap = num / den;
  return { capture: cap, ratio: avg ? cap / avg : null, avg, energyPerMW: den, cf: den / hours };
}
