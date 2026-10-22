"""Apply the Prices review fixes (3 High, 4 Medium, 5 Low) to the preview. Kept for audit."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert old in t, f"{name}: MISSING {old[:70]}"
        t = t.replace(old, new)
    p.write_text(t, encoding="utf-8")


# High 1: zone-free instants for offset-less (model-calendar) timestamps.
patch("prices.js", [
    ("function stampKey(stamp) { const text=String(stamp); return /(?:Z|[+-]\\d\\d:\\d\\d)$/.test(text)?Date.parse(text):`local:${text}`; }",
     "// Offset-less timestamps (forecast model calendar) are read as UTC so browser time zones and DST never change them.\n"
     "export function instant(stamp){const text=String(stamp);return Date.parse(/(?:Z|[+-]\\d\\d:\\d\\d)$/.test(text)?text:`${text}Z`);}\n"
     "function stampKey(stamp) { const text=String(stamp); return /(?:Z|[+-]\\d\\d:\\d\\d)$/.test(text)?Date.parse(text):`local:${text}`; }"),
    ("if(!Number.isFinite(Date.parse(r[0]))", "if(!Number.isFinite(instant(r[0]))"),
    ("rows.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));", "rows.sort((a,b)=>instant(a.timestamp)-instant(b.timestamp));"),
    ("if(Date.parse(rows[i].timestamp)<Date.parse(rows[i-1].timestamp)+rows[i-1].dtHours*3600000-1)", "if(instant(rows[i].timestamp)<instant(rows[i-1].timestamp)+rows[i-1].dtHours*3600000-1)"),
    ("const rows=included.flatMap(a=>a.rows).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp))", "const rows=included.flatMap(a=>a.rows).sort((a,b)=>instant(a.timestamp)-instant(b.timestamp))"),
    # High 3: equal/custom weights would annualise a partial year.
    ("if(!included.length)errors.push('No usable selected years.');",
     "if(!included.length)errors.push('No usable selected years.');if(basis.weighting!=='duration'&&included.some(a=>!a.series.complete))errors.push('Equal or custom year weights would give a partial year a full year’s weight. Use observed-hour weighting, or deselect the partial year.');"),
])
# Medium 6: complete day = records equal that day's own expected hours (23/24/25 from the offsets).
patch("prices.js", [
    ("return [...days].filter(([,r])=>r.length>=23&&r.length<=25&&r.length>=2*duration&&",
     "const expected=rs=>{const o=t=>{const m=/([+-])(\\d\\d):(\\d\\d)$/.exec(String(t));return m?(m[1]==='-'?-1:1)*(Number(m[2])+Number(m[3])/60):null;},a=o(rs[0].timestamp),b=o(rs.at(-1).timestamp);return a==null||b==null?24:24+(a-b);};\n"
     "return [...days].filter(([,r])=>r.length===expected(r)&&r.length>=2*duration&&"),
])
# Low 9: one weighted quantile for KPI and table.
patch("prices.js", [
    ("export function quantile(a,p){",
     "export function weightedQuantile(rows,p){const s=rows.filter(r=>finite(r.price)).sort((a,b)=>a.price-b.price),h=s.reduce((t,r)=>t+r.dtHours,0);if(!h)return null;let c=0;for(const r of s){c+=r.dtHours;if(c>=p*h)return r.price;}return s.at(-1).price;}\n"
     "export function quantile(a,p){"),
])

# High 2: clear-sky hour honours the timestamp's UTC offset.
patch("solar.js", [
    ("  // Local standard time (UTC-5) at the hour midpoint; longitude correction to solar time.\n  const solarHour = h + 0.5 + (lon - -75) / 15;",
     "  // Convert the clock hour to Eastern Standard Time using the stamp's own offset (-04:00 in summer).\n"
     "  // Offset-less forecast stamps have no recorded clock basis and are read as standard time.\n"
     "  const off = /([+-])(\\d\\d):(\\d\\d)$/.exec(String(timestamp));\n"
     "  const offsetH = off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) + Number(off[3]) / 60) : -5;\n"
     "  const standardHour = h - (offsetH - -5);\n"
     "  const solarHour = standardHour + 0.5 + (lon - -75) / 15;"),
])

patch("views/prices.js", [
    # Medium 4
    ("<tr><td><b>Total (= mean price)</b></td>", "<tr><td><b>Total (hour-weighted over the included years)</b></td>"),
    # Medium 5
    ("  const seg = `<div class=\"segmented\" role=\"group\" aria-label=\"Generation profile\">",
     "  const cape = capeNotice(data, S.basis);\n  const seg = `<div class=\"segmented\" role=\"group\" aria-label=\"Generation profile\">"),
    ("  return `<div class=\"panel\"><div class=\"panel-head\"><div><h2>Generation profile</h2>",
     "  return `${cape}<div class=\"panel\"><div class=\"panel-head\"><div><h2>Generation profile</h2>"),
    # Low 8, 11, 13
    ("'Price < $0. Curtailment screens use ≤ $0 (Risk hours tab).'", "'Price < $0. Curtailment screens use ≤ $0 (Tails & spreads tab).'"),
    ("kpi('Shape capacity factor', finite(c.cf) ? fmt.pct(100 * c.cf) : 'not held', '', 'Clear-sky; real output is lower (clouds, losses)')",
     "kpi('Clear-sky upper bound', finite(c.cf) ? fmt.pct(100 * c.cf) : 'not held', '', 'Not a capacity factor: clouds and losses cut real output well below this')"),
    ("fmt.price(s.mean).replace('$', '$')", "fmt.price(s.mean)"),
    # Low 9: table uses the same weighted quantile as the KPI
    ("import { analyzePrices, matchedBasis, hourlyShape, dailySpreads, quantile, finite } from '../prices.js';",
     "import { analyzePrices, matchedBasis, hourlyShape, dailySpreads, quantile, weightedQuantile, finite } from '../prices.js';"),
    ("const q = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99].map(p => [p, quantile(rows.map(r => r.price), p)]);",
     "const q = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99].map(p => [p, weightedQuantile(rows, p)]);"),
    # Low 10: say the weighting does not apply to basis
    ("`<p>Basis = node price − hub price for each hour present in both series with the same interval length. Components: price = energy + congestion + losses.</p>`",
     "`<p>Basis = node price − hub price for each hour present in both series with the same interval length, pooled over the included years. The year-weighting selector applies only to the headline mean, not to basis or components. Components: price = energy + congestion + losses.</p>`"),
    # Medium 7: model calendar is 365 days
    ("${y.complete ? '' : ` <em>${y.coverage >= 0.99 ?", "${y.complete ? '' : ` <em>${y.coverage >= 0.99 ?"),
])

patch("app.js", [
    # Medium 7: default forecast run = 10-yr run (not the Cape-flagged 5-yr run)
    ("if (v === 'forecast') { const runs = forecastRuns(D, S.nodeId); d.run = d.run || runs[0]?.run;",
     "if (v === 'forecast') { const runs = forecastRuns(D, S.nodeId); d.run = d.run || (runs.find(r => r.run === '10yr') || runs[0])?.run;"),
    # Low 12: include-partial applies only the flag to the current basis
    ("'include-partial': () => { const d = draft(); d.includePartial = true; S.basis = structuredClone(d); toast('Applied with partial coverage. Missing hours stay missing.'); },",
     "'include-partial': () => { S.basis = { ...S.basis, includePartial: true }; S.draft = { ...(S.draft || S.basis), includePartial: true }; toast('Applied with partial coverage. Missing hours stay missing.'); },"),
])
print("patched OK")
