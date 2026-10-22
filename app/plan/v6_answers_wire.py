"""V6 (Agent 3): attach computed answer sentences to Prices / Economics cards.

Each spec row: (file, marker, expr). The ONE line containing `marker` must contain `{ depth: ` exactly once after the
marker; it becomes `{ answer: <expr>, depth: `. Asserts every marker matches one line, so a drifted file fails loudly.
Usage: python plan/v6_answers_wire.py <spec.json>   (spec = [[file, marker, expr], ...])
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
files = {}
for f, marker, expr in spec:
    text = files.setdefault(f, (ROOT / f).read_text(encoding='utf-8'))
    lines = text.split('\n')
    hits = [i for i, l in enumerate(lines) if marker in l]
    assert len(hits) == 1, f'{f}: marker {marker!r} matched {len(hits)} lines'
    l = lines[hits[0]]
    at = l.index(marker)
    rest = l[at:]
    for opt in ('{ depth: ', '{ tools: ', '{ trace: ', '{ chips: ', '{ foot: '):
        if opt in rest:
            j = at + rest.index(opt)
            if 'answer:' in l[at:j]: raise AssertionError(f'{f}: {marker!r} already has an answer')
            break
    else:
        # economics tagged({ depth… }, span, 'Title', …): the options object precedes the title.
        before = [l.rfind(o, 0, at) for o in ('{ depth: ', '{ trace: ')]
        j = max(before)
        if j < 0: raise AssertionError(f'{f}: no options object around {marker!r}')
    lines[hits[0]] = l[:j] + '{ answer: ' + expr + ', ' + l[j + 2:]
    files[f] = '\n'.join(lines)
for f, text in files.items():
    (ROOT / f).write_text(text, encoding='utf-8')
    print('wired', f)
