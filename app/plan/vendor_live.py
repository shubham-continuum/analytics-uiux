"""Vendor live Studio code into vendor/live/ from the pinned live snapshots, apply reviewed patches, write MANIFEST.json.

Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
· v2 2026-10-11 lift plan 14 L0: app.js sections cut by marker lines + the LMP Continuum ext files, from the 2026-10-11 pin
· v3 2026-10-13 lift plan 14 L2 (builder R-runtime): src/data.js -> app-data.json (UNWRAP), `loader` (LOADER) for live-runtime.js
Decision D-007 (A): verbatim by default; each patch is a reviewed vendor/live/patches/P*.json
{file, why, edits:[{find, replace}]}; every `find` must occur EXACTLY once or vendoring fails
(an upstream change that moves a patch site is caught, never silently skipped).
Never edit vendor/live/*.js|css by hand: re-run this script.

Two kinds of entry (FILES): a whole ext file, or a SECTION of src/app.js cut between two marker lines. A marker is a
line prefix that must match exactly one line of the source; a title marker right under a `/* ═══` rule includes that
rule. The section ends before the `end` marker (its rule too), or at EOF when end is None. Every source byte is first
checked against the pin's SHA256SUMS.txt (no vendoring from a drifted pin). `loaded` records whether a page loads the
file today (31/32: live-bridge.js VENDOR); the lift's files ship dark until their slice wires them (plan 14 §3).
A third kind (UNWRAP): a whole-file `window.X=<json>;` script kept as JSON — the prefix and the final `;` are stripped,
the body bytes are unchanged and must parse (no header: JSON has no comments; the manifest carries the provenance, the
column count and the extract's own vintage words). `loader` names the one module allowed to load a dark file (LOADER).

    python plan/vendor_live.py [--snapshots ../app-tools/live-snapshot] [--check]
--check exits 1 if vendor/live differs from what this script would write.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
STUDIO = APP.parent  # one-studio/: the manifest's paths are relative to it
VENDOR = APP / 'vendor' / 'live'
PATCHES = VENDOR / 'patches'
DEFAULT_SNAPSHOTS = STUDIO / 'app-tools' / 'live-snapshot'
P06, P11 = '2026-10-06', '2026-10-11'
RULE = '/* ═══'
# (output name, pin, source, start marker, end marker, loaded by a page today)
_ext = lambda n, pin=P11, loaded=False: (n, pin, f'ext/{n}', None, None, loaded)
FILES = [_ext(n, P06, True) for n in ('31-map-grid.js', '31-map-grid.css', '32-basemap.js', '32-basemap.css')] + [
    ('app-gs-model.js', P11, 'src/app.js', '   GridSense Analytics — data model (GS).', '   GridSense Analytics — chart renderers (Charts).', False),
    ('app-charts.js', P11, 'src/app.js', '   GridSense Analytics — chart renderers (Charts).', '   GridSense Analytics — application shell, state, widget host.', False),
    # a fragment from inside the shell IIFE (state, derived helpers, registry, overlays, project mutations): reference for L1's projects.js, never loaded
    ('app-project-store.ref.js', P11, 'src/app.js', '  /* ── state ──', '  /* ── node picker (command palette)', False),
    ('app-configurator.js', P11, 'src/app.js', '   GridSense Analytics — Graph Configurator (configurator.js).', None, False),
] + [_ext(n) for n in ('59-continuum-core.js', '60-cathy.js', '60-cathy.css', '61-hourly-timeline.js', '61-hourly-timeline.css',
                       '62-continuum-shape.js', '62-continuum-shape.css', '63-continuum-drivers.js', '63-continuum-drivers.css',
                       '64-continuum-value.js', '64-continuum-value.css', '68-continuum-emissions.js', '68-continuum-emissions.css')] + [
    ('app-data.json', P11, 'src/data.js', None, None, False),  # the 453-column GS_DATA extract the GS model + Configurator catalogue read (L2)
]
UNWRAP = {'app-data.json': 'window.GS_DATA='}
LOADER = {k: 'live-runtime.js' for k in ('app-gs-model.js', 'app-charts.js', 'app-data.json')}  # L2 runtime; dark until its script is wired


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


class PatchError(RuntimeError):
    pass


def apply_patches(name: str, text: str, patches: list[dict]) -> tuple[str, list[str]]:
    applied = []
    nl = '\r\n' if '\r\n' in text else '\n'  # the live source is CRLF on disk; patches are written with \n
    for p in patches:
        if p['file'] != name:
            continue
        for i, e in enumerate(p['edits']):
            find, repl = e['find'].replace('\n', nl), e['replace'].replace('\n', nl)
            n = text.count(find)
            if n != 1:
                raise PatchError(f"{p['id']} edit {i} on {name}: `find` occurs {n} times (must be exactly 1)")
            text = text.replace(find, repl)
        applied.append(p['id'])
    return text, applied


def pinned_sums(pin: Path) -> dict[str, str]:
    out = {}
    for line in (pin / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
        h, _, rel = line.strip().partition(' ')
        out[rel.lstrip('*').removeprefix('./')] = h
    return out


def marker_line(lines: list[str], marker: str, name: str) -> int:
    """0-based index where the section starts: the one line starting with `marker`, or the `/* ═══` rule just above it."""
    hits = [i for i, l in enumerate(lines) if l.startswith(marker)]
    if len(hits) != 1:
        raise PatchError(f'{name}: marker {marker!r} matches {len(hits)} lines (must be exactly 1)')
    i = hits[0]
    return i - 1 if i > 0 and lines[i - 1].startswith(RULE) else i


def cut(text: str, start: str, end: str | None, name: str) -> tuple[str, int, int]:
    """(section text ending in one newline, first line, last line) — 1-based, inclusive."""
    lines = text.split('\n')
    a = marker_line(lines, start, name)
    b = marker_line(lines, end, name) if end else len(lines) - (1 if lines[-1] == '' else 0)
    if b <= a:
        raise PatchError(f'{name}: end marker precedes start')
    return '\n'.join(lines[a:b]) + '\n', a + 1, b


def unwrap(text: str, prefix: str, name: str) -> tuple[str, dict]:
    """`prefix<json>;` -> (the json bytes unchanged + one newline, {columns, vintage}); fails unless the body parses."""
    t = text.rstrip()
    if not (t.startswith(prefix) and t.endswith(';')):
        raise PatchError(f'{name}: source is not `{prefix}<json>;`')
    body = t[len(prefix):-1]
    try:
        d = json.loads(body)
    except ValueError as e:
        raise PatchError(f'{name}: body after {prefix!r} is not JSON ({e})') from e
    meta = d.get('meta') or {}
    return body + '\n', {'columns': len(d.get('columns') or []), 'vintage': f"{meta.get('source')} · extract built {meta.get('built_at')}"}


def build(snapshots: Path) -> dict[str, bytes]:
    patches = []
    for f in sorted(PATCHES.glob('P*.json')):
        p = json.loads(f.read_text(encoding='utf-8'))
        p['id'] = f.stem
        p['sha256'] = sha(f.read_bytes())
        patches.append(p)
    rel = lambda p: p.resolve().relative_to(STUDIO.resolve()).as_posix() if p.resolve().is_relative_to(STUDIO.resolve()) else str(p.resolve())
    out = {}
    manifest = {'snapshots': {d: rel(snapshots / d) for d in sorted({e[1] for e in FILES})}, 'decision': 'D-007 A', 'files': {}, 'patches': {}}
    sums = {}
    for name, pin, source, start, end, loaded in FILES:
        if pin not in sums:
            sums[pin] = pinned_sums(snapshots / pin)
        src = (snapshots / pin / source).read_bytes()
        if sums[pin].get(source) != sha(src):
            raise PatchError(f'{pin}/{source} does not match its SHA256SUMS.txt (the pin drifted; never vendor from it)')
        rec = {'snapshot': pin, 'source': source, 'source_sha256': sha(src)}
        if name in UNWRAP:
            text, extra = unwrap(src.decode('utf-8'), UNWRAP[name], name)
            rec.update(unwrap=UNWRAP[name], **extra)
            header = ''
        elif start:
            text, a, b = cut(src.decode('utf-8'), start, end, name)
            rec.update(lines=[a, b], markers={'start': start, 'end': end}, section_sha256=sha(text.encode('utf-8')))
            note = ' Reference fragment from inside the shell IIFE; never loaded.' if name.endswith('.ref.js') else ''
            header = (f"/* VENDORED from live Studio {source} L{a}-{b} (snapshot {pin}, sha256 {sha(src)[:16]}), cut by marker lines.{note}\n"
                      f"   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/patches/. */\n")
        else:
            text = src.decode('utf-8')
            header = (f"/* VENDORED from live Studio {source} (snapshot {pin}, sha256 {sha(src)[:16]}).\n"
                      f"   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/patches/. */\n")
        text, applied = apply_patches(name, text, patches)
        body = (header + text).encode('utf-8')
        out[name] = body
        manifest['files'][name] = {**rec, 'patches': applied, 'result_sha256': sha(body), 'loaded': loaded, **({'loader': LOADER[name]} if name in LOADER else {})}
    for p in patches:
        manifest['patches'][p['id']] = {'file': p['file'], 'why': p['why'], 'sha256': p['sha256'], 'edits': len(p['edits'])}
    out['MANIFEST.json'] = (json.dumps(manifest, indent=1) + '\n').encode('utf-8')
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--snapshots', default=str(DEFAULT_SNAPSHOTS), help='folder holding the dated pins (live-snapshot/)')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args(argv)
    out = build(Path(a.snapshots))
    if a.check:
        bad = [n for n, b in out.items() if not (VENDOR / n).is_file() or (VENDOR / n).read_bytes() != b]
        print('vendor/live up to date' if not bad else f'vendor/live differs: {bad}')
        return 1 if bad else 0
    VENDOR.mkdir(parents=True, exist_ok=True)
    for n, b in out.items():
        (VENDOR / n).write_bytes(b)
    print(f'vendored {len(FILES)} files -> {VENDOR}')
    return 0


# ── continuum (lift plan 14 L4 · builder C-continuum · 2026-10-13) ─────────────────────────────────────────────────
# The LMP Continuum's ext files, whole from the 2026-10-11 pin, into vendor/live/continuum/ in LOAD ORDER (59 core first,
# 60 the screen host, then the modules that hook it). Patches: vendor/live/continuum/patches/C*.json, same rule as P*
# (each `find` exactly once). views/continuum.js loads these; MANIFEST.json carries them under `continuum`.
CONT_DIR = 'continuum'
CONT_PATCHES = VENDOR / CONT_DIR / 'patches'
CONT_FILES = ('59-continuum-core.js', '60-cathy.js', '60-cathy.css', '61-hourly-timeline.js', '61-hourly-timeline.css',
              '62-continuum-shape.js', '62-continuum-shape.css', '63-continuum-drivers.js', '63-continuum-drivers.css',
              '64-continuum-value.js', '64-continuum-value.css', '68-continuum-emissions.js', '68-continuum-emissions.css')


def build_continuum(snapshots: Path) -> tuple[dict[str, bytes], dict]:
    patches = []
    for f in sorted(CONT_PATCHES.glob('C*.json')):
        p = json.loads(f.read_text(encoding='utf-8'))
        p['id'], p['sha256'] = f.stem, sha(f.read_bytes())
        patches.append(p)
    sums, out = pinned_sums(snapshots / P11), {}
    sec = {'snapshot': P11, 'dir': f'vendor/live/{CONT_DIR}', 'order': list(CONT_FILES), 'loader': 'views/continuum.js', 'files': {}, 'patches': {}}
    for name in CONT_FILES:
        source = f'ext/{name}'
        src = (snapshots / P11 / source).read_bytes()
        if sums.get(source) != sha(src):
            raise PatchError(f'{P11}/{source} does not match its SHA256SUMS.txt (the pin drifted; never vendor from it)')
        header = (f"/* VENDORED from live Studio {source} (snapshot {P11}, sha256 {sha(src)[:16]}).\n"
                  f"   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/{CONT_DIR}/patches/. */\n")
        text, applied = apply_patches(name, src.decode('utf-8'), patches)
        body = (header + text).encode('utf-8')
        out[f'{CONT_DIR}/{name}'] = body
        sec['files'][name] = {'source': source, 'source_sha256': sha(src), 'patches': applied, 'result_sha256': sha(body)}
    for p in patches:
        if p['file'] not in CONT_FILES:
            raise PatchError(f"{p['id']}: file {p['file']} is not a continuum file")
        sec['patches'][p['id']] = {'file': p['file'], 'why': p['why'], 'sha256': p['sha256'], 'edits': len(p['edits'])}
    (VENDOR / CONT_DIR).mkdir(parents=True, exist_ok=True)
    return out, sec


_build_core = build


def build(snapshots: Path) -> dict[str, bytes]:  # noqa: F811 — the core build plus the continuum section
    out = _build_core(snapshots)
    cont, sec = build_continuum(snapshots)
    m = json.loads(out['MANIFEST.json'])
    m['continuum'] = sec
    out['MANIFEST.json'] = (json.dumps(m, indent=1) + '\n').encode('utf-8')
    out.update(cont)
    return out


# ── configurator (lift plan 14 L3 · builder G-configurator · 2026-10-13) ───────────────────────────────────────────
# The Graph Configurator section of the pinned src/app.js (title marker -> EOF: L5535-6315 with its header rule; the IIFE
# that sets window.Configurator = {open, asDef, removeWidget, undoRemove} is L5549-6315) and the live icon set it draws
# with (`icons` comment -> before `concerns`: ICONS + icon(), from inside the shell IIFE; patch F2 wraps it as a
# function expression) into vendor/live/configurator/. Patches: vendor/live/configurator/patches/F*.json, same rule as P*
# (each `find` exactly once). views/configurator-host.js is their only loader; MANIFEST.json carries them under
# `configurator`. (L0's dark reference copy vendor/live/app-configurator.js stays as it is.)
CFG_DIR = 'configurator'
CFG_PATCHES = VENDOR / CFG_DIR / 'patches'
CFG_FILES = [  # (output, pin, source, start marker, end marker) — in load order
    ('app-icons.js', P11, 'src/app.js', '  /* ── icons (lucide-style, inline)', '  /* ── concerns / vocabulary'),
    ('app-configurator.js', P11, 'src/app.js', '   GridSense Analytics — Graph Configurator (configurator.js).', None),
]


def build_configurator(snapshots: Path) -> tuple[dict[str, bytes], dict]:
    names = [f[0] for f in CFG_FILES]
    patches = []
    for f in sorted(CFG_PATCHES.glob('F*.json')):
        p = json.loads(f.read_text(encoding='utf-8'))
        p['id'], p['sha256'] = f.stem, sha(f.read_bytes())
        if p['file'] not in names:
            raise PatchError(f"{p['id']}: file {p['file']} is not a configurator file")
        patches.append(p)
    sec = {'snapshot': P11, 'dir': f'vendor/live/{CFG_DIR}', 'order': names, 'loader': 'views/configurator-host.js', 'files': {}, 'patches': {}}
    out = {}
    for name, pin, source, start, end in CFG_FILES:
        src = (snapshots / pin / source).read_bytes()
        if pinned_sums(snapshots / pin).get(source) != sha(src):
            raise PatchError(f'{pin}/{source} does not match its SHA256SUMS.txt (the pin drifted; never vendor from it)')
        text, a, b = cut(src.decode('utf-8'), start, end, name)
        header = (f"/* VENDORED from live Studio {source} L{a}-{b} (snapshot {pin}, sha256 {sha(src)[:16]}), cut by marker lines.\n"
                  f"   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/{CFG_DIR}/patches/. */\n")
        body_text, applied = apply_patches(name, text, patches)
        body = (header + body_text).encode('utf-8')
        out[f'{CFG_DIR}/{name}'] = body
        sec['files'][name] = {'source': source, 'source_sha256': sha(src), 'lines': [a, b], 'markers': {'start': start, 'end': end},
                              'section_sha256': sha(text.encode('utf-8')), 'patches': applied, 'result_sha256': sha(body)}
    for p in patches:
        sec['patches'][p['id']] = {'file': p['file'], 'why': p['why'], 'sha256': p['sha256'], 'edits': len(p['edits'])}
    (VENDOR / CFG_DIR).mkdir(parents=True, exist_ok=True)
    return out, sec


_build_before_cfg = build


def build(snapshots: Path) -> dict[str, bytes]:  # noqa: F811 — everything above plus the configurator section
    out = _build_before_cfg(snapshots)
    cfg, sec = build_configurator(snapshots)
    m = json.loads(out['MANIFEST.json'])
    m['configurator'] = sec
    out['MANIFEST.json'] = (json.dumps(m, indent=1) + '\n').encode('utf-8')
    out.update(cfg)
    return out


if __name__ == '__main__':
    sys.exit(main())
