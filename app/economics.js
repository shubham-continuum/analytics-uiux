// Pure, dependency-free screening calculations. Prices must be $/MWh, power MW.
const finite = x => typeof x === 'number' && Number.isFinite(x);
// A model calendar has no zone. Parse it as an abstract UTC clock, independent
// of the browser's local timezone; settled records carry their inferred offset.
const instant = value => Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : value+'Z');
const result = (summary = {}, rows = [], assumptions = [], errors = []) => ({summary, rows, assumptions, errors});
function validate(records) {
  if (!Array.isArray(records) || !records.length) return ['Interval records are required.'];
  let previous = -Infinity;
  for (const r of records) {
    if (!finite(r.price) || !finite(r.dtHours ?? 1) || (r.dtHours ?? 1) <= 0) return ['Every interval requires a finite price and positive duration.'];
    if (r.timestamp != null) {
      const t = instant(r.timestamp);
      if (!finite(t) || t <= previous) return ['Intervals must have unique, chronological timestamps.'];
      previous = t;
    }
  }
  return [];
}
function generation(records, c) {
  const actual = records.every(r => finite(r.generationMW) && r.generationMW >= 0);
  if (records.some(r => r.generationMW != null) && !actual) throw Error('Generation observations are incomplete or invalid.');
  const loss = c.lossPct ?? 0;
  if (!finite(loss) || loss < 0 || loss > 100) throw Error('Loss percentage must be between 0 and 100.');
  if (actual) return {values: records.map(r => r.generationMW * (1 - loss / 100)), assumption: 'Uses supplied generation MW observations, reduced by the entered losses.'};
  const mw = c.capacityMW ?? c.renewableCapacityMW;
  const cf = c.capacityFactor;
  if (!finite(mw) || mw < 0 || !finite(cf) || cf < 0 || cf > 1) throw Error('Assumed generation requires nonnegative capacity MW and capacity factor between 0 and 1.');
  const profile = c.profile ?? 'flat';
  if (!['solar', 'wind', 'flat'].includes(profile)) throw Error('Choose solar, wind or flat generation profile.');
  if (profile === 'solar' && records.some(r => !r.timestamp)) throw Error('Solar screening profile requires interval timestamps.');
  const shape = records.map(r => profile === 'solar' ? Math.max(0, Math.sin((Number(r.timestamp.slice(11,13)) - 6) * Math.PI / 12)) : 1);
  const hours = records.reduce((s,r) => s + (r.dtHours ?? 1), 0);
  const average = shape.reduce((s,v,i) => s + v * (records[i].dtHours ?? 1), 0) / hours;
  if (!average && cf > 0) throw Error('Selected intervals contain no positive assumed solar generation.');
  return {values: shape.map(v => Math.min(mw, average ? mw * cf * v / average : 0) * (1-loss/100)), assumption: `Assumed ${profile} profile, not a weather simulation: solar uses the source timestamp's local-clock daylight curve; wind/flat use constant output. Scaled to selected-period capacity factor and capped at capacity; realized factor may be lower.`};
}
export function generationRevenue(records, config = {}) {
  const errors = validate(records); if (errors.length) return result({}, [], [], errors);
  if (config.contractPrice != null && !finite(config.contractPrice)) return result({}, [], [], ['Contract price must be finite.']);
  try {
    const g = generation(records,config);
    const rows = records.map((r,i) => ({...r,dtHours:r.dtHours ?? 1,generationMW:g.values[i],generationMWh:g.values[i]*(r.dtHours??1),revenue:g.values[i]*(r.dtHours??1)*(config.contractPrice??r.price),merchantRevenue:g.values[i]*(r.dtHours??1)*r.price}));
    const energyMWh = rows.reduce((s,r)=>s+r.generationMWh,0), revenue=rows.reduce((s,r)=>s+r.revenue,0), merchantRevenue=rows.reduce((s,r)=>s+r.merchantRevenue,0);
    const hours=rows.reduce((s,r)=>s+r.dtHours,0), meanPrice=rows.reduce((s,r)=>s+r.price*r.dtHours,0)/hours;
    return result({energyMWh,revenue,merchantRevenue,capturePrice:energyMWh?merchantRevenue/energyMWh:null,realizedPrice:energyMWh?revenue/energyMWh:null,captureRatio:energyMWh&&meanPrice?merchantRevenue/energyMWh/meanPrice:null,hours},rows,[g.assumption,'Revenue covers supplied intervals only; missing hours are not annualized. Contract price, when entered, replaces merchant energy settlement.']);
  } catch(e) { return result({},[],[],[e.message]); }
}

function dispatch(records,c,hybrid) {
  const errors=validate(records); if(errors.length) return result({},[],[],errors);
  for(let i=1;i<records.length;i++)if(records[i].timestamp&&records[i-1].timestamp&&Math.abs((instant(records[i].timestamp)-instant(records[i-1].timestamp))/3600000-(records[i-1].dtHours??1))>1e-6)return result({},[],[],['Dispatch requires contiguous intervals. Missing hours cannot carry stored energy across an unmodeled gap. Choose a complete series or a contiguous window.']);
  const power=c.capacityMW??c.dischargeMW, energy=c.energyMWh;
  const charge=c.chargeMW??power, discharge=c.dischargeMW??power, imp=c.importMW??charge, exp=c.exportMW??discharge;
  const etaC=c.chargeEfficiency??0.95,etaD=c.dischargeEfficiency??0.95, cost=c.cycleCostPerMWh??0;
  const min=(c.minSocPct??0)/100,max=(c.maxSocPct??100)/100,initial=(c.initialSocPct??0)/100,terminal=(c.terminalSocPct??c.initialSocPct??0)/100;
  if (![power,energy,charge,discharge,imp,exp,cost].every(x=>finite(x)&&x>=0)||energy<=0||![etaC,etaD].every(x=>finite(x)&&x>0&&x<=1)||![min,max,initial,terminal].every(x=>finite(x)&&x>=0&&x<=1)||min>=max||initial<min||initial>max||terminal<min||terminal>max) return result({},[],[],['Invalid battery power, energy, efficiency, cost or SOC bounds.']);
  // SOC grid: either socSteps equal subdivisions (10–100), or an explicit stepMWh chosen by dispatchgrid.js so the
  // tightest power limit is a whole number of steps (review 2026-09-29: coarse grids silently under-used limits).
  const stepMWh=c.stepMWh;
  if(stepMWh!=null&&!(finite(stepMWh)&&stepMWh>0)) return result({},[],[],['SOC step must be a positive number of MWh.']);
  const steps=stepMWh!=null?Math.ceil(energy*(max-min)/stepMWh-1e-9):Math.max(10,Math.min(100,Math.round(c.socSteps??40)));
  if(!finite(steps)||steps>4000) return result({},[],[],['SOC resolution must be finite and at most 4,000 steps.']);
  let gen={values:records.map(()=>0),assumption:''};
  try { if(hybrid) gen=generation(records,{...c,capacityMW:c.renewableCapacityMW}); } catch(e){return result({},[],[],[e.message]);}
  const grid=stepMWh!=null?Array.from({length:steps+1},(_,i)=>Math.min(energy*max,energy*min+i*stepMWh)):Array.from({length:steps+1},(_,i)=>energy*(min+(max-min)*i/steps));
  const states=[...new Set([...grid,energy*initial,energy*terminal])].sort((a,b)=>a-b);
  const n=states.length,start=states.indexOf(energy*initial),end=states.indexOf(energy*terminal);
  let values=new Float64Array(n).fill(-Infinity); values[start]=0;
  const back=new Uint16Array(records.length*n).fill(65535);
  // S2-EM F008: an optional per-interval charge cap (records[t].chargeCapMW, MW) tightens the charge limit hour by hour.
  for(const r of records) if(r.chargeCapMW!=null&&!(finite(r.chargeCapMW)&&r.chargeCapMW>=0)) return result({},[],[],['Every per-interval charge cap must be a nonnegative number of MW.']);
  const chargeAt=t=>records[t].chargeCapMW==null?charge:Math.min(charge,records[t].chargeCapMW);
  function flow(t,a,b) {
    const dt=records[t].dtHours??1,delta=states[b]-states[a],ch=Math.max(0,delta)/etaC/dt,dis=Math.max(0,-delta)*etaD/dt,g=gen.values[t];
    if(ch>chargeAt(t)+1e-8||dis>discharge+1e-8||dis>exp+1e-8) return null;
    const importMW=Math.max(0,ch-g);
    if(importMW>imp+1e-8||(hybrid&&!c.gridCharging&&importMW>1e-8))return null;
    const renewableToBatteryMW=Math.min(g,ch),renewableExportMW=Math.min(Math.max(0,g-ch),Math.max(0,exp-dis));
    const renewableCurtailmentMW=g-renewableToBatteryMW-renewableExportMW;
    const exportMW=renewableExportMW+dis;
    return {chargeMW:ch,dischargeMW:dis,importMW,exportMW,renewableToBatteryMW,renewableExportMW,renewableCurtailmentMW,netValue:(exportMW-importMW)*records[t].price*dt-dis*dt*cost};
  }
  // Only reachable transitions: SOC can rise by at most charge × ηc × Δt and fall by at most min(discharge, export) × Δt ÷ ηd.
  // flow() still enforces every limit; the band only skips moves flow() would reject (identical results, O(n·k) not O(n²)).
  const firstAtLeast=x=>{let lo=0,hi=n;while(lo<hi){const m=(lo+hi)>>1;if(states[m]<x)lo=m+1;else hi=m;}return lo;};
  for(let t=0;t<records.length;t++) {
    const next=new Float64Array(n).fill(-Infinity),dt=records[t].dtHours??1,up=chargeAt(t)*etaC*dt+1e-7,down=Math.min(discharge,exp)*dt/etaD+1e-7;
    for(let a=0;a<n;a++) if(values[a]>-Infinity) for(let b=firstAtLeast(states[a]-down),bEnd=firstAtLeast(states[a]+up+1e-12);b<bEnd&&b<n;b++) {
      const f=flow(t,a,b); if(!f)continue;
      const v=values[a]+f.netValue;
      if(v>next[b]+1e-9){next[b]=v;back[t*n+b]=a;}
    }
    values=next;
  }
  if(!finite(values[end]))return result({},[],[],['Terminal SOC is infeasible under these interval and power limits.']);
  const rows=new Array(records.length);let b=end;
  for(let t=records.length-1;t>=0;t--){const a=back[t*n+b];rows[t]={...records[t],dtHours:records[t].dtHours??1,...flow(t,a,b),socStartMWh:states[a],socEndMWh:states[b],generationMW:gen.values[t]};b=a;}
  const sum=k=>rows.reduce((s,r)=>s+r[k]*r.dtHours,0);
  const baselineRevenue=records.reduce((s,r,i)=>s+Math.min(gen.values[i],exp)*r.price*(r.dtHours??1),0);
  const summary={netValue:values[end],revenue:values[end],energyChargedMWh:sum('chargeMW'),energyDischargedMWh:sum('dischargeMW'),importMWh:sum('importMW'),exportMWh:sum('exportMW'),curtailedMWh:sum('renewableCurtailmentMW'),generationMWh:sum('generationMW'),baselineRevenue,incrementalValue:values[end]-baselineRevenue,equivalentCycles:sum('dischargeMW')/etaD/energy,initialSocMWh:energy*initial,terminalSocMWh:energy*terminal,hours:rows.reduce((s,r)=>s+r.dtHours,0)};
  return result(summary,rows,['Perfect-foresight energy-only benchmark; not an achievable forecast or ancillary-service revenue.',`Dynamic programming with ${steps} SOC subdivisions; discretization may understate the continuous optimum.`, 'No simultaneous charging/discharging. Terminal SOC is enforced. Cycling cost is per discharged AC MWh. No economic renewable curtailment beyond POI spill; no capacity or ancillary revenue.', ...(hybrid?[gen.assumption,c.gridCharging?'Grid charging allowed within import limit.':'Battery charges only from renewable generation.']:[])]);
}
export function batteryDispatch(records,config={}) {return dispatch(records,config,false);}
export function hybridDispatch(records,config={}) {return dispatch(records,config,true);}

export function projectFinance(c={}) {
  const years=c.years??20,delay=c.constructionYears??1,rate=c.discountRate;
  if(!Number.isInteger(years)||years<1||years>60||!Number.isInteger(delay)||delay<0||delay>20||!finite(c.capex)||c.capex<0||!finite(c.annualOM)||c.annualOM<0||!finite(rate)||rate<=-1) return result({},[],[],['Finance requires valid CAPEX, annual O&M, discount rate, operating years and construction years.']);
  const revenues=Array.isArray(c.annualRevenue)?c.annualRevenue:Array(years).fill(c.annualRevenue);
  if(revenues.length<years||revenues.slice(0,years).some(x=>!finite(x)))return result({},[],[],['Revenue is required for every operating year; missing years are not filled.']);
  const fraction=c.debtFraction??0,debtRate=c.debtRate??0,debtYears=c.debtYears??years;
  if(!finite(fraction)||fraction<0||fraction>1||!finite(debtRate)||debtRate<0||!Number.isInteger(debtYears)||debtYears<1) return result({},[],[],['Invalid debt fraction, interest rate or term.']);
  const replacements=c.replacements??[];
  if(!Array.isArray(replacements)||replacements.some(r=>!Number.isInteger(r.year)||r.year<1||r.year>years||!finite(r.cost)||r.cost<0))return result({},[],[],['Replacement costs require valid operating years and nonnegative costs.']);
  const debt=c.capex*fraction,payment=debtRate?debt*debtRate/(1-(1+debtRate)**(-debtYears)):debt/debtYears;
  const rows=[{year:0,operatingYear:0,revenue:0,om:0,replacement:0,capex:c.capex,debtService:0,projectCashFlow:-c.capex,equityCashFlow:-c.capex+debt,discountedCashFlow:-c.capex}];
  let balance=debt;
  for(let t=1;t<=delay+years;t++){
    const op=t-delay,operating=op>0,revenue=operating?revenues[op-1]:0,om=operating?c.annualOM:0,replacement=operating?replacements.filter(r=>r.year===op).reduce((s,r)=>s+r.cost,0):0;
    const interest=balance*debtRate;
    const debtService=debt?(operating&&op<=debtYears?Math.min(balance+interest,payment):!operating?interest:0):0;
    if(operating&&op<=debtYears)balance=Math.max(0,balance-(debtService-interest));
    const balloon=t===delay+years?balance:0;if(balloon)balance=0;
    const projectCashFlow=revenue-om-replacement,equityCashFlow=projectCashFlow-debtService-balloon;
    rows.push({year:t,operatingYear:Math.max(0,op),revenue,om,replacement,capex:0,debtService:debtService+balloon,projectCashFlow,equityCashFlow,discountedCashFlow:projectCashFlow/(1+rate)**t});
  }
  function irr(flows){
    const signs=flows.filter(x=>Math.abs(x)>1e-9).map(Math.sign);let changes=0;for(let i=1;i<signs.length;i++)if(signs[i]!==signs[i-1])changes++;
    if(changes!==1)return null;
    const npv=r=>flows.reduce((s,x,t)=>s+x/(1+r)**t,0);
    let low=-0.999,high=1;while(npv(low)*npv(high)>0&&high<1e6)high*=2;
    if(npv(low)*npv(high)>0)return null;
    for(let i=0;i<150;i++){const mid=(low+high)/2;if(npv(low)*npv(mid)<=0)high=mid;else low=mid;}return(low+high)/2;
  }
  const npv=rows.reduce((s,r)=>s+r.discountedCashFlow,0),equityNpv=rows.reduce((s,r)=>s+r.equityCashFlow/(1+rate)**r.year,0);
  const dscr=rows.filter(r=>r.operatingYear&&r.debtService>0).map(r=>(r.revenue-r.om-r.replacement)/r.debtService);
  return result({npv,irr:irr(rows.map(r=>r.projectCashFlow)),equityNpv,equityIrr:irr(rows.map(r=>r.equityCashFlow)),totalRevenue:rows.reduce((s,r)=>s+r.revenue,0),totalCashFlow:rows.reduce((s,r)=>s+r.projectCashFlow,0),minDSCR:dscr.length?Math.min(...dscr):null,initialEquity:c.capex-debt},rows,['Pre-tax, unlevered project and optional levered equity cash flow. No tax credits, depreciation or salvage value assumed.','CAPEX and debt draw occur at year 0. Construction years have no operating revenue; construction debt interest is paid in cash. Operations start in the following year.','Flat annual revenue is an explicitly repeated input, not a forecast model. All cash flows must share a consistent nominal or real dollar basis.','IRR is omitted when cash flows have no unique conventional sign change. Debt remaining at project end is repaid as a balloon.']);
}

// ───────────── Dashboard metrics (2026-09-29) ─────────────
// Pure helpers behind the Economics dashboard's added cards. Null = not held; a sum over a missing amount is null.

/** Sum named amounts per key. amounts: {name: row => number|null}. A group with any missing amount holds null for it. */
export function groupSum(rows, keyOf, amounts) {
  const out = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!out.has(k)) out.set(k, { key: k, n: 0, ...Object.fromEntries(Object.keys(amounts).map(a => [a, 0])) });
    const g = out.get(k); g.n++;
    for (const [a, f] of Object.entries(amounts)) { const v = f(r); g[a] = g[a] === null || !finite(v) ? null : g[a] + v; }
  }
  return [...out.values()];
}

/** Generation sold at negative prices: hours, MWh, revenue (≤ 0) and the uplift from self-curtailing in those hours. */
export function negativePriceHours(rows) {
  let hours = 0, mwh = 0, revenue = 0;
  for (const r of rows) {
    const dt = r.dtHours ?? 1;
    if (r.price < 0 && r.generationMW > 0) { hours += dt; mwh += r.generationMW * dt; revenue += r.generationMW * dt * r.price; }
  }
  return { hours, mwh, revenue, uplift: -revenue };
}

/** Spread at `dur` hours from {2,4,8} anchors ($/MWh), linear between held anchors, clamped outside. */
export function spreadAt(anchors, dur) {
  const a = [2, 4, 8].map(h => [h, anchors?.[h]]).filter(x => finite(x[1]));
  if (!a.length || !finite(dur)) return null;
  if (dur <= a[0][0]) return a[0][1];
  if (dur >= a.at(-1)[0]) return a.at(-1)[1];
  for (let i = 1; i < a.length; i++) if (dur <= a[i][0]) { const [x0, y0] = a[i - 1], [x1, y1] = a[i]; return y0 + ((y1 - y0) * (dur - x0)) / (x1 - x0); }
  return a.at(-1)[1];
}

/**
 * Studio spread benchmark: MW × hours × spread × cycles per year × RTE ($/yr). Not a dispatch. Kept for the Studio's
 * published comparison only (it applies RTE to the whole spread, ~5% high: C28); valuation uses storageBenchmark.
 */
export function spreadBenchmark({ mw, dur, spread, cycles, rte }) {
  return [mw, dur, spread, cycles, rte].every(finite) ? mw * dur * spread * cycles * rte : null;
}

// ───────────── P2 economics fixes (C14, C15, C28), 2026-10-11 ─────────────
// Provenance: Claude Opus 5.5 (P2 economics fix agent) · one-studio/design (P2 wave, economics group) · 2026-10-11 · sign-off pending · v1

/** C14: the battery a storage benchmark is sized on: hybrid = the battery (import MW), storage = export MW; else null. */
export function benchBattery({ tech, exportMW, importMW, dur }) {
  const mw = tech === 'hybrid' ? importMW : tech === 'storage' ? exportMW : null;
  if (!finite(mw) || mw <= 0 || !finite(dur) || dur <= 0) return null;
  return { mw, dur, energyMWh: mw * dur };
}

/**
 * C28: mean of the N dearest and N cheapest prices per day, on exactly the days dailySpreads kept (its day rule, not a
 * second one). Returns {top, bottom, days, daily:[{day, top, bottom}]}; top − bottom = the mean TB_N spread.
 */
export function topBottom(rows, days, dur) {
  const keep = new Set((days || []).map(d => d.day)), byDay = new Map();
  for (const r of rows || []) { const k = String(r.timestamp).slice(0, 10); if (!keep.has(k)) continue; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(r.price); }
  const daily = [...byDay].map(([day, p]) => { const s = [...p].sort((a, b) => a - b); return { day, top: s.slice(-dur).reduce((t, v) => t + v, 0) / dur, bottom: s.slice(0, dur).reduce((t, v) => t + v, 0) / dur }; });
  if (!daily.length) return { top: null, bottom: null, days: 0, daily };
  return { top: daily.reduce((t, d) => t + d.top, 0) / daily.length, bottom: daily.reduce((t, d) => t + d.bottom, 0) / daily.length, days: daily.length, daily };
}

const mwTxt = v => `${Math.abs(v - Math.round(v)) < 1e-9 ? v.toFixed(0) : v.toFixed(1)} MW`;
/** The tightest of MW and the held charge / discharge limits, with what was (not) applied. */
function capOf(mw, chargeLimitMW, dischargeLimitMW) {
  let cap = mw; const notes = [];
  if (finite(chargeLimitMW)) cap = Math.min(cap, chargeLimitMW); else notes.push('charge limit not held (not applied)');
  if (finite(dischargeLimitMW)) cap = Math.min(cap, dischargeLimitMW);
  return { cap, notes };
}

/**
 * C28: energy-consistent storage benchmark ($/yr), an UPPER BOUND (perfect foresight, one optional cycle a day):
 * capMW × hours × (RTE × top − bottom) × cycles, where the round-trip loss falls on the charged energy only (discharge
 * revenue − charge cost ÷ RTE, per discharged MWh) and capMW = min(MW, charge limit, discharge limit). With `daily`
 * ({top, bottom} per day) a loss-making day is skipped: mean over days of max(0, RTE × top − bottom).
 */
export function storageBenchmark({ mw, dur, top, bottom, daily = null, cycles, rte, chargeLimitMW = null, dischargeLimitMW = null }) {
  const base = { value: null, bound: 'upper', capMW: null, margin: null, label: 'not held' };
  if (![mw, dur, cycles, rte].every(finite)) return base;
  let margin;
  if (Array.isArray(daily) && daily.length) margin = daily.reduce((t, d) => t + Math.max(0, rte * d.top - d.bottom), 0) / daily.length;
  else if (finite(top) && finite(bottom)) margin = Math.max(0, rte * top - bottom);
  else return base;
  const { cap, notes } = capOf(mw, chargeLimitMW, dischargeLimitMW);
  const value = cap * dur * margin * cycles;
  const label = `upper bound: ${mwTxt(cap)} × ${dur} h × (RTE × top − bottom) × ${cycles} cycles${cap < mw ? ` (capped at ${mwTxt(cap)} by the charge/discharge limit)` : ''}${notes.length ? ` · ${notes.join('; ')}` : ''}`;
  return { value, bound: 'upper', capMW: cap, margin, label };
}

/** C28: the Decision storage ranking's deliverable spread beside the raw TB_N ($/MWh of battery energy). */
export function deliverableSpread({ top, bottom, rte, mw, chargeLimitMW = null, dischargeLimitMW = null }) {
  if (![top, bottom].every(finite)) return { raw: null, energy: null, capShare: null, adjusted: null };
  const energy = finite(rte) ? rte * top - bottom : null;
  const capShare = finite(mw) && mw > 0 ? capOf(mw, chargeLimitMW, dischargeLimitMW).cap / mw : null;
  return { raw: top - bottom, energy, capShare, adjusted: finite(energy) && finite(capShare) ? energy * capShare : null };
}

/**
 * C15: spill / clipping of a profile at a cap. A profile whose peak sits below the cap cannot show spill, so the result
 * is "not assessed (profile peak below POI)", never 0. When assessed and the peak is below nameplate the figure is a
 * lower bound. values: MW per interval; dt: hours per interval (default 1).
 */
export function spillAssessment(values, capMW, { nameplateMW = null, dt = null } = {}) {
  const v = (values || []).map(x => (finite(x) ? x : 0)), peakMW = v.length ? Math.max(...v) : null;
  if (!finite(capMW)) return { assessed: false, spillMWh: null, peakMW, bound: null, reason: 'not assessed (POI / connection cap not held)' };
  if (!finite(peakMW) || peakMW < capMW - 1e-9) return { assessed: false, spillMWh: null, peakMW, bound: null,
    reason: `not assessed (profile peak ${finite(peakMW) ? peakMW.toFixed(1) : '—'} MW below the ${capMW.toFixed(1)} MW POI): the CF-scaled shape never reaches nameplate, so spill and clipping cannot show` };
  const spillMWh = v.reduce((t, x, i) => t + Math.max(0, x - capMW) * (dt?.[i] ?? 1), 0);
  const bound = finite(nameplateMW) && peakMW >= nameplateMW - 1e-9 ? 'exact' : 'lower';
  return { assessed: true, spillMWh, peakMW, bound, reason: bound === 'lower' ? `lower bound: profile peak ${peakMW.toFixed(1)} MW is below nameplate` : '' };
}

/** Equivalent full cycles per calendar day of the source clock: Σ discharge × Δt ÷ ηd ÷ energy. */
export function dailyCycles(rows, energyMWh, etaD) {
  return groupSum(rows, r => String(r.timestamp).slice(0, 10), { stored: r => (r.dischargeMW * (r.dtHours ?? 1)) / etaD })
    .map(g => ({ day: g.key, cycles: g.stored / energyMWh }));
}

/** Clock-hour key of a record stamp ('YYYY-MM-DDTHH'), the key the reserve and fleet-profile endpoints use. */
export const stampHour = t => String(t).slice(0, 13);

/**
 * Reserve opportunity on a dispatch schedule. priceAt(hourKey) → $/MW-h or null (not held).
 * idleValue: MW × price in hours the battery neither charges nor discharges; allValue: every matched hour (a ceiling).
 */
export function reserveValue(rows, priceAt, mw) {
  let matched = 0, idleMatched = 0, unmatched = 0, idleValue = 0, allValue = 0;
  for (const r of rows) {
    const p = priceAt(stampHour(r.timestamp)), dt = r.dtHours ?? 1;
    if (!finite(p)) { unmatched++; continue; }
    matched++; allValue += mw * p * dt;
    if (!(r.chargeMW > 1e-6) && !(r.dischargeMW > 1e-6)) { idleMatched++; idleValue += mw * p * dt; }
  }
  return { matched, idleMatched, unmatched, idleValue, allValue };
}

/** Tornado rows sorted by swing. items: [{label, low:{label?, value}, high:{label?, value}}]; a not-held side stays null. */
export function tornado(base, items) {
  return items.map(it => {
    const lo = finite(it.low?.value) ? it.low.value : null, hi = finite(it.high?.value) ? it.high.value : null;
    const vals = [lo, hi, base].filter(finite);
    return { ...it, lowValue: lo, highValue: hi, lowDelta: lo == null ? null : lo - base, highDelta: hi == null ? null : hi - base, swing: Math.max(...vals) - Math.min(...vals) };
  }).sort((a, b) => b.swing - a.swing);
}

/** NPV / IRR over discount rate × capital cost, each cell a full projectFinance run. */
export function financeGrid(config, rates, capexes) {
  const cell = (r, k) => projectFinance({ ...config, discountRate: r, capex: k }).summary;
  const cells = rates.map(r => capexes.map(k => cell(r, k)));
  return { rates, capexes, npv: cells.map(row => row.map(s => (finite(s.npv) ? s.npv : null))), irr: cells.map(row => row.map(s => (finite(s.irr) ? s.irr : null))) };
}

/** Payback in years from year 0 (fractional within the crossing year), simple and discounted; null if never repaid. */
export function payback(rows, rate) {
  const find = f => {
    let cum = 0;
    for (const r of rows) {
      const cf = f(r), before = cum; cum += cf;
      if (r.year > 0 && before < 0 && cum >= 0) return r.year - 1 + -before / cf;
    }
    return null;
  };
  return { simple: find(r => r.projectCashFlow), discounted: find(r => r.projectCashFlow / (1 + rate) ** r.year) };
}

/** Values along anchors [{y, v, kind}] for each year: held before the first, linear between, held flat past the last. */
export function pathAlong(anchors, years) {
  const a = [...(anchors || [])].filter(x => finite(x.v)).sort((p, q) => p.y - q.y);
  return years.map(y => {
    if (!a.length) return { y, v: null, kind: 'not held' };
    if (y < a[0].y) return { y, v: a[0].v, kind: `held at ${a[0].y}` };
    if (y > a.at(-1).y) return { y, v: a.at(-1).v, kind: `held flat past ${a.at(-1).y}` };
    const at = a.find(x => x.y === y); if (at) return { y, v: at.v, kind: at.kind };
    const i = a.findIndex(x => x.y > y), p = a[i - 1], q = a[i];
    return { y, v: p.v + ((q.v - p.v) * (y - p.y)) / (q.y - p.y), kind: 'interpolated' };
  });
}

/** Linear fill of interior gaps up to maxGap values long; longer or edge gaps stay null. */
export function fillGaps(values, maxGap) {
  const v = [...values]; let filled = 0, unfilled = 0;
  for (let i = 0; i < v.length; i++) {
    if (finite(v[i])) continue;
    let j = i; while (j < v.length && !finite(v[j])) j++;
    const len = j - i;
    if (i > 0 && j < v.length && len <= maxGap) { for (let k = i; k < j; k++) v[k] = v[i - 1] + ((v[j] - v[i - 1]) * (k - i + 1)) / (len + 1); filled += len; }
    else unfilled += len;
    i = j - 1;
  }
  return { values: v, filled, unfilled };
}

/** Generation from a measured shape scaled to a capacity factor: min(MW, MW × CF × s_h ÷ mean s), duration-weighted mean. */
export function shapeProfile(records, shape, mw, cf) {
  if (shape.length !== records.length || shape.some(s => !finite(s) || s < 0)) return { values: null, clippedMWh: null };
  const hours = records.reduce((t, r) => t + (r.dtHours ?? 1), 0), mean = shape.reduce((t, s, i) => t + s * (records[i].dtHours ?? 1), 0) / hours;
  if (!(mean > 0)) return { values: null, clippedMWh: null };
  let clippedMWh = 0;
  const values = shape.map((s, i) => { const raw = (mw * cf * s) / mean; clippedMWh += Math.max(0, raw - mw) * (records[i].dtHours ?? 1); return Math.min(mw, raw); });
  return { values, clippedMWh, mean };
}
