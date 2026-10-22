"""Reconcile the copied source with the served baseline and prepare local assets."""
from pathlib import Path
import re,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
P=ROOT/'preview'
baseline=(P/'baseline/original-served.html').read_text(encoding='utf8')
changes=[]
for kind,folder,suffix in [('script','ext','js'),('style','ext','css')]:
 for m in re.finditer(r'<'+kind+r'>/\* ext: ([^*]+) \*/\n([\s\S]*?)</'+kind+'>',baseline):
  dest=ROOT/'studio'/folder/m.group(1).strip()
  if dest.exists() and dest.read_text(encoding='utf8').strip()!=m.group(2).strip():
   changes.append(str(dest.relative_to(ROOT)));dest.write_text(m.group(2),encoding='utf8')
scripts=re.findall(r'<script[^>]*>([\s\S]*?)</script>',baseline)
for text,name in zip(scripts[:5],['data.js','data-ext.js','data-tree.js','data-demo.js','app.js']):
 dest=ROOT/'studio/src'/name
 if dest.read_text(encoding='utf8').strip()!=text.strip():changes.append(str(dest.relative_to(ROOT)));dest.write_text(text,encoding='utf8')
# The local legacy copy is the served baseline with isolated API and storage references.
legacy=baseline.replace('127.0.0.1:5034','127.0.0.1:5035').replace('localhost:5034','127.0.0.1:5035')
legacy=legacy.replace("'gs.","'gspreview.").replace('"gs.','"gspreview.')
legacy=legacy.replace('<head>','<head><meta name="preview" content="Isolated copied workspace">',1)
(P/'legacy.html').write_text(legacy,encoding='utf8')
for path in [*ROOT.glob('*.ps1'),ROOT/'run_pro.py',ROOT/'client/package.json',ROOT/'client/vite.config.ts',* (ROOT/'studio/ext').glob('*.js')]:
 if path.exists():
  text=path.read_text(encoding='utf8');text=text.replace('5034','5035').replace('8101','8105').replace('8103','8104');path.write_text(text,encoding='utf8')
def read_data(name,var):
 t=(ROOT/'studio/src'/name).read_text(encoding='utf8');m=re.search(r'window\.'+var+r'\s*=\s*',t);return json.JSONDecoder().raw_decode(t[m.end():])[0]
d=read_data('data.js','GS_DATA');e=read_data('data-ext.js','GS_DATA_EXT')
nodes=[dict(zip(d['nodes']['cols'],r)) for r in d['nodes']['rows']]
(P/'data').mkdir(exist_ok=True)
(P/'data/study.json').write_text(json.dumps({'nodes':nodes,'loading':e['loading'],'cost':e['cost'],'storageHeadroom':e['storage_headroom'],'meta':d['meta']},separators=(',',':')),encoding='utf8')
(P/'baseline/reconciliation.json').write_text(json.dumps({'baseline':'original-served.html','copiedSourceReconciled':changes,'legacyIsolation':'API5035; gspreview storage; server CSP restricts connect to self'},indent=2))
print('Reconciled',changes,'; local study nodes:',len(nodes))
