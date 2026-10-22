"""Copy the live Studio's stylesheet into the preview, read-only, in the live build order.

The live dist (tools/studio_build.py) inlines src/fonts.css, then src/styles.css, then every ext/*.css sorted by name.
The preview already ships the same two font faces (fonts.css), so this copies styles.css + ext/*.css only, into
preview/studio/studio.css, with a manifest of source hashes so a later run shows whether the live CSS moved on.
Nothing under the live Studio folder is written.

Run: python plan/extract_studio_css.py
"""
import hashlib
import json
from pathlib import Path

LIVE = Path(r'D:\Ganesh\02 Products\GridSense\analytics-portfolio-canvas-2026-09-11\studio')
OUT = Path(__file__).resolve().parent.parent / 'studio'


def main() -> None:
    parts = [LIVE / 'src' / 'styles.css', *sorted(p for p in (LIVE / 'ext').iterdir() if p.suffix == '.css')]
    OUT.mkdir(exist_ok=True)
    chunks, manifest = [], []
    for p in parts:
        text = p.read_text(encoding='utf-8')
        chunks.append(f'/* ── live: {p.relative_to(LIVE).as_posix()} ── */\n{text}\n')
        manifest.append({'file': p.relative_to(LIVE).as_posix(), 'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(), 'bytes': len(text.encode('utf-8'))})
    head = ('/* Read-only copy of the live GridSense Studio stylesheet (styles.css + ext/*.css, live build order).\n'
            '   Regenerate with: python plan/extract_studio_css.py. Do not edit: preview overrides go in studio-bridge.css. */\n')
    (OUT / 'studio.css').write_text(head + ''.join(chunks), encoding='utf-8')
    (OUT / 'studio-css-manifest.json').write_text(json.dumps(manifest, indent=1), encoding='utf-8')
    print(f'{len(parts)} files, {sum(m["bytes"] for m in manifest):,} bytes -> {OUT / "studio.css"}')


if __name__ == '__main__':
    main()
