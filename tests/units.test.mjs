import test from 'node:test';
import assert from 'node:assert/strict';
import {createProduction} from '../public/app/production.mjs';
import {ordersTemplate} from '../public/app/orders-template.mjs';
import {validatePlan,calculate} from '../domain.mjs';
import {printPreparation,printDocument,printOrderDocument} from '../print.mjs';

const plan=validatePlan({order:'PED-1',client:'Cliente teste',art:'Arte teste',fabric:'Tecido',grade:'G1',gradeWidthCm:160,gradeLengthCm:200,rows:[{product:'Frente',widthCm:40,heightCm:50,target:10,yield:2}]});
const job={id:'grade-1',number:'LASER-1',version:1,status:'complete',createdAt:'2026-10-13',plan,measurements:[{rows:[{id:'1',good:10,rejected:0}]}],reprints:[],printRecords:[{createdAt:'2026-10-13',totalCm:1000}]};

test('grade dimensions in cm produce meter calculations and meter romaneios',()=>{
 assert.equal(plan.width,1.6);
 assert.equal(plan.length,2);
 assert.equal(plan.rows[0].widthCm,40);
 assert.equal(calculate(plan).total,10.5);
 assert.match(printPreparation(job),/10 m calculados/);
 assert.match(printDocument(job),/10,5 m/);
 const html=printOrderDocument({id:'report',complete:true,order:'PED-1',client:'Cliente teste',createdAt:'2026-10-13',actor:'Teste',calculationMode:'grades',jobs:[job]});
 assert.match(html,/Dimensões \(m\)/);
 assert.match(html,/10 m/);
 assert.doesNotMatch(html,/1000 m/);
});

test('commercial and PCP lengths stay in meters while pieces stay integers',()=>{
 const nodes=new Map();
 const $=selector=>{if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);};
 const ctx={$,esc:String,fmt:String,date:String,heading:()=>'',orders:()=>[{number:'PED-1',service:'Venda de Papel',unit:'m',items:[{id:1,art:'Teste',quantity:'1.6',unit:'m',production_plan:{print_m:'1.6',final_qty:'1.6',final_unit:'m'}}]}]};
 const ui=createProduction(ctx);
 assert.equal(ui.unitValue('1.6','m'),'1.6');
 assert.equal(ui.unitName('m'),'m');
 assert.equal(ui.unitValue(12,'pc'),'12');
 ui.renderPcp();
 assert.match($('#workspace').innerHTML,/name="print_m"[^>]*value="1.6"/);
 assert.match($('#workspace').innerHTML,/name="final_qty"[^>]*value="1.6"/);
 assert.doesNotMatch($('#workspace').innerHTML,/print_cm|final_cm/);
 assert.match(ordersTemplate,/Largura \(m\)/);
});

test('production measurement form and shortages use meters without scaling',()=>{
 const nodes=new Map();
 const $=selector=>{if(!nodes.has(selector))nodes.set(selector,{value:''});return nodes.get(selector);};
 const previous=globalThis.document;
 globalThis.document={querySelectorAll:()=>[]};
 try{
  const ui=createProduction({$,esc:String,fmt:String,date:String,heading:()=>'',nextSector:()=>'',digitalMachines:[],paperWidths:[],sectorInfo:{digital:{name:'Digital'}},user:()=>({role:'gestao'}),orders:()=>[{number:'PED-1',unit:'m',width_m:'1.6',items:[{id:1,art:'Teste',quantity:'10.5',unit:'m',test_op:'OP-1',test_flow:{needs_print:true,printing:true},measurement_spec:{unit:'m',expected:'10.5',available:'10.5'}}]}]});
  ui.renderBoard('digital');
  const html=$('#workspace').innerHTML;
  assert.match(html,/data-expected="10.5"/);
  assert.match(html,/name="output"[^>]*max="10.5"/);
  assert.match(html,/Informe a saída em m/);
  assert.match(html,/1.6 m/);
  assert.doesNotMatch(html,/output_cm|loss_cm|1050/);
 }finally{globalThis.document=previous;}
});
