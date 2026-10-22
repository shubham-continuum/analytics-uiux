import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../economics.js',import.meta.url),'utf8');
const {generationRevenue,batteryDispatch,hybridDispatch,projectFinance}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const rec=prices=>prices.map((price,i)=>({timestamp:new Date(Date.UTC(2025,0,1,i)).toISOString(),price,dtHours:1}));

test('solar uses source-local midday rather than UTC daylight',()=>{
 const rs=Array.from({length:24},(_,h)=>({timestamp:`2025-01-01T${String(h).padStart(2,'0')}:00:00-05:00`,price:20}));
 const r=generationRevenue(rs,{profile:'solar',capacityMW:10,capacityFactor:.2});
 assert.deepEqual(r.errors,[]);near(r.rows[0].generationMW,0);near(r.rows[19].generationMW,0);
 assert.equal(r.rows.reduce((best,x,i,a)=>x.generationMW>a[best].generationMW?i:best,0),12);
 near(r.summary.energyMWh,48);
});
test('DST fall duplicate clock labels remain consecutive physical hours',()=>{
 const r=batteryDispatch([{timestamp:'2025-11-02T01:00:00-04:00',price:-10},{timestamp:'2025-11-02T01:00:00-05:00',price:100}],{capacityMW:1,energyMWh:1,chargeEfficiency:1,dischargeEfficiency:1});
 assert.deepEqual(r.errors,[]);near(r.summary.netValue,110);
});
test('unmodeled gaps cannot bridge SOC or produce imaginary daily dispatch',()=>{
 const r=batteryDispatch([{timestamp:'2030-01-01T00:00:00',price:0},{timestamp:'2030-01-03T00:00:00',price:100}],{capacityMW:1,energyMWh:1});
 assert.match(r.errors[0],/contiguous/);assert.equal(r.rows.length,0);
});
test('negative prices with round-trip losses reconcile exact physical energy',()=>{
 const r=batteryDispatch(rec([-100,20]),{capacityMW:1,energyMWh:1,chargeEfficiency:.8,dischargeEfficiency:.8,socSteps:40});
 assert.deepEqual(r.errors,[]);near(r.summary.energyChargedMWh,1);near(r.summary.energyDischargedMWh,.64);near(r.summary.netValue,112.8);near(r.summary.terminalSocMWh,0);
});
test('nonzero terminal SOC is held exactly with fractional interval power',()=>{
 const r=batteryDispatch([{price:10,dtHours:.5},{price:50,dtHours:.5}],{capacityMW:2,energyMWh:2,initialSocPct:50,terminalSocPct:50,chargeEfficiency:1,dischargeEfficiency:1});
 assert.deepEqual(r.errors,[]);near(r.rows.at(-1).socEndMWh,1);
 for(const x of r.rows)near(x.socEndMWh-x.socStartMWh,(x.chargeMW-x.dischargeMW)*.5);
});
test('hybrid obeys shared export and renewable balance with spill',()=>{
 const r=hybridDispatch(rec([10,200,20]).map((x,i)=>({...x,generationMW:[3,1,0][i]})),{capacityMW:1,energyMWh:1,chargeEfficiency:1,dischargeEfficiency:1,exportMW:1,importMW:0,gridCharging:false});
 assert.deepEqual(r.errors,[]);
 for(const x of r.rows){assert.ok(x.exportMW<=1+1e-8);near(x.generationMW,x.renewableToBatteryMW+x.renewableExportMW+x.renewableCurtailmentMW);near(x.importMW,0);assert.ok(!(x.chargeMW>1e-8&&x.dischargeMW>1e-8));}
 near(r.summary.netValue,r.rows.reduce((s,x)=>s+(x.exportMW-x.importMW)*x.price*x.dtHours,0));
});
test('finance construction interest and end balloon reconcile debt obligations',()=>{
 const r=projectFinance({capex:100,annualRevenue:[50,50],annualOM:5,years:2,constructionYears:2,discountRate:0,debtFraction:.5,debtRate:0,debtYears:10,replacements:[{year:2,cost:10}]});
 assert.deepEqual(r.errors,[]);near(r.rows[1].revenue,0);near(r.rows[2].revenue,0);near(r.rows[3].revenue,50);
 near(r.rows.reduce((s,x)=>s+x.debtService,0),50);near(r.summary.minDSCR,35/45);
 near(r.summary.equityNpv,r.rows.reduce((s,x)=>s+x.equityCashFlow,0));
});
