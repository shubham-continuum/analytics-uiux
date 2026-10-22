"""P3 calc spec 07 (decision): dump the Decision population payload (api_decision._population) from the unified DB,
read-only, so the worked examples in 07-decision.md use the same payload the live API serves today.
Usage: python 07-decision-population.py  ->  out/07-population.json
Provenance: Claude Opus 5.5 (P3 spec:decision agent) · one-studio-devkit/design/plan.md P3 · 2026-10-15 · v1
"""
import json
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[4] / 'one-studio' / 'app'
sys.path.insert(0, str(APP))
import busdata  # noqa: E402  (busdata.connect() opens the DB read_only=True)
import api_decision  # noqa: E402

out = Path(__file__).resolve().parent / 'out' / '07-population.json'
c = busdata.connect()
p = api_decision._population(c)
out.write_text(json.dumps(p), encoding='utf-8', newline='\n')
print(json.dumps({'file': str(out), 'buses': len(p['ids']), 'runHours': p['runHours'], 'db': str(busdata.SOURCE)}))
