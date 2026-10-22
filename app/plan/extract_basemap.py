"""Copy the live Studio's offline vector basemap into the preview, read-only.

The live map (studio/ext/32-basemap.js) embeds public-domain geometry built by tools/studio_basemap.py: US Census
TIGER/Line 2023 cartographic boundaries (1:500k) and Natural Earth 1:10m. Land and water, rivers, state lines, county
lines and labels, Google-polyline encoded at 1/q degree, at several levels of detail. Licences and source URLs are in
studio/BASEMAP.md. This copies the payload verbatim to preview/data/basemap.json with a provenance header. Nothing
under the live Studio folder is written.

Run: python plan/extract_basemap.py
"""
import hashlib
import json
from pathlib import Path

LIVE = Path(r'D:\Ganesh\02 Products\GridSense\analytics-portfolio-canvas-2026-09-11\studio\ext\32-basemap.js')
OUT = Path(__file__).resolve().parent.parent / 'data' / 'basemap.json'
MARK = '/* <<BASEMAP>> */'


def main() -> None:
    src = LIVE.read_text(encoding='utf-8')
    i = src.index(MARK) + len(MARK)
    payload, _ = json.JSONDecoder().raw_decode(src[i:].lstrip())
    payload['_provenance'] = {
        'copied_from': 'analytics-portfolio-canvas-2026-09-11/studio/ext/32-basemap.js (read-only)',
        'source_sha256': hashlib.sha256(src.encode('utf-8')).hexdigest(),
        'licence': 'Public domain: US Census TIGER/Line 2023 cartographic boundaries; Natural Earth 1:10m (see studio/BASEMAP.md)',
        'encoding': 'Google polyline at 1/q degree, [lon, lat] pairs',
    }
    OUT.write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
    lod = payload.get('lod', [])
    print(f'{OUT} {OUT.stat().st_size:,} bytes; keys {sorted(k for k in payload if k != "lod")}; '
          f'{len(lod)} levels: ' + '; '.join(f"tol {L.get('tol')}: " + ', '.join(f'{k} {len(v)}' for k, v in L.items() if isinstance(v, list)) for L in lod))


if __name__ == '__main__':
    main()
