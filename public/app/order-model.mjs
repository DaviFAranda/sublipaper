export const flowOf=item=>item.production_flow??item.test_flow;
export const opOf=item=>item.production_op??item.test_op;
export const overviewNames={pcp:'PCP',estoque:'Estoque',digital:'Digital',preparacao:'Preparação',calandra:'Calandra',corte:'Corte a laser',costura:'Costura',revisao:'Revisão',expedicao:'Expedição'};
export function overviewToday(){
  const today=new Date();
  return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
}
export function overviewStages(item){
  const f=flowOf(item);
  if(!f){const l=item.laser_progress;return l?[{id:'corte',name:overviewNames.corte,state:l.status==='complete'?'done':l.status==='partial'?'running':l.status==='ready'?'ready':'blocked'}]:[];}
  const released=!!opOf(item);
  const stage=(id,done,running,ready)=>({id,name:overviewNames[id],state:done?'done':running?'running':ready?'ready':'blocked'});
  const stages=[stage('pcp',released,false,!released)];
  if(f.needs_fabric)stages.push(stage('estoque',f.separated,false,released));
  if(f.needs_print)stages.push(stage('digital',f.printed,f.printing,released));
  if(f.needs_preparation)stages.push(stage('preparacao',f.prepared,false,released&&f.separated));
  if(f.needs_calandra)stages.push(stage('calandra',f.calandra_done,f.calandra_running,released&&f.calandra_ready));
  if(f.needs_cut)stages.push(stage('corte',f.cut_done,f.cutting,released&&f.calandra_done&&!f.exhausted));
  if(f.needs_sewing)stages.push(stage('costura',f.sewn,f.sewing,released&&f.sewing_ready&&!f.exhausted));
  if(f.needs_review)stages.push(stage('revisao',f.review_done,false,released&&f.review_ready));
  stages.push(stage('expedicao',f.delivered,false,released&&f.expedition_ready));
  // Entregas antigas podem não ter todos os registros intermediários.
  if(f.delivered)return stages.map(s=>({...s,state:'done'}));
  if(item.laser_progress&&released&&f.calandra_done){const l=item.laser_progress;const cut=stages.find(s=>s.id==='corte');if(cut)cut.state=l.status==='complete'?'done':l.status==='partial'?'running':l.status==='ready'?'ready':'blocked';}
  return stages;
}
export function overviewState(item){
  const stages=overviewStages(item),f=flowOf(item)||{};
  const running=stages.filter(s=>s.state==='running');
  for(const lot of item.replenishment?.batches||[])for(const id of lot.running||[])if(!running.some(s=>s.id===id))running.push({id,name:overviewNames[id]+' · reposição',state:'running',replacement:true});
  const ready=stages.filter(s=>s.state==='ready');
  for(const lot of item.replenishment?.batches||[])for(const id of lot.waiting||[])if(!ready.some(s=>s.id===id)&&!running.some(s=>s.id===id))ready.push({id,name:overviewNames[id]+' · reposição',state:'ready',replacement:true});
  return {stages,running,ready,done:!!f.delivered,pcp:!!flowOf(item)&&!opOf(item),
    label:!flowOf(item)?(item.laser_progress?({draft:'Grades em preparação',ready:'Corte na fila',partial:'Corte parcial',complete:'Corte concluído'}[item.laser_progress.status]):'Sem apontamentos'):f.delivered?'Entregue':!opOf(item)?'Aguardando PCP':f.packed?'Pronto para entrega':running.length?running.map(s=>s.name+' em execução').join(' · '):ready.length?ready.map(s=>s.name).join(' + '):'Aguardando próxima etapa'};
}
export function overviewLate(order,item,today=overviewToday()){
  return !!order.delivery&&/^\d{4}-\d{2}-\d{2}/.test(order.delivery)&&order.delivery.slice(0,10)<today&&!flowOf(item)?.delivered;
}
export function overviewMatches(entry,filters){
  const {order,item,state}=entry,query=filters.query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();
  const searchable=[order.number,order.client,order.fabric,item.fabric,order.service,item.art,item.test_op,item.fabric_owner].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  return (!query||searchable.includes(query))&&(filters.service==='all'||order.service===filters.service)&&
    (filters.sector==='all'||[...state.ready,...state.running].some(s=>s.id===filters.sector))&&
    (filters.status==='all'||filters.status==='active'&&!state.done||filters.status==='running'&&state.running.length>0||filters.status==='pcp'&&state.pcp||filters.status==='late'&&overviewLate(order,item)||filters.status==='done'&&state.done);
}
export function overviewSort(entries,sort='due'){
  return [...entries].sort((a,b)=>sort==='recent'?String(b.order.created_at).localeCompare(String(a.order.created_at))||b.item.id-a.item.id:
    (a.order.delivery||'9999').localeCompare(b.order.delivery||'9999')||String(a.order.number).localeCompare(String(b.order.number))||a.item.id-b.item.id);
}
export function orderState(order){const states=order.items.map(overviewState);return {done:states.length>0&&states.every(s=>s.done),released:states.some(s=>!s.pcp&&s.stages.length),running:states.some(s=>s.running.length),delivered:states.filter(s=>s.done).length};}

// Factory projections intentionally omit the commercial database order id.
export function mergeProductionOrders(orders,production){
 const byNumber=new Map(production.map(o=>[o.number,o]));
 return orders.map(order=>({...order,items:order.items.map(item=>({...item,...(byNumber.get(order.number)?.items.find(p=>p.id===item.id)||{})}))}));
}
