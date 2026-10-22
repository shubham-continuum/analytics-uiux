"""Land mini-map: handler must run before the generic re-render; equal-distance axes; side-by-side layout."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent

a = P / "app.js"
t = a.read_text(encoding="utf-8")
h0 = t.index("  app.addEventListener('click', e => {\n    const svg = e.target.closest('svg[data-site-map]')")
h1 = t.index("  });\n", h0) + len("  });\n")
handler = t[h0:h1]
t = t[:h0] + t[h1:]
handler = handler.replace("span = Number(svg.dataset.span);", "span = Number(svg.dataset.span), lspan = Number(svg.dataset.lspan);") \
                 .replace("fx * span", "fx * lspan") \
                 .replace("    render();\n", "    e.stopImmediatePropagation(); render();\n")
anchor = "  app.addEventListener('click', onEvent);\n"
assert anchor in t
t = t.replace(anchor, handler + anchor, 1)
a.write_text(t, encoding="utf-8")

v = P / "views/land.js"
t = v.read_text(encoding="utf-8")
old = "const bl = node?.latitude, bo = node?.longitude, R = 0.15, SZ = 400, px = lo => ((lo - (bo - R)) / (2 * R)) * SZ,"
assert old in t
t = t.replace(old, "const bl = node?.latitude, bo = node?.longitude, R = 0.15, RL = R / Math.cos(((bl || 0) * Math.PI) / 180), SZ = 400, px = lo => ((lo - (bo - RL)) / (2 * RL)) * SZ,", 1)
old = 'data-lon0="${bo - R}" data-span="${2 * R}"'
assert old in t
t = t.replace(old, 'data-lon0="${bo - RL}" data-span="${2 * R}" data-lspan="${2 * RL}"', 1)
old = "  return `<div class=\"panel\"><h2>Place the site</h2>${siteMap}</div><div class=\"panel\"><h2>Site and line assumptions</h2><div class=\"form-grid\">"
assert old in t
t = t.replace(old, "  return `<div class=\"two-col\"><div class=\"panel\"><h2>Place the site</h2>${siteMap}</div><div class=\"panel\"><h2>Site and line assumptions</h2><div class=\"form-grid\">", 1)
v.write_text(t, encoding="utf-8")
print("ok")
