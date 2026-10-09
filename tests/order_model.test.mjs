import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewStages,overviewState,overviewMatches,orderState,mergeProductionOrders} from '../public/app/order-model.mjs';
test('production joins by original order number when the projection has no database id',()=>{
 const rows=mergeProductionOrders([{id:1,number:'EX-DEMO',items:[{id:10,art:'demo',quantity:5}]}],[{number:'EX-DEMO',items:[{id:10,test_flow:{delivered:true}}]}]);
 assert.equal(orderState(rows[0]).done,true);assert.equal(rows[0].id,1);assert.equal(rows[0].items[0].quantity,5);
});
test('stock and digital can run in parallel without releasing calandra',()=>{
 const item={test_op:'OP-DEMO',test_flow:{needs_fabric:true,needs_print:true,needs_preparation:true,needs_calandra:true,printing:true}};
 const stages=overviewStages(item);
 assert.equal(stages.find(s=>s.id==='digital').state,'running');
 assert.equal(stages.find(s=>s.id==='estoque').state,'ready');
 assert.equal(stages.find(s=>s.id==='calandra').state,'blocked');
});
test('laser completion does not mean order delivery',()=>{
 const item={test_op:'OP-DEMO',test_flow:{needs_cut:true,calandra_done:true},laser_progress:{status:'complete'}};
 assert.equal(overviewStages(item).find(s=>s.id==='corte').state,'done');assert.equal(overviewState(item).done,false);
});
test('all items must be delivered before marking the order complete',()=>{
 assert.equal(orderState({items:[{test_flow:{delivered:true}},{test_flow:{delivered:false}}]}).done,false);
 assert.equal(orderState({items:[]}).done,false);
 assert.equal(orderState({items:[{test_flow:{delivered:true}}]}).done,true);
});
test('replacement work stays visible in the active sector',()=>{
 const state=overviewState({test_op:'OP-DEMO',test_flow:{},replenishment:{batches:[{running:['digital'],waiting:[]}]}});
 assert.equal(state.running[0].replacement,true);
});
test('accent insensitive search respects status and sector',()=>{
 const item={test_flow:{},art:'lenço'},order={client:'Demonstração',number:'EX-DEMO'},state=overviewState(item);
 const filter={query:'lenco',service:'all',sector:'all',status:'active'};
 assert.equal(overviewMatches({order,item,state},filter),true);
 assert.equal(overviewMatches({order,item,state},{...filter,status:'done'}),false);
});
