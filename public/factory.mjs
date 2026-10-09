import {api,post} from './app/api.mjs';
import {createProduction} from './app/production.mjs';
import {createOverview} from './app/overview.mjs';
import {createClosing} from './app/closing.mjs';
import {mount as mountOrders} from './commercial.mjs';
import {mount as mountLaser} from './laser.mjs';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '—').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const fmt = value => Number(value).toLocaleString('pt-BR',{maximumFractionDigits:3});
const digitalMachines=['Atexco Model X','SOLIS','Atexco Model H-16F-4','EFI Reggiani Compact'];
const paperWidths=['1,60 m','1,80 m'];
const calandras=Array.from({length:5},(_,index)=>`Calandra ${index+1}`);
const date = value => value ? String(value).slice(0,10).split('-').reverse().join('/') : '—';
const sectorInfo = {
  comercial: {name:'Vendedor / Comercial',icon:'◈'},
  estoque: {name:'Estoque',icon:'▣',see:'Tecido, quantidade por arte, unidade, largura e proprietário do tecido',write:'Rolos separados, códigos, quantidade disponibilizada e sobras devolvidas'},
  digital: {name:'Digital / papel',icon:'▧',see:'Arte pronta e arquivo, metragem por arte, largura do papel, tecido e tipo de serviço',write:'Máquina, metragem impressa, papel identificado e conclusão'},
  preparacao: {name:'Preparação do tecido',icon:'◫',see:'Tecido, largura, quantidade por arte e rolos separados',write:'Rolos utilizados, quantidade preparada e conjunto identificado'},
  calandra: {name:'Calandra / transferência',icon:'◎',see:'Arte, tecido, largura, metragem e papel/tecido correspondentes',write:'Metragem transferida, perdas, ocorrências e destino'},
  corte: {name:'Corte a laser',icon:'✂',see:'Arte, tecido, quantidade, molde e peças previstas',write:'Quantidade cortada, peças obtidas, perdas e destino'},
  costura: {name:'Costura',icon:'⌁',see:'Arte/modelo, tecido, peças recebidas e instruções',write:'Quantidade concluída, pendências e peças à revisão'},
  revisao: {name:'Revisão / contagem',icon:'✓',see:'Quantidade prevista, unidade, serviços e referência aprovada',write:'Quantidade recebida, aprovada, rejeitada ou em retrabalho'},
  expedicao: {name:'Expedição / entrega',icon:'↗',see:'Quantidade aprovada, volumes e informação de entrega',write:'Quantidade entregue, data, recebedor e saldo pendente'},
  pcp: {name:'PCP / planejamento',icon:'▤',see:'Pedidos, artes, quantidades, tecido, serviço, prazo e OPs',write:'Liberação do pedido, criação de OPs e prioridade'},
};
let user=null,testMode=false,workflowEnabled=false,current='overview',orders=[],pageRequest=0;

function pages(){
  const list=user.role==='gestao'?[['overview','Visão geral','◫']]:[];
  if(['comercial','gestao'].includes(user.role))list.push(['pedidos','Pedidos','▧']);

  if(['pcp','gestao'].includes(user.role))list.push(['pcp',sectorInfo.pcp.name,sectorInfo.pcp.icon]);
  for(const [role,info] of Object.entries(sectorInfo))if(!['comercial','pcp','financeiro'].includes(role)&&(user.role==='gestao'||user.role===role))list.push([role,info.name,info.icon]);

  list.push(['dados','Concluídos e dados','▤']);
  return list;
}
function heading(title,subtitle,badge='OPERAÇÃO'){
  return `<div class="page-head"><div><span class="eyebrow">FLUXO DA FÁBRICA</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><span class="tag warn">${esc(badge)}</span></div>`;
}
async function navigate(page){
  if(!pages().some(item=>item[0]===page))return;
  pageRequest++;overviewController.invalidate();current=page;if(location.hash!=='#'+page)location.hash=page;$('.sidebar').classList.remove('open');
  window.scrollTo({top:0,behavior:'instant'});
  $('#workspace').onclick=null;$('#workspace').onsubmit=null;$('#workspace').oninput=null;$('#workspace').onchange=null;
  document.querySelectorAll('.nav-button').forEach(button=>{button.classList.toggle('active',button.dataset.page===page);button.setAttribute('aria-current',button.dataset.page===page?'page':'false');});
  $('#breadcrumb').textContent=pages().find(item=>item[0]===page)[1];
  if(page==='pedidos')return showPedidos();
  if(page==='corte')return showLaser();

  if(page==='dados')return closingController.show();
  if(page==='overview')return showOverview();
  return showSector(page);
}
function showPedidos(){
 $('#workspace').innerHTML='<section class="commercial" id="commercial"></section>';
 mountOrders($('#commercial'),async(orderId,itemId)=>{
  try{const rows=await api('/api/orders');const item=rows.find(r=>r.orderId===orderId&&r.itemId===itemId);if(!item)throw Error('Arte de corte não encontrada neste pedido.');await navigate('corte');showLaser(item);}catch(e){alert(e.message);}
 });
}
function showLaser(source=null){
 $('#workspace').innerHTML='<section class="laser" id="laser-sector"></section>';
 mountLaser($('#laser-sector'),navigate,source);
}
async function showSector(role){
  const info=sectorInfo[role];if(!info)return;
  const request=++pageRequest,session=user;
  $('#workspace').innerHTML=heading(info.name,'Carregando a fila deste setor.')+'<div class="card">Carregando pedidos…</div>';
  try{
    const loaded=await api('/pedidos/api/factory/orders?sector='+encodeURIComponent(role));if(current!==role||request!==pageRequest||user!==session)return;orders=loaded;
    if(workflowEnabled&&role==='pcp')return renderPcp();
    if(workflowEnabled&&['estoque','digital','preparacao','calandra','corte','costura','revisao','expedicao'].includes(role))return renderBoard(role);
    throw Error('O fluxo de produção está indisponível. Reinicie pelo Iniciar Sublipaper.cmd.');
  }catch(error){if(current===role&&request===pageRequest&&user===session)$('#workspace').innerHTML=`<p class="error">${esc(error.message)}</p>`;}
}
function nextSector(role,item){
  const f=item.test_flow||{};
  if(role==='estoque')return f.needs_preparation?'Preparação do tecido':f.needs_sewing?'Costura':'Revisão';
  if(role==='digital')return f.needs_fabric?'Calandra após Preparação':'Expedição';
  if(role==='preparacao')return 'Calandra';
  if(role==='calandra')return f.needs_cut?'Corte a laser':f.needs_sewing?'Costura':'Revisão';
  if(role==='corte')return f.needs_sewing?'Costura':'Revisão';
  if(role==='costura')return 'Revisão';
  if(role==='revisao'&&item.replenishment&&!item.replenishment.ready)return 'Reposição / conferência pendente';
  if(role==='revisao')return item.work_label?'Conferência conjunta do pedido':'Expedição';
  return 'Entrega registrada';
}
window.addEventListener('hashchange',()=>{
  if(!user)return;
  const page=location.hash.slice(1),allowed=pages();
  if(!allowed.some(entry=>entry[0]===page)){navigate(allowed[0][0]);return;}
  if(page!==current)navigate(page);
});
async function boot(){
 user={id:'local-workstation',username:'Operação local',role:'gestao'};
 try{
  const status=await api('/pedidos/api/access/status');
  testMode=Boolean(status.test_workflow);
  workflowEnabled=testMode||Boolean(status.production_workflow);
  const operator=$('#operator-name');
  operator.value=localStorage.getItem('sublipaper-operator')||'';
  operator.oninput=event=>localStorage.setItem('sublipaper-operator',event.target.value.trim());
  const list=pages();
  $('#navigation').innerHTML=list.map(([id,name,icon],index)=>{
   const group=index===0?'ACOMPANHAMENTO':id==='pcp'?'PRODUÇÃO':id==='dados'?'CONFERÊNCIA':'';
   return `${group?`<div class="nav-group">${group}</div>`:''}<button class="nav-button" data-page="${id}" title="${esc(name)}"><span aria-hidden="true">${icon}</span>${esc(name)}</button>`;
  }).join('');
  $('#navigation').onclick=event=>{const button=event.target.closest('[data-page]');if(button)navigate(button.dataset.page);};
  const updateMenuState=()=>$('#menu-toggle').setAttribute('aria-expanded',String(window.matchMedia('(max-width:720px)').matches?$('.sidebar').classList.contains('open'):!document.body.classList.contains('navigation-collapsed')));
  $('#menu-toggle').onclick=()=>{
   if(window.matchMedia('(max-width:720px)').matches){$('.sidebar').classList.toggle('open');}
   else{
    document.body.classList.toggle('navigation-collapsed');
    localStorage.setItem('factory-sidebar-collapsed',String(document.body.classList.contains('navigation-collapsed')));
   }
   updateMenuState();
  };
  document.body.classList.toggle('navigation-collapsed',localStorage.getItem('factory-sidebar-collapsed')==='true');
  updateMenuState();
  const requested=location.hash.slice(1);
  await navigate(list.some(page=>page[0]===requested)?requested:'overview');
 }catch(error){$('#workspace').textContent=error.message;}
}
const productionController=createProduction({$,esc,fmt,date,heading,post,showSector,sectorInfo,digitalMachines,paperWidths,calandras,nextSector,orders:()=>orders,user:()=>user,current:()=>current});
const {renderBoard,renderPcp,artThumbnail,replenishmentSummary,unitName,unitValue,operationActionNames,timestamp}=productionController;
const overviewController=createOverview({$,esc,fmt,date,heading,api,navigate,artThumbnail,replenishmentSummary,unitName,unitValue,operationActionNames,timestamp,user:()=>user,current:()=>current,testMode:()=>testMode});
const {showOverview}=overviewController;
const closingController=createClosing({root:$('#workspace'),api,esc,fmt,date,current:()=>current});
boot();

