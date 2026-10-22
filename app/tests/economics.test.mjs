import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../economics.js',import.meta.url),'utf8');
const {generationRevenue,batteryDispatch,hybridDispatch,projectFinance}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const records=prices=>prices.map((price,i)=>({timestamp:new Date(Date.UTC(2025,0,1,i)).toISOString(),price,dtHours:1}));
test('generation settles actual interval energy and preserves negative prices',()=>{
 const r=generationRevenue(records([-20,100]).map((r,i)=>({...r,generationMW:i+1})),{lossPct:10});
 assert.deepEqual(r.errors,[]);near(r.summary.energyMWh,2.7);near(r.summary.revenue,162);near(r.summary.capturePrice,60);
});
test('partial actual generation is not silently replaced by a profile',()=>{
 const r=generationRevenue([{price:2,generationMW:1},{price:5}],{capacityMW:5,capacityFactor:.3});assert.ok(r.errors.length);
});
test('battery conserves energy, obeys limits and returns initial SOC',()=>{
 const r=batteryDispatch(records([0,100,0,200]),{capacityMW:1,energyMWh:2,chargeEfficiency:.9,dischargeEfficiency:.9,importMW:.8,exportMW:.7,socSteps:40});
 assert.deepEqual(r.errors,[]);assert.ok(r.summary.netValue>0);near(r.summary.terminalSocMWh,0);
 for(const row of r.rows){assert.ok(row.chargeMW<=.8+1e-8);assert.ok(row.dischargeMW<=.7+1e-8);assert.ok(!row.chargeMW||!row.dischargeMW);near(row.socEndMWh,row.socStartMWh+row.chargeMW*.9-row.dischargeMW/.9);}
 near(r.summary.energyChargedMWh*.9,r.summary.energyDischargedMWh/.9);
});
test('battery captures known ideal arbitrage and cycling costs',()=>{
 const r=batteryDispatch(records([10,100]),{capacityMW:1,energyMWh:1,chargeEfficiency:1,dischargeEfficiency:1,cycleCostPerMWh:5});near(r.summary.netValue,85);
});
test('infeasible terminal SOC produces no fabricated dispatch',()=>{
 const r=batteryDispatch(records([10]),{capacityMW:.1,energyMWh:10,terminalSocPct:100});assert.ok(r.errors.length);assert.equal(r.rows.length,0);
});
test('hybrid conserves each renewable MWh without duplicate export',()=>{
 const r=hybridDispatch(records([0,100]).map((r,i)=>({...r,generationMW:i===0?2:0})),{capacityMW:1,energyMWh:1,chargeEfficiency:1,dischargeEfficiency:1,exportMW:1,importMW:1,gridCharging:false});
 assert.deepEqual(r.errors,[]);near(r.summary.netValue,100);
 for(const x of r.rows){near(x.generationMW,x.renewableToBatteryMW+x.renewableExportMW+x.renewableCurtailmentMW);near(x.exportMW,x.renewableExportMW+x.dischargeMW);near(x.importMW,0);assert.ok(x.exportMW<=1+1e-8);}
});
test('missing prices, negative generation and reversed timestamps are rejected',()=>{
 assert.ok(batteryDispatch([{price:null}],{}).errors.length);
 assert.ok(generationRevenue([{price:2,generationMW:-1}],{}).errors.length);
 assert.ok(batteryDispatch(records([1,2]).reverse(),{capacityMW:1,energyMWh:1}).errors.length);
});
test('finance NPV and cash flows reconcile with known value',()=>{
 const r=projectFinance({capex:100,annualRevenue:[60,60],annualOM:0,years:2,constructionYears:0,discountRate:0});
 assert.deepEqual(r.errors,[]);near(r.summary.npv,20);near(r.summary.irr,.13066238629180746);near(r.rows.reduce((s,x)=>s+x.discountedCashFlow,0),r.summary.npv);
});
test('finance missing operating revenue is incomplete and debt is reconciled',()=>{
 assert.ok(projectFinance({capex:100,annualRevenue:[60],annualOM:0,years:2,discountRate:.1}).errors.length);
 const r=projectFinance({capex:100,annualRevenue:60,annualOM:10,years:2,constructionYears:1,discountRate:.1,debtFraction:.5,debtRate:.1,debtYears:2,replacements:[{year:2,cost:5}]});
 near(r.rows[1].revenue,0);near(r.rows[1].debtService,5);near(r.rows[3].replacement,5);
 for(const x of r.rows.slice(1))near(x.equityCashFlow,x.projectCashFlow-x.debtService);
});
test('nonconventional cash flows omit ambiguous IRR',()=>{
 const r=projectFinance({capex:100,annualRevenue:[300,0],annualOM:0,years:2,constructionYears:0,discountRate:0,replacements:[{year:2,cost:250}]});assert.equal(r.summary.irr,null);
});
