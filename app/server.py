"""GridSense One Studio server (fork of the analyzer preview). Loopback only; GET-only except the export proxy (M5).

Provenance: forked from analytics-analyzer-studio-preview/preview/server.py · Claude Opus 5.5 · one-studio/design (T3)
· 2026-10-06 · sign-off pending · v1 · dev-kit --fixtures mode: one-studio-devkit/design/plan.md P1 · 2026-10-09 · v2
· Continuum GET proxy /api/proxy/continuum/… -> --continuum-target: design/14-lift-projects-configurator-continuum.md L0 · 2026-10-11 · v3
· non-HTTP upstream answers are a JSON 502 (both proxies); targets validated as host:port at startup · L0 fix r1 · 2026-10-11 · v3.1
· --fixtures replays /api/proxy/continuum/… by path + query (never forwards; unrecorded -> fixture 404) · L5 fix · 2026-10-14 · v3.2
Run: python server.py --port 8105 --db "<abs path to ISONE_GridSense_unified.duckdb>"   (both required; --port 0 = ephemeral)
 or: python server.py --port 8106 --fixtures fixtures   (dev kit: recorded API responses, no DuckDB; plan/export_fixtures.py)
"""
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
import argparse,hashlib,json,os,re,sys
busdata=None  # the DuckDB data layer: imported in --db mode only (main), so --fixtures never loads DuckDB
FIX=None  # --fixtures mode: {'dir': Path, 'paths': {api path: index entry}}
_C=None
def conn():
 global _C
 if _C is None:_C=busdata.connect()
 return _C
ROOT=Path(__file__).resolve().parent
HEALTH={'app':'gridsense-one-studio','pid':os.getpid(),'root':str(ROOT),'bind':'127.0.0.1'}
CONT={'state':'unknown','at':None,'why':None}  # last proxy outcome (/health never calls :5034 itself; L0)
def code_stamp():
 # One hash over the served code (top-level .js/.css/.html/.py plus views/, vendor/, studio/) so a smoke can prove new code is live.
 h=hashlib.sha256()
 for p in sorted(list(ROOT.glob('*.*'))+list(ROOT.glob('views/**/*'))+list(ROOT.glob('vendor/**/*'))+list(ROOT.glob('studio/**/*'))):
  if p.is_file() and p.suffix in ('.js','.mjs','.css','.html','.py'):h.update(p.relative_to(ROOT).as_posix().encode());h.update(p.read_bytes())
 return h.hexdigest()[:12]
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
 def end_headers(self):
  self.send_header('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; frame-src 'self'; font-src 'self' data:; object-src 'none'; form-action 'self'")
  self.send_header('Cache-Control','no-cache');super().end_headers()
 def do_GET(self):
  if self.path=='/health':
   b=json.dumps(HEALTH).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
  host=(self.headers.get('Host') or '').split(':')[0]
  if host not in ('127.0.0.1','localhost'):return self.send_error(403,'Local preview only')  # DNS-rebinding guard
  path=self.path.split('?')[0]
  if path.startswith(self.CONT_PREFIX):return self.continuum()
  if path.startswith('/api/'):return self.api(path)
  if path=='/':self.path='/analytics-analyzer-studio.html';path=self.path
  # Static allow-list: pages, modules, styles, data, images. No listings, logs, pids, scripts, cache or plan files.
  if path.endswith('/') or any(path.startswith(p) for p in ('/cache','/plan','/tests','/baseline')) or not re.search(r'\.(html|js|mjs|css|json|svg|png|ico|woff2?)$',path):return self.send_error(404,'Not found')
  return super().do_GET()
 def fixture(self,path):
  # Dev-kit mode: replay the recorded response (status + gzip JSON body) for an exact path; anything else is a 404 JSON.
  e=FIX['paths'].get(path)
  if e is None:return self._json(404,{'error':'not in the dev-kit fixture set','path':path})
  b=(FIX['dir']/e['file']).read_bytes()
  self.send_response(int(e.get('status',200)));self.send_header('Content-Type',e.get('content_type','application/json'));self.send_header('Content-Encoding','gzip');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
 def api(self,path):
  if FIX is not None:return self.fixture(path)
  # Read-only GET endpoints over the unified DuckDB (opened read_only); gzip JSON, cached under cache/.
  try:
   if path=='/api/buses':body=busdata.cached('buses',lambda:{'buses':busdata.bus_list(conn())})
   elif path=='/api/screen':body=busdata.cached('screen',lambda:busdata.screen(conn()))
   elif path=='/api/market':body=busdata.cached('market',lambda:busdata.market(conn()))
   elif path.startswith('/api/x/'):
    # Plug-in endpoints: /api/x/<module>/<name>/<key>. Each api_<module>.py exposes ROUTES = {name: fn(conn, key) -> dict|None};
    # key is 'all', 'hub' or a bus id. Read-only; cached like the rest (a rebuilt database invalidates it).
    m=re.fullmatch(r'/api/x/([a-z]{2,20})/([a-z0-9_]{2,40})/(all|hub|\d{1,9})',path)
    if not m:return self.send_error(404,'Unknown endpoint')
    import importlib
    try:mod=importlib.import_module(f'api_{m.group(1)}')
    except ModuleNotFoundError:return self.send_error(404,'Unknown module')
    fn=getattr(mod,'ROUTES',{}).get(m.group(2))
    if not fn:return self.send_error(404,'Unknown route')
    key=m.group(3) if m.group(3) in ('all','hub') else str(int(m.group(3)))
    if m.group(1)=='mapgrid':
     # Map/grid data has its own generation + freshness contract (api_mapgrid): never cached here, so a rebuilt
     # generation is served at once and a stale one answers 503 instead of a cached 200.
     import gzip
     res=fn(conn(),key)
     if res is None:return self.send_error(404,'Not held')
     code=int(res.get('status',200)) if isinstance(res,dict) else 200
     b=gzip.compress(json.dumps(busdata.clean(res)).encode())
     self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Encoding','gzip');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
    body=busdata.cached(f'x-{m.group(1)}-{m.group(2)}-{key}',lambda:fn(conn(),key))
   else:
    m=re.fullmatch(r'/api/bus/(hub|\d{1,9})',path)
    if not m:return self.send_error(404,'Unknown endpoint')
    bid=m.group(1) if m.group(1)=='hub' else str(int(m.group(1)))  # /api/bus/0001 and /api/bus/1 share one cache entry
    body=busdata.cached(f'bus-{bid}',lambda:busdata.bus_payload(conn(),bid))
   if body is None:return self.send_error(404,'Bus not held')
   self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Encoding','gzip');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
  except Exception as e:
   self.send_error(500,f'Data layer error: {type(e).__name__}')
   raise
 # Export proxy (D-006): the ONLY POSTs. A fixed allow-list forwarded to the export service (--export-target),
 # JSON bodies only, size-capped; the response (an xlsx download) is passed through. Nothing else is forwarded.
 PROXY={'/api/proxy/export/siting-workbook':'/api/v2/export/siting-workbook','/api/proxy/export/siting-workbook/plan':'/api/v2/export/siting-workbook/plan','/api/proxy/export/sced-node':'/api/v2/export/sced-node'}  # /plan is read-only: what the export would change (e.g. a new Canvas option) before it happens
 PROXY_MAX=1024*1024
 def _json(self,code,obj):
  b=json.dumps(obj).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
 def do_POST(self):
  host=(self.headers.get('Host') or '').split(':')[0]
  if host not in ('127.0.0.1','localhost'):return self.send_error(403,'Local only')
  path=self.path.split('?')[0]
  target=self.PROXY.get(path)
  if not target:return self.send_error(405,'Only the two export routes accept POST')
  n=int(self.headers.get('Content-Length') or 0)
  if n>self.PROXY_MAX:
   # drain (bounded) before answering: replying mid-upload makes Windows abort the client's send (WinError 10053) and the
   # 413 is never read (test_body_size_cap flaked 1 in 3, L0 2026-10-11)
   left=min(n,16*self.PROXY_MAX)
   while left>0:
    b=self.rfile.read(min(left,1<<16))
    if not b:break
    left-=len(b)
   return self._json(413,{'error':'request too large','max_bytes':self.PROXY_MAX})
  if (self.headers.get('Content-Type') or '').split(';')[0].strip()!='application/json':return self._json(415,{'error':'JSON only'})
  body=self.rfile.read(n)
  import http.client
  h,_,p=HEALTH.get('export_target','127.0.0.1:5034').rpartition(':')
  try:
   c=http.client.HTTPConnection(h,int(p),timeout=300);c.request('POST',target,body=body,headers={'Content-Type':'application/json'});r=c.getresponse();out=r.read()
  except OSError:
   return self._json(502,{'error':'export service not running','target':HEALTH.get('export_target')})
  except http.client.HTTPException as e:  # answered, but not HTTP (BadStatusLine, IncompleteRead, LineTooLong): never a dropped connection
   return self._json(502,{'error':'export service answered badly','why':type(e).__name__,'target':HEALTH.get('export_target')})
  self.send_response(r.status)
  for k in ('Content-Type','Content-Disposition'):
   if r.getheader(k):self.send_header(k,r.getheader(k))
  self.send_header('Content-Length',str(len(out)));self.end_headers();self.wfile.write(out)
 # Continuum proxy (lift plan 14 L0; CSP is connect-src 'self'): GET only, a fixed allow-list forwarded to --continuum-target.
 # The page sets GSX_CONTINUUM_API=/api/proxy/continuum, so the upstream path is everything after the prefix; the query
 # string is passed as sent. Traversal (.., any %-escape, \, //) is a 400; any other route a 404; nothing is forwarded
 # for either. Down -> 502 with a JSON reason (no silent fallback); the upstream status and body pass through as they are.
 CONT_PREFIX='/api/proxy/continuum'
 CONT_ROUTE=re.compile(r'/api/v2/(?:scenarios(?:/[a-z0-9][a-z0-9_-]{0,63})*|continuum(?:/[a-z0-9][a-z0-9_-]{0,63})+)')
 CONT_QUERY=re.compile(r'[A-Za-z0-9_.~%+,:=&*-]{0,4000}')
 def continuum(self):
  import datetime as _dt,http.client
  up,_,q=self.path[len(self.CONT_PREFIX):].partition('?')
  if any(x in up for x in ('..','%','\\','//')):return self._json(400,{'error':'path traversal refused'})
  if not self.CONT_ROUTE.fullmatch(up):return self._json(404,{'error':'not an allowed Continuum route','allowed':['/api/v2/scenarios*','/api/v2/continuum/*']})
  if not self.CONT_QUERY.fullmatch(q) or re.search(r'%0[0ad]',q,re.I):return self._json(400,{'error':'query refused'})
  # Dev kit (--fixtures): replay the recorded answer keyed by path + query (plan/export_fixtures.py); never forward.
  if FIX is not None:return self.fixture(self.CONT_PREFIX+up+('?'+q if q else ''))
  tgt=HEALTH.get('continuum_target','127.0.0.1:5034');h,_,p=tgt.rpartition(':')
  now=lambda:_dt.datetime.now(_dt.timezone.utc).isoformat(timespec='seconds')
  try:
   c=http.client.HTTPConnection(h,int(p),timeout=120);c.request('GET',up+('?'+q if q else ''),headers={'Accept':'application/json'});r=c.getresponse();out=r.read()
  except TimeoutError:
   CONT.update(state='slow',at=now(),why='timed out after 120 s');return self._json(504,{'error':'Continuum service timed out','target':tgt})
  except OSError as e:
   CONT.update(state='down',at=now(),why=type(e).__name__);return self._json(502,{'error':'Continuum service not running','target':tgt})
  except http.client.HTTPException as e:  # answered, but not HTTP (BadStatusLine, IncompleteRead, LineTooLong): 502, never a dropped connection
   CONT.update(state='down',at=now(),why=type(e).__name__);return self._json(502,{'error':'Continuum service answered badly','why':type(e).__name__,'target':tgt})
  CONT.update(state='up',at=now(),why=None)
  self.send_response(r.status);self.send_header('Content-Type',r.getheader('Content-Type') or 'application/json')
  if r.getheader('Content-Encoding'):self.send_header('Content-Encoding',r.getheader('Content-Encoding'))
  self.send_header('Content-Length',str(len(out)));self.end_headers();self.wfile.write(out)
ThreadingHTTPServer.request_queue_size=64  # default 5 refused connections when a page loads several endpoints at once
ThreadingHTTPServer.daemon_threads=True
if __name__=='__main__':
 ap=argparse.ArgumentParser(description='GridSense One Studio (loopback only)')
 ap.add_argument('--port',type=int,required=True,help='port to bind on 127.0.0.1; 0 = ephemeral (tests)')
 src=ap.add_mutually_exclusive_group(required=True)
 src.add_argument('--db',help='absolute path to the unified DuckDB (opened read-only)')
 src.add_argument('--fixtures',help='dev kit: folder of recorded API responses (index.json + *.json.gz); no DuckDB')
 ap.add_argument('--export-target',default='127.0.0.1:5034',help='host:port of the export service (tests pass a fake)')
 ap.add_argument('--continuum-target',default='127.0.0.1:5034',help='host:port of the LMP Continuum service (GET proxy; tests pass a fake)')
 a=ap.parse_args()
 for f,v in (('--export-target',a.export_target),('--continuum-target',a.continuum_target)):  # refuse at startup, not a ValueError per request
  m=re.fullmatch(r'([A-Za-z0-9.-]+):(\d{1,5})',v)
  if not m or not 0<int(m.group(2))<65536:ap.error(f'{f} must be host:port (got {v!r})')
 HEALTH.update(continuum_target=a.continuum_target,continuum=CONT)
 if a.fixtures:
  fx=Path(a.fixtures).resolve()
  if not (fx/'index.json').is_file():print(f'ERROR: fixture set not found: {fx} (needs index.json)',file=sys.stderr,flush=True);sys.exit(2)
  idx=json.loads((fx/'index.json').read_text(encoding='utf-8'))
  # Every entry must name a plain file inside the folder that exists: the index is the only path -> file mapping.
  bad=[p for p,e in (idx.get('paths') or {}).items() if not (p.startswith('/api/') and isinstance(e,dict) and re.fullmatch(r'[A-Za-z0-9_.-]+\.json\.gz',str(e.get('file',''))) and (fx/e['file']).is_file())]
  if bad or not idx.get('paths'):print(f'ERROR: invalid fixture index {fx/"index.json"}: {len(bad)} bad entries, e.g. {bad[:3]}',file=sys.stderr,flush=True);sys.exit(2)
  FIX={'dir':fx,'paths':idx['paths']}
  s=idx.get('source') or {}
  HEALTH.update(mode='fixtures',fixtures=str(fx),fixture_set=idx.get('id'),fixture_count=len(idx['paths']),
                db=f"fixtures {idx.get('id')} (recorded from {s.get('db') or 'not held'})",db_mtime=s.get('db_mtime'),code=code_stamp(),export_target=a.export_target)
 else:
  db=Path(a.db).resolve()
  if not db.is_file():print(f'ERROR: database not found: {db}',file=sys.stderr,flush=True);sys.exit(2)
  import busdata
  busdata.SOURCE=db  # no silent fallback: the one DB every API reads
  import datetime as _dt
  HEALTH.update(db=str(db),db_mtime=_dt.datetime.fromtimestamp(db.stat().st_mtime,_dt.timezone.utc).isoformat(),code=code_stamp(),export_target=a.export_target)
 server=ThreadingHTTPServer(('127.0.0.1',a.port),Handler)
 port=server.server_address[1];HEALTH['port']=port
 if FIX is not None:print(f'FIXTURES {HEALTH["fixtures"]} (set {HEALTH["fixture_set"]}, {HEALTH["fixture_count"]} paths) code {HEALTH["code"]}',flush=True)
 else:print(f'DB {db} (mtime {HEALTH["db_mtime"]}) code {HEALTH["code"]}',flush=True)
 print(f'One Studio http://127.0.0.1:{port}/analytics-analyzer-studio.html',flush=True)
 server.serve_forever()
