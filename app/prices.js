export const finite = x => typeof x === 'number' && Number.isFinite(x);
// One home for the words that describe where a bus's settled price comes from (bridge_bus_pnode tier; S2-D 2026-10-07
// adds `relinked`: a rank-1 node farther than any geo-proxy link, re-linked to the nearest priced node, D-008).
// {tier, km (distance_km / proxyKm), relinkMi, relinkedFrom}. Used by Market, Prices and their traces.
export const KM_PER_MI = 1.609344;
// P2 C19 (2026-10-10): a geo-proxy link this close whose node carries the bus's substation (dim_pnode.substation_short,
// the 8-character field of the pnode name) is the same substation; any other geo-proxy is a borrowed price. The old
// "co-located node (0.0 km)" wording (< 0.05 km, no name check) called borrowed series own-node and is gone.
export const SAME_SUBSTATION_KM = 0.1; // src: P2 review C19 rule · status: review rule
// ISO-NE pnode names are TYPE.SUBSTN(8)<kV>…; the type codes as words.
const NODE_TYPE = { UN: 'unit', LD: 'load', AR: 'asset-related demand', DR: 'demand-response', HC: 'HC' };
/** {type, word, substation, kv} from an ISO-NE pnode name, or null (hub/zone names). */
export function pnodeKind(name) {
  const m = /^([A-Z]{2})\.(.{1,8})(.*)$/.exec(String(name ?? ''));
  if (!m) return null;
  const kv = /^\s*(\d+(?:\.\d)?)/.exec(m[3]);
  return { type: m[1], word: NODE_TYPE[m[1]] || m[1], substation: m[2].trim() || null, kv: kv ? Number(kv[1]) : null };
}
const normName = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** True when an 8-char pnode substation field abbreviates the bus's substation name (prefix, or its letters in order). */
export function sameSubstationName(short, busSubstation) {
  const a = normName(short), b = normName(busSubstation);
  if (a.length < 3 || !b || a[0] !== b[0]) return false;
  if (b.startsWith(a) || a.startsWith(b)) return true;
  if (a.length < 4) return false;
  let i = 0; for (const ch of b) if (ch === a[i]) i++;
  return i === a.length;
}
/** The tier a surface should state: a geo-proxy ≤ SAME_SUBSTATION_KM at the bus's own substation is same_substation. */
export function resolvePriceTier({ tier, km, pnodeName, busSubstation } = {}) {
  if (tier === 'geo_proxy' && finite(km) && km <= SAME_SUBSTATION_KM && sameSubstationName(pnodeKind(pnodeName)?.substation, busSubstation)) return 'same_substation';
  return tier;
}
/** A borrowed price: a geo-proxy away from the bus's substation, or a D-008 re-linked node. */
export const isBorrowedPrice = f => ['geo_proxy', 'relinked'].includes(resolvePriceTier(f || {}));
// The bus's state against the price node's load zone (dim_pnode.zone_name); Massachusetts has three zones.
const ZONE_STATE = { '.Z.MAINE': 'ME', '.Z.NEWHAMPSHIRE': 'NH', '.Z.VERMONT': 'VT', '.Z.CONNECTICUT': 'CT', '.Z.RHODEISLAND': 'RI', '.Z.SEMASS': 'MA', '.Z.WCMASS': 'MA', '.Z.NEMASSBOST': 'MA' };
const ZONE_SHORT = { '.Z.MAINE': 'ME', '.Z.NEWHAMPSHIRE': 'NH', '.Z.VERMONT': 'VT', '.Z.CONNECTICUT': 'CT', '.Z.RHODEISLAND': 'RI', '.Z.SEMASS': 'SEMA', '.Z.WCMASS': 'WCMA', '.Z.NEMASSBOST': 'NEMA' };
const kmText = km => (!finite(km) ? '?' : km < SAME_SUBSTATION_KM ? km.toFixed(3) : km.toFixed(1));
/**
 * One home for the words that describe where a bus's settled price comes from, on every surface.
 * {tier, km, relinkMi, relinkedFrom} as before, plus (optional) pnodeName, busSubstation, busKv (node type and kV are
 * stated for a borrowed node or when the node's kV differs from the bus), sharedBy (series shared by N buses) and
 * nodeZone/busState (a node in another state's load zone is said so).
 */
export function priceTierLabel({ tier, km, relinkMi, relinkedFrom, pnodeName, busSubstation, busKv, sharedBy, nodeZone, busState } = {}) {
  const t = resolvePriceTier({ tier, km, pnodeName, busSubstation });
  let base;
  if (t === 'direct') base = 'own price node';
  else if (t === 'same_substation') base = 'node at the same substation';
  else if (t === 'geo_proxy') base = `borrowed from a node ${kmText(km)} km away`;
  else if (t === 'relinked') { const mi = finite(relinkMi) ? relinkMi : finite(km) ? km / KM_PER_MI : null, from = relinkedFrom && typeof relinkedFrom === 'object' ? relinkedFrom.pnode_name : relinkedFrom; base = `relinked · ${mi == null ? '?' : mi.toFixed(1)} mi from ${from || 'a far rank-1 node (D-008)'}`; }
  else return tier || '—';
  const parts = [base], k = pnodeKind(pnodeName), bkv = Number(busKv), kvDiff = finite(k?.kv) && busKv != null && finite(bkv) && Math.abs(k.kv - bkv) > 1e-6;
  if (k && (kvDiff || ['geo_proxy', 'relinked'].includes(t))) parts.push(`${k.word} node${finite(k.kv) ? ` at ${k.kv} kV` : ''}${kvDiff ? `, bus at ${bkv} kV` : ''}`);
  const zs = ZONE_STATE[nodeZone], st = String(busState ?? '').trim().toUpperCase();
  if (zs && /^[A-Z]{2}$/.test(st) && zs !== st) parts.push(`node in the ${ZONE_SHORT[nodeZone]} load zone, bus in ${st}`);
  if (finite(Number(sharedBy)) && Number(sharedBy) > 1) parts.push(`shared by ${Number(sharedBy)} buses`);
  return parts.join(' · ');
}
/** The label's inputs from any surface's shape: api_prices link, bus payload node (priceMapping) or Market node. */
export function priceLinkFields(node, link) {
  const pm = node?.priceMapping || {}, L = link || {};
  return {
    tier: L.price_tier ?? pm.tier ?? node?.tier, km: L.price_proxy_km ?? pm.distance_km ?? node?.proxyKm,
    relinkMi: L.relink_mi ?? pm.distance_mi ?? node?.relinkMi, relinkedFrom: L.relinked_from ?? pm.relinked_from ?? node?.relinkedFrom,
    pnodeName: L.pnode_name ?? pm.pnode_name ?? node?.pnode ?? node?.pnode_name, busSubstation: node?.substation_name ?? node?.substation ?? L.substation_name,
    busKv: node?.nominal_kv ?? node?.kv, sharedBy: L.buses_sharing_series ?? pm.buses_sharing_series ?? node?.sharing,
    nodeZone: L.zone_name ?? pm.zone_name ?? node?.pnodeZone, busState: node?.state_code ?? node?.state,
  };
}
export const priceTierText = (node, link) => priceTierLabel(priceLinkFields(node, link));
// Offset-less timestamps (forecast model calendar) are read as UTC so browser time zones and DST never change them.
// Memoised per stamp (pure in the text): the sorts below call it O(n log n) times on 8,760-row series at every page load.
const INSTANT=new Map();
export function instant(stamp){const text=String(stamp);let v=INSTANT.get(text);if(v===undefined){v=Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(text)?text:`${text}Z`);if(INSTANT.size>=400000)INSTANT.clear();INSTANT.set(text,v);}return v;}
const STAMPKEY=new Map(); // memoised like instant(): inspectSeries keys every record of every series on every render
function stampKey(stamp) { const text=String(stamp); let v=STAMPKEY.get(text); if(v===undefined){v=/(?:Z|[+-]\d\d:\d\d)$/.test(text)?Date.parse(text):`local:${text}`;if(STAMPKEY.size>=400000)STAMPKEY.clear();STAMPKEY.set(text,v);} return v; }
function inspectSeries(s) {
 const rows=[],seen=new Set();let invalid=0,duplicate=false;
 for(const r of s?.records||[]){const key=stampKey(r[0]),dt=r[6]??s.intervalHours??1;if(seen.has(key))duplicate=true;seen.add(key);if(!Number.isFinite(instant(r[0]))||!finite(r[1])||!finite(dt)||dt<=0){invalid++;continue;}rows.push({timestamp:r[0],price:r[1],generationMW:r[2],energy:r[3],congestion:r[4],loss:r[5],dtHours:dt});}
 rows.sort((a,b)=>instant(a.timestamp)-instant(b.timestamp));
 for(let i=1;i<rows.length;i++)if(instant(rows[i].timestamp)<instant(rows[i-1].timestamp)+rows[i-1].dtHours*3600000-1)duplicate=true;
 // Duplicate observations cannot safely be averaged or silently counted twice.
 return {rows:duplicate?[]:rows,invalid,duplicate};
}
export function rowsOf(s) { return inspectSeries(s).rows; }
// P2 C52: one percentile method. Equal intervals → linear interpolation (quantile below, the mart's quantile_cont);
// only mixed interval lengths use the duration-weighted nearest rank (QUANTILE_METHOD_MIXED).
export function weightedQuantile(rows,p){const s=rows.filter(r=>finite(r.price)).sort((a,b)=>a.price-b.price),h=s.reduce((t,r)=>t+r.dtHours,0);if(!h)return null;if(s.every(r=>Math.abs(r.dtHours-s[0].dtHours)<1e-9))return quantile(s.map(r=>r.price),p);let c=0;for(const r of s){c+=r.dtHours;if(c>=p*h)return r.price;}return s.at(-1).price;}
export const QUANTILE_METHOD='linear interpolation at (n − 1)q over the hours (Excel PERCENTILE.INC; the mart method)';
export const QUANTILE_METHOD_MIXED='nearest rank on cumulative observed duration (mixed interval lengths)';
// An already-ascending input is not copied and re-sorted (analyzePrices passes its sorted prices for p05, p50 and p95).
const ascending=a=>{for(let k=1;k<a.length;k++)if(!(a[k-1]<=a[k]))return false;return true;};
export function quantile(a,p){if(!a.length)return null;const v=ascending(a)?a:[...a].sort((x,y)=>x-y),i=(v.length-1)*p,l=Math.floor(i);return v[l]+(v[Math.ceil(i)]-v[l])*(i-l);}
export function selectSeries(data,basis){return data.series.filter(s=>String(s.nodeId)===String(basis.nodeId)&&s.mode===basis.mode&&s.market===basis.market&&(basis.mode!=='forecast'||s.run===basis.run)&&basis.years.some(y=>Number(y)===Number(s.year)));}
export function analyzePrices(data,basis){
 const selected=selectSeries(data,basis),audit=[],errors=[];let sumW=0;
 if(new Set(basis.years.map(Number)).size!==basis.years.length)errors.push('Selected years must be unique.');
 if(!['duration','equal','custom'].includes(basis.weighting))errors.push('Choose duration, equal or custom weighting.');
 for(const year of basis.years){const found=selected.filter(s=>Number(s.year)===Number(year));if(found.length!==1){audit.push({year,status:found.length?'Ambiguous':'Missing',hours:0});continue;}const s=found[0],checked=inspectSeries(s),rows=checked.rows,hours=rows.reduce((a,r)=>a+r.dtHours,0);const complete=s.complete&&!checked.invalid&&(!finite(s.expectedHours)||Math.abs(hours-s.expectedHours)<1e-6);let status=checked.duplicate?'Duplicate intervals':!hours?'Missing':(!complete&&!basis.includePartial?'Incomplete — excluded':'Included');const mean=hours?rows.reduce((a,r)=>a+r.price*r.dtHours,0)/hours:null;let weight=basis.weighting==='duration'?hours:basis.weighting==='custom'?Number(basis.weights?.[year]):1;if(status==='Included'&&(!finite(weight)||weight<=0))status='Invalid weight';if(status==='Included')sumW+=weight;audit.push({year,status,hours,mean,weight,source:s.source,series:s,rows,invalidRecords:checked.invalid});}
 if(!basis.years.length)errors.push('Select at least one year.');if(audit.some(a=>a.status!=='Included')&&basis.strict!==false)errors.push('Every selected year must be usable. Resolve the coverage gaps or explicitly use available years.');
 const included=audit.filter(a=>a.status==='Included');if(!included.length)errors.push('No usable selected years.');if(basis.weighting!=='duration'&&included.some(a=>!a.series.complete))errors.push('Equal or custom year weights would give a partial year a full year’s weight. Use observed-hour weighting, or deselect the partial year.');if(errors.length)return {errors,audit,summary:null,rows:[],series:[]};
 for(const a of included){a.normalizedWeight=a.weight/sumW;a.contribution=a.mean*a.normalizedWeight;}
 const rows=included.flatMap(a=>a.rows).sort((a,b)=>instant(a.timestamp)-instant(b.timestamp)),hours=rows.reduce((t,r)=>t+r.dtHours,0),mean=included.reduce((t,a)=>t+a.contribution,0),observedMean=rows.reduce((t,r)=>t+r.price*r.dtHours,0)/hours;
 // Distribution is over observed intervals, independent of the annual-mean weighting selector.
 // S2-EM D11: one quantile method. Equal-length intervals use linear interpolation at (n − 1)q (the unified mart's and
 // Market's method); only mixed interval lengths fall back to the duration-weighted nearest rank, and the summary says so.
 const sorted=[...rows].sort((a,b)=>a.price-b.price),equalDt=rows.every(r=>Math.abs(r.dtHours-rows[0].dtHours)<1e-9),prices=sorted.map(r=>r.price),weightedQuantile=p=>{if(equalDt)return quantile(prices,p);let total=0;for(const r of sorted){total+=r.dtHours;if(total>=p*hours)return r.price;}return sorted.at(-1).price;},variance=rows.reduce((t,r)=>t+(r.price-observedMean)**2*r.dtHours,0)/hours;
 return {errors:[],audit,series:included.map(a=>a.series),rows,summary:{mean,hours,yearCount:included.length,minAnnual:Math.min(...included.map(a=>a.mean)),maxAnnual:Math.max(...included.map(a=>a.mean)),negativePct:100*rows.filter(r=>r.price<0).reduce((t,r)=>t+r.dtHours,0)/hours,p05:weightedQuantile(.05),p50:weightedQuantile(.5),p95:weightedQuantile(.95),std:Math.sqrt(variance),observedMean,quantileMethod:equalDt?QUANTILE_METHOD:QUANTILE_METHOD_MIXED,distributionBasis:'Observed-duration weighted; annual mean weighting applies only to mean.'}};
}
export function matchedBasis(series,reference){const index=new Map(rowsOf(reference).map(r=>[stampKey(r.timestamp),r]));return rowsOf(series).filter(r=>index.has(stampKey(r.timestamp))&&Math.abs(index.get(stampKey(r.timestamp)).dtHours-r.dtHours)<1e-8).map(r=>({...r,node:r.price,reference:index.get(stampKey(r.timestamp)).price,price:r.price-index.get(stampKey(r.timestamp)).price}));}
export function hourlyShape(rows){return Array.from({length:24},(_,hour)=>{const rs=rows.filter(r=>Number(String(r.timestamp).slice(11,13))===hour),h=rs.reduce((a,r)=>a+r.dtHours,0);return {hour,value:h?rs.reduce((a,r)=>a+r.price*r.dtHours,0)/h:null};});}
export function dailySpreads(rows,duration){if(!Number.isInteger(duration)||duration<1||duration>12)return [];const days=new Map();for(const r of rows){const k=String(r.timestamp).slice(0,10);if(!days.has(k))days.set(k,[]);days.get(k).push(r);}const expected=rs=>{const o=t=>{const m=/([+-])(\d\d):(\d\d)$/.exec(String(t));return m?(m[1]==='-'?-1:1)*(Number(m[2])+Number(m[3])/60):null;},a=o(rs[0].timestamp),b=o(rs.at(-1).timestamp);return a==null||b==null?24:24+(a-b);};
return [...days].filter(([,r])=>r.length===expected(r)&&r.length>=2*duration&&r.every(x=>x.dtHours===1&&finite(x.price))&&new Set(r.map(x=>stampKey(x.timestamp))).size===r.length).map(([day,rs])=>{const p=rs.map(r=>r.price).sort((a,b)=>a-b);return {day,spread:(p.slice(-duration).reduce((a,b)=>a+b,0)-p.slice(0,duration).reduce((a,b)=>a+b,0))/duration};});}
