// One home for where tests point and which Playwright they load.
// Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
// BASE comes from GS_BASE (set by tests/run-suite.mjs to an ephemeral test server); the fallback is the
// daily :8105 instance for a manual run. Playwright is the pinned copy in one-studio/testenv (tests/env.json).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ENV = JSON.parse(readFileSync(path.join(here, 'env.json'), 'utf8'));
export const BASE = (process.env.GS_BASE || ENV.defaultBase).replace(/\/$/, '');
export const pwRequire = createRequire(path.resolve(here, ENV.playwrightFrom));
