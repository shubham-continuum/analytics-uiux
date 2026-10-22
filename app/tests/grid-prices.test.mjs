import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePrices,matchedBasis,rowsOf,dailySpreads} from '../prices.js';
import {margins,loadingRows,allocateCosts,publishedCost} from '../grid.js';
const series=(year,prices,extra={})=>({nodeId:'1',mode:'historical',market:'RT',year,complete:true,records:prices.map((p,i)=>[`${year}-01-01T${String(i).padStart(2,'0')}:00:00Z`,p]),...extra});
const basis={nodeId:'1',mode:'historical',market:'RT',years:[2023,2024],weighting:'duration'};
test('duration, equal and custom annual weights reconcile',()=>{
 const data={series:[series(2023,[0]),series(2024,[30,30])]};
 assert.equal(analyzePrices(data,basis).summary.mean,20);
 assert.equal(analyzePrices(data,{...basis,weighting:'equal'}).summary.mean,15);
 assert.equal(analyzePrices(data,{...basis,weighting:'custom',weights:{2023:3,2024:1}}).summary.mean,7.5);
 assert.ok(analyzePrices(data,{...basis,weighting:'custom',weights:{2023:0,2024:1}}).errors.length);
});
test('duplicates and overlapping intervals are not counted twice',()=>{
 const s=series(2023,[1,2]);s.records[1][0]=s.records[0][0];
 assert.equal(rowsOf(s).length,0);assert.ok(analyzePrices({series:[s]},{...basis,years:[2023]}).errors.length);
 const overlap=series(2023,[1,2],{intervalHours:2});assert.equal(rowsOf(overlap).length,0);
 assert.ok(analyzePrices({series:[series(2023,[1])]},{...basis,years:[2023,2023]}).errors.length);
});
test('invalid observations reduce completeness and missing years require explicit opt-in',()=>{
 const data={series:[series(2023,[10,null])]};
 assert.ok(analyzePrices(data,{...basis,years:[2023]}).errors.length);
 const r=analyzePrices(data,{...basis,includePartial:true,strict:false});assert.equal(r.summary.mean,10);assert.equal(r.audit[0].invalidRecords,1);assert.equal(r.audit[1].status,'Missing');
});
test('distribution quantiles respect observed duration',()=>{
 const s=series(2023,[0,100]);s.records=[['2023-01-01T00:00:00Z',0,null,null,null,null,.25],['2023-01-01T01:00:00Z',100,null,null,null,null,1]];
 const r=analyzePrices({series:[s]},{...basis,years:[2023]});assert.equal(r.summary.p50,100);assert.equal(r.summary.mean,80);
});
test('basis joins equivalent instants and requires matching interval duration',()=>{
 const s=series(2023,[20]),ref=series(2023,[5]);ref.records[0][0]='2022-12-31T19:00:00-05:00';assert.equal(matchedBasis(s,ref)[0].price,15);
 ref.intervalHours=.5;assert.equal(matchedBasis(s,ref).length,0);
 ref.intervalHours=1;ref.records.push([...ref.records[0]]);assert.equal(matchedBasis(s,ref).length,0);
});
test('daily gross spreads reject sparse days and invalid duration',()=>{
 assert.equal(dailySpreads(rowsOf(series(2023,[0,100])),1).length,0);
 const day=rowsOf(series(2023,Array.from({length:24},(_,i)=>i)));assert.equal(dailySpreads(day,1)[0].spread,23);assert.equal(dailySpreads(day,0).length,0);
});
test('grid missing and invalid requests never become numeric passes',()=>{
 assert.equal(margins({hr_sp_dis:100},null,0)[0].exportMargin,null);assert.equal(margins({hr_sp_dis:100},50,0)[0].exportMargin,50);
 assert.equal(loadingRows({loading:{'1|sp|dis':{rows:[{rating_mva:100,flow_mw:50,dfax:.5}]}}},1,'sp','dis',null)[0].after,null);
});
test('allocator distinguishes unpriced, zero, invalid and duplicate scope',()=>{
 const a=allocateCosts([{id:'a',cost:100,share:50},{id:'b',cost:' ',share:100},{id:'c',cost:0,share:100}]);assert.equal(a.total,50);assert.equal(a.unpriced,1);
 for(const share of [null,'',-1,101,true]){const r=allocateCosts([{id:'a',cost:10,share}]);assert.ok(r.errors.length);assert.equal(r.total,null);assert.equal(r.rows[0].allocation,null);}
 assert.ok(allocateCosts([{id:'a',cost:10,share:50},{id:'a',cost:20,share:50}]).errors.length);
 assert.equal(publishedCost({cost:{}},1,'sp','dis',200),null);
});
