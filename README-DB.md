# Attaching a database to One Studio

One Studio runs in one of two modes.

- **Fixtures mode** replays answers recorded from the database. It needs no database file; see `app/README.md`.
- **Database mode** reads ISO-NE data live from DuckDB files.

This file covers database mode: where the files go, how to point the app at a new one, what to rebuild afterwards, and where in the code each of these is decided.

## The two database files

| File | What it is | Where the code expects it |
|---|---|---|
| `ISONE_GridSense_unified.duckdb` | The main database. Every API reads it. Unified schema; the current build is from 2026-09-09. | The path you pass with `--db` |
| `ISONE_GridSense.duckdb` | The older study store, in the legacy schema. Grid reads its headroom envelope and element limit for its "older copy" data notes. | Two folders above the `--db` file, under exactly this name |

The layout used on this machine:

```
one-studio-devkit/
  db/                                       git-ignored: never commit the database files
    ISONE_GridSense.duckdb                  legacy store (optional)
    unified/
      ISONE_GridSense_unified.duckdb        main database
```

On macOS, `cp -c` makes an instant APFS clone instead of a full copy, so a 6 GB file takes no extra disk space:

```
cp -c ~/Downloads/ISONE_GridSense_unified.duckdb db/unified/ISONE_GridSense_unified.duckdb
cp -c ~/Downloads/ISONE_GridSense.duckdb db/ISONE_GridSense.duckdb
```

## Attach a new database, step by step

1. **Put the file in place.** Copy or clone it into `db/unified/`. If it is in the legacy schema, convert it first (see "A database in the legacy schema" below).

2. **Stop the running server.** Press Ctrl+C in its terminal, or stop the process listening on the port.

3. **Start the server with the new path.** `--db` needs an absolute path, and the file is opened read-only:

   ```
   cd app
   python3.13 server.py --port 8106 --db /absolute/path/to/one-studio-devkit/db/unified/ISONE_GridSense_unified.duckdb
   ```

   Use a Python that has the `duckdb` package installed (`python3.13 -c "import duckdb"` must succeed).
   `app/Start-Preview.ps1` predates the `--db` flag and starts the server without it, so start the server with the command above instead.

4. **Rebuild the map and grid cache for this database.** The network map and the data grid read a pre-built cache in `app/data/mapgrid/`. The server refuses a cache built from a different file (it answers 503 "mapgrid stale"), so rebuild it:

   ```
   cd app
   python3.13 plan/build_mapgrid.py --db /absolute/path/to/one-studio-devkit/db/unified/ISONE_GridSense_unified.duckdb
   ```

   The builder keeps only the newest two cache generations and deletes older ones, including the two the kit ships in Git. Restore those so they don't show as deleted:

   ```
   git checkout -- app/data/mapgrid/g-c3ff531f7ba7b5d3-18dc13d6a56bdae4 app/data/mapgrid/g-eb62c60d6c09bbde-18dbf4db41b17014
   ```

   The running server picks up the new cache at once; no restart is needed.

5. **Check that it is attached.**

   - http://127.0.0.1:8106/health shows the database path (`db`) and its modification time (`db_mtime`).
   - http://127.0.0.1:8106/api/x/mapgrid/meta/all answers 200. A 503 means step 4 is missing.
   - Open http://127.0.0.1:8106/analytics-analyzer-studio.html and step through the seven stages.

6. **Optionally, run the tests** (see "Running the tests" below).

## Where the code decides which database is used

Line numbers are as of 2026-10-23; search for the quoted code if they have moved.

| What | Where | Notes |
|---|---|---|
| The flag | `app/server.py` line 162, `src.add_argument('--db', …)` | One of `--db` or `--fixtures` is required (line 161). |
| Applying it | `app/server.py` line 186, `busdata.SOURCE=db` | Every API reads this one path. There is no silent fallback. |
| The default path, for scripts that import `busdata` without the server | `app/busdata.py` line 22, `SOURCE = ROOT.parents[1] / 'unified' / 'ISONE_GridSense_unified.duckdb'` | That is `unified/ISONE_GridSense_unified.duckdb` in the folder that contains the dev kit. |
| The legacy store | `app/api_grid.py` line 25, `OLD_DB = Path(busdata.SOURCE).parents[1] / 'ISONE_GridSense.duckdb'` | Two folders above the `--db` file. If it is missing, `_old()` (line 87) returns nothing and Grid's answers carry no older-copy figures. Nothing else fails. |
| Map and grid cache freshness | `app/api_mapgrid.py` lines 90–108, `fresh()` | The cache must record the same database path, modification time and schema hash as the served file; otherwise the API answers 503. |
| Map and grid cache builder | `app/plan/build_mapgrid.py` line 680, `--db` | It also reads the `GRIDSENSE_UNIFIED_DB` environment variable. |
| Response cache | `app/busdata.py` line 350 | Cached answers in `app/cache/` are keyed by the database file's modification time, so a different file gets fresh answers. Delete `app/cache/` only if you replace a file with one that has the same modification time. |
| Decision's Studio comparison | `app/api_decision.py` line 17, `STUDIO_DATA` | Not a database. It reads `analytics-portfolio-canvas-2026-09-11/studio/src/data.js` in the folder that contains the dev kit. Without it, that one request answers 404 and the rest of Decision works. |
| Snapshot extractor | `app/extract_snapshot.py` line 18 | Its default source. |
| Tests | `app/tests/run-suite.mjs` line 18 (`--db`), `app/tests/css-leak.mjs` line 16 (`GS_DB`) | The Python tests hard-code the default path: `test_server_cli.py` line 16, `test_proxy.py` line 22, `test_fixtures_mode.py` line 21 and `test_mapgrid_http.py` line 18. Put a copy or an APFS clone there. |

## A database in the legacy schema

The app reads only the unified schema. To check which schema a file uses, list its tables:

```
python3.13 -c "import duckdb,sys; c=duckdb.connect(sys.argv[1], read_only=True); print(sorted(t for (t,) in c.execute('show tables').fetchall()))" <file>
```

- A unified file has `dim_bus`, `fact_lmp_hourly` and `build_manifest`.
- A legacy file has `substations_corrected`, `constraints_sp_sub_dis` and `lmp_hourly_hist`.

To use a legacy file as the main database, convert it, check the result, then attach the converted file with `--db`:

```
python3.13 tools/convert_legacy_db.py --src /path/ISONE_GridSense.duckdb --out /path/unified/ISONE_GridSense_converted.duckdb
python3.13 tools/validate_converted_db.py --db /path/unified/ISONE_GridSense_converted.duckdb
```

A converted file holds only what the old store has. Day-ahead prices, the PCR runs and several other tables are created empty, so those cards show "not held". Use a native unified build whenever you have one.

## Running the tests

- **Install Playwright once.** The tests use the version pinned in `app/tests/env.json` and the installed Google Chrome:

  ```
  mkdir -p testenv && cd testenv && npm init -y && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright@1.63.0
  ```

- **Run one smoke test** against a running server:

  ```
  cd app && GS_BASE=http://127.0.0.1:8106 node tests/smoke-grid.mjs
  ```

- **Run the full suite.** It starts its own server on a free port:

  ```
  cd app && PYTHON=python3.13 node tests/run-suite.mjs --db <absolute path>
  ```

- **Run the Python tests.** They need the unified file at the default path above:

  ```
  cd app && python3.13 -m pytest -q tests
  ```

On a machine without the kit's companion folders, a few checks fail for that reason alone, and fail the same way on the original kit:

- Decision's Studio comparison file is absent: a console 404 fails `smoke-interact`, `smoke-decision-allbus`, `smoke-desync`, `smoke-parity` and `smoke-samples`.
- `design/04a-bridge-contract.md` is absent: `smoke-mapgrid` fails.
- `app-tools/` is absent: `test_hash_pins.py` cannot load.
- The live Studio on port 8103 is not running: `chrome-parity` fails (listed as known red).

## Before committing

- **Never commit the database files or `testenv/`.** `.gitignore` lists `db/` and `testenv/`.
- **Commit `app/data/mapgrid/current.json` together with the cache folder it names.** A pointer without its folder makes the map answer 503 on a fresh checkout. Another machine rebuilds the cache anyway (step 4), because the cache records the path of the database it was built from.
- **Leave out `backup/` and `app/backup/`.** They are local safety copies.
