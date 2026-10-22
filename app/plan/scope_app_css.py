"""Scope the preview stylesheet under the analyzer roots so it can sit beside the live Studio's CSS.

v6 (2026-10-01): the preview now loads a read-only copy of the live stylesheet (studio/studio.css) and renders the live
chrome markup. app.css must then style only the analyzer body (.gsx-an) and the preview's overlay layer (.gsx-layer:
modals, drawers, toast), never the live chrome. This wraps every top-level rule in `.gsx-an,.gsx-layer{ ... }` (CSS
nesting), keeps :root custom properties and @import/@keyframes/@font-face at the top level, and drops rules that style
the document itself (html, body), which the live stylesheet owns. Idempotent: an already-scoped file is left alone.

Run: python plan/scope_app_css.py            (writes app.css; backup plan/app.css.pre-v6.bak on first run)
"""
import re
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = HERE / 'app.css'
BAK = HERE / 'plan' / 'app.css.pre-v6.bak'
MARK = '/* v6-scoped */'
SCOPE = '.gsx-an,.gsx-layer'


def statements(css: str):
    """Top-level statements: (prelude, block-or-None). Comments are kept attached to the next statement."""
    out, i, n, start, depth, pre_end = [], 0, len(css), 0, 0, 0
    while i < n:
        if css.startswith('/*', i):
            j = css.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        c = css[i]
        if c in '"\'':
            j = i + 1
            while j < n and css[j] != c:
                j += 2 if css[j] == '\\' else 1
            i = j + 1
            continue
        if c == '{':
            if depth == 0:
                pre_end = i
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                out.append((css[start:pre_end], css[pre_end + 1:i]))
                start = i + 1
        elif c == ';' and depth == 0:
            out.append((css[start:i + 1], None))
            start = i + 1
        i += 1
    tail = css[start:]
    return out, tail


def strip_comments(s: str) -> str:
    return re.sub(r'/\*.*?\*/', '', s, flags=re.S).strip()


LIVE_CSS = HERE / 'studio' / 'studio.css'
LIVE_VARS = set(re.findall(r'(--[a-z0-9-]+)\s*:', LIVE_CSS.read_text(encoding='utf-8'))) if LIVE_CSS.exists() else set()


def root_vars_only(block: str) -> str:
    """Keep only custom-property declarations from a :root block, minus any the live stylesheet defines (live wins)."""
    decls = [d.strip() for d in re.sub(r'/\*.*?\*/', '', block, flags=re.S).split(';')]
    return ';'.join(d for d in decls if d.startswith('--') and d.split(':', 1)[0].strip() not in LIVE_VARS)


def main() -> None:
    css = SRC.read_text(encoding='utf-8')
    if css.startswith(MARK):
        print('already scoped')
        return
    if not BAK.exists():
        shutil.copyfile(SRC, BAK)
    stmts, tail = statements(css)
    top, scoped, dropped = [], [], []
    for pre, block in stmts:
        sel = strip_comments(pre)
        comment = pre[:len(pre) - len(pre.lstrip())] + ''.join(re.findall(r'/\*.*?\*/', pre, flags=re.S))
        if block is None:                                   # @import / @charset
            top.append(pre.strip())
        elif sel.startswith('@keyframes') or sel.startswith('@font-face'):
            top.append(f'{sel}{{{block}}}')
        elif sel == ':root':
            v = root_vars_only(block)
            if v:
                top.append(f':root{{{v}}}')
        elif re.fullmatch(r'(html|body)(\s*,\s*(html|body))*', sel):
            dropped.append(sel)
        else:
            scoped.append(f'{comment}\n{sel}{{{block}}}' if comment.strip() else f'{sel}{{{block}}}')
    body = '\n'.join(scoped) + strip_comments(tail)
    out = (f'{MARK}\n/* The analyzer body and overlay layer only: the live Studio stylesheet (studio/studio.css) owns the document\n'
           f'   and the chrome. Source before scoping: plan/app.css.pre-v6.bak. Regenerate: python plan/scope_app_css.py */\n'
           + '\n'.join(top) + f'\n{SCOPE}{{\n{body}\n}}\n')
    SRC.write_text(out, encoding='utf-8')
    print(f'scoped {len(scoped)} rules; kept {len(top)} top-level; dropped {len(dropped)} document rules: {dropped}')


if __name__ == '__main__':
    main()
