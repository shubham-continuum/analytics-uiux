"""Gantt: room on the right for an open-ended step's label; month gridlines drawn under the bars."""
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "charts.js"
t = p.read_text(encoding="utf-8")
old = "  const lo = Math.min(...starts), hi = Math.max(...ends, lo + 30 * 864e5), x = scale(lo, hi, M.l, W - M.r), rh = (H - M.t - M.b) / t.length;\n  let svg = '';"
assert old in t
t = t.replace(old,
    "  const lo = Math.min(...starts), hi0 = Math.max(...ends, lo + 30 * 864e5), hi = t.some(k => !k.end) ? hi0 + (hi0 - lo) * 0.16 : hi0;\n"
    "  const x = scale(lo, hi, M.l, W - M.r), rh = (H - M.t - M.b) / t.length;\n  let svg = '';\n  const grid = [];", 1)
old = "  const months = [];"
i0 = t.index(old)
i1 = t.index("join('');", t.index("svg += months.filter", i0)) + len("join('');")
block = t[i0:i1]
t = t[:i0] + t[i1:]
block = block.replace("svg += months.filter", "grid.push(months.filter").rstrip(";") + ");"
# gridlines first, then rows (bars above lines)
anchor = "  t.forEach((k, i) => {\n    const yy = M.t + i * rh;"
assert anchor in t
t = t.replace(anchor, block + "\n  svg += grid.join('');\n" + anchor, 1)
p.write_text(t, encoding="utf-8")
print("ok")
