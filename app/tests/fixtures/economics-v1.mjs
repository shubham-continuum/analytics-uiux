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
  const steps=Math.max(10,Math.min(100,Math.round(c.socSteps??40)));
  if(!finite(steps)) return result({},[],[],['SOC resolution must be finite.']);
  let gen={values:records.map(()=>0),assumption:''};
  try { if(hybrid) gen=generation(records,{...c,capacityMW:c.renewableCapacityMW}); } catch(e){return result({},[],[],[e.message]);}
  const states=[...new Set([...Array.from({length:steps+1},(_,i)=>energy*(min+(max-min)*i/steps)),energy*initial,energy*terminal])].sort((a,b)=>a-b);
  const n=states.length,start=states.indexOf(energy*initial),end=states.indexOf(energy*terminal);
  let values=new Float64Array(n).fill(-Infinity); values[start]=0;
  const back=new Uint16Array(records.length*n).fill(65535);
  function flow(t,a,b) {
    const dt=records[t].dtHours??1,delta=states[b]-states[a],ch=Math.max(0,delta)/etaC/dt,dis=Math.max(0,-delta)*etaD/dt,g=gen.values[t];
    if(ch>charge+1e-8||dis>discharge+1e-8||dis>exp+1e-8) return null;
    const importMW=Math.max(0,ch-g);
    if(importMW>imp+1e-8||(hybrid&&!c.gridCharging&&importMW>1e-8))return null;
    const renewableToBatteryMW=Math.min(g,ch),renewableExportMW=Math.min(Math.max(0,g-ch),Math.max(0,exp-dis));
    const renewableCurtailmentMW=g-renewableToBatteryMW-renewableExportMW;
    const exportMW=renewableExportMW+dis;
    return {chargeMW:ch,dischargeMW:dis,importMW,exportMW,renewableToBatteryMW,renewableExportMW,renewableCurtailmentMW,netValue:(exportMW-importMW)*records[t].price*dt-dis*dt*cost};
  }
  for(let t=0;t<records.length;t++) {
    const next=new Float64Array(n).fill(-Infinity);
    for(let a=0;a<n;a++) if(values[a]>-Infinity) for(let b=0;b<n;b++) {
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
