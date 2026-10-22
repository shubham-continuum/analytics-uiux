"""Pinned live snapshots (app-tools/live-snapshot/<date>/SHA256SUMS.txt): hash_check verifies every pin, byte for byte.

Provenance: Claude Opus 5.5 · one-studio/design 14-lift (slice L0) · 2026-10-11 · sign-off pending · v1
The 2026-10-11 pin is the only source the lift (Projects, Configurator, Continuum) vendors from; a changed, missing
or unlisted file in a pin fails `hash_check.py check`. Tampering is tested on a temporary copy, never on the pin.
"""
import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[2] / 'app-tools'
PIN = TOOLS / 'live-snapshot' / '2026-10-11'
spec = importlib.util.spec_from_file_location('hash_check', TOOLS / 'hash_check.py')
hc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hc)

L0_FILES = {'src/app.js', 'src/data.js', 'ext/59-continuum-core.js', 'ext/60-cathy.js', 'ext/60-cathy.css',
            *(f'ext/{n}.{x}' for n in ('61-hourly-timeline', '62-continuum-shape', '63-continuum-drivers', '64-continuum-value', '68-continuum-emissions') for x in ('js', 'css'))}


class Pins(unittest.TestCase):
    def test_l0_pin_holds_exactly_the_plan_files(self):
        self.assertEqual(set(hc.read_sums(PIN)), L0_FILES)

    def test_every_pin_verifies(self):
        pins = hc.pins()
        self.assertIn(PIN, pins)
        for p in pins:
            self.assertEqual(hc.verify_pin(p), [], p.name)

    def test_tampered_copy_is_caught(self):
        with tempfile.TemporaryDirectory() as t:
            c = Path(t) / 'pin'
            shutil.copytree(PIN, c)
            (c / 'ext' / '60-cathy.css').write_bytes((c / 'ext' / '60-cathy.css').read_bytes() + b'\n')
            (c / 'ext' / '68-continuum-emissions.js').unlink()
            (c / 'ext' / 'stray.js').write_text('x', encoding='utf-8')
            probs = hc.verify_pin(c)
            self.assertTrue(any('CHANGED ext/60-cathy.css' in x for x in probs), probs)
            self.assertTrue(any('MISSING ext/68-continuum-emissions.js' in x for x in probs), probs)
            self.assertTrue(any('UNLISTED ext/stray.js' in x for x in probs), probs)

    def test_pins_mode_exit_code(self):
        r = subprocess.run([sys.executable, str(TOOLS / 'hash_check.py'), 'pins'], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('2026-10-11: 15 files OK', r.stdout)


if __name__ == '__main__':
    unittest.main()
