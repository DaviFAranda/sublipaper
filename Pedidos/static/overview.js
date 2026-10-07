/* Acompanhamento da fábrica: somente leitura, disponível apenas à Gestão. */
let overviewRows=[], overviewUpdated='', overviewRequest=0;
const overviewDefaults={query:'',status:'active',sector:'all',service:'all',sort:'due',view:'orders'};
let overviewFilters={...overviewDefaults};
const overviewNames={pcp:'PCP',estoque:'Estoque',digital:'Digital',preparacao:'Preparação',calandra:'Calandra',corte:'Corte a laser',costura:'Costura',revisao:'Revisão',expedicao:'Expedição'};

function overviewToday(){
  const today=new Date();
  return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
}
function overviewStages(item){
  const f=item.test_flow;
  if(!f)return [];
  const released=!!item.test_op;
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
  return stages;
}
function overviewState(item){
  const stages=overviewStages(item),f=item.test_flow||{};
  const running=stages.filter(s=>s.state==='running');
  for(const lot of item.replenishment?.batches||[])for(const id of lot.running||[])if(!running.some(s=>s.id===id))running.push({id,name:overviewNames[id]+' · reposição',state:'running',replacement:true});
  const ready=stages.filter(s=>s.state==='ready');
  for(const lot of item.replenishment?.batches||[])for(const id of lot.waiting||[])if(!ready.some(s=>s.id===id)&&!running.some(s=>s.id===id))ready.push({id,name:overviewNames[id]+' · reposição',state:'ready',replacement:true});
  return {stages,running,ready,done:!!f.delivered,pcp:!!item.test_flow&&!item.test_op,
    label:!item.test_flow?'Sem apontamentos':f.delivered?'Entregue':!item.test_op?'Aguardando PCP':f.packed?'Pronto para entrega':running.length?running.map(s=>s.name+' em execução').join(' · '):ready.length?ready.map(s=>s.name).join(' + '):'Aguardando próxima etapa'};
}
function overviewLate(order,item,today=overviewToday()){
  return !!order.delivery&&/^\d{4}-\d{2}-\d{2}/.test(order.delivery)&&order.delivery.slice(0,10)<today&&!item.test_flow?.delivered;
}
function overviewEntries(rows=overviewRows){return rows.flatMap(order=>order.items.map(item=>({order,item,state:overviewState(item)})));}
function overviewMatches(entry,filters=overviewFilters){
  const {order,item,state}=entry,query=filters.query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();
  const searchable=[order.number,order.client,order.fabric,item.fabric,order.service,item.art,item.test_op,item.fabric_owner].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  return (!query||searchable.includes(query))&&(filters.service==='all'||order.service===filters.service)&&
    (filters.sector==='all'||[...state.ready,...state.running].some(s=>s.id===filters.sector))&&
    (filters.status==='all'||filters.status==='active'&&!state.done||filters.status==='running'&&state.running.length>0||filters.status==='pcp'&&state.pcp||filters.status==='late'&&overviewLate(order,item)||filters.status==='done'&&state.done);
}
function overviewSort(entries,sort=overviewFilters.sort){
  return [...entries].sort((a,b)=>sort==='recent'?String(b.order.created_at).localeCompare(String(a.order.created_at))||b.item.id-a.item.id:
    (a.order.delivery||'9999').localeCompare(b.order.delivery||'9999')||String(a.order.number).localeCompare(String(b.order.number))||a.item.id-b.item.id);
}
function overviewBadges(entry){
  const {state,item}=entry;
  if(state.done)return '<span class="ov-badge done">✓ Entregue</span>';
  if(!item.test_flow)return '<span class="ov-badge">Sem apontamentos</span>';
  return [...state.running,...state.ready].map(stage=>`<span class="ov-badge ${stage.state}">${stage.state==='running'?'● ':''}${esc(stage.name)}${stage.state==='running'?' em execução':stage.id==='expedicao'&&item.test_flow.packed?' · volume pronto':' · na fila'}</span>`).join('')||'<span class="ov-badge">Aguardando próxima etapa</span>';
}
function overviewArt(entry,compact=false){
  const {order,item,state}=entry;
  const machine=state.running.some(s=>s.id==='digital'&&!s.replacement)?item.test_flow.digital_machine:state.running.some(s=>s.id==='calandra'&&!s.replacement)?item.test_flow.calandra_machine:'';
  return `<article class="ov-art ${compact?'compact':''}">${artThumbnail(item)}<div class="ov-art-info"><small>${esc(compact?item.test_op||'Sem OP':order.number+' · '+(order.client||'Cliente não informado'))}</small><h3>${esc(item.art)}</h3><p>${esc(fmt(item.quantity))} ${esc(item.unit)} · ${esc(item.test_flow?.needs_fabric===false?'Papel impresso':item.fabric||order.fabric||order.service||'Material não informado')}</p><div class="ov-badges">${overviewBadges(entry)}</div>${machine?`<p class="ov-machine">${esc(machine)}${item.test_flow.paper_width&&state.running.some(s=>s.id==='digital')?' · papel '+esc(item.test_flow.paper_width):''}</p>`:''}${!compact?`<p class="${overviewLate(order,item)?'ov-late':'ov-due'}">Entrega ${esc(date(order.delivery))}${overviewLate(order,item)?' · prazo vencido':''}</p>`:''}${replenishmentSummary(item)}<button class="ov-detail-button" data-ov-detail="${item.id}" type="button">Ver percurso e detalhes ↗</button></div></article>`;
}
function overviewOrder(order,entries){
  const delivered=order.items.filter(i=>i.test_flow?.delivered).length;
  const late=entries.some(e=>overviewLate(order,e.item));
  return `<section class="ov-order"><header><div><span class="eyebrow">${esc(order.number)} · ${esc(order.service)}</span><h2>${esc(order.client||'Cliente não informado')}</h2><p>${order.items.length} arte(s) · ${delivered} entregue(s)${entries.length<order.items.length?' · '+entries.length+' neste filtro':''}</p></div><div class="ov-order-deadline ${late?'ov-late':''}"><small>ENTREGA PROMETIDA</small><strong>${esc(date(order.delivery))}</strong>${late?'<span>Prazo vencido</span>':''}</div></header><div class="ov-delivery-progress" role="progressbar" aria-label="Artes entregues do pedido ${esc(order.number)}" aria-valuemin="0" aria-valuemax="${order.items.length}" aria-valuenow="${delivered}"><span style="width:${order.items.length?100*delivered/order.items.length:0}%"></span></div><div class="ov-order-arts">${entries.map(e=>overviewArt(e,true)).join('')}</div></section>`;
}
async function showOverview(){
  if(user?.role!=='gestao')return;
  const request=++overviewRequest,session=user;
  $('#workspace').innerHTML=heading('Visão geral','Pedidos, artes e próximos passos em um só lugar.','ACOMPANHAMENTO DA FÁBRICA')+'<div class="card" role="status">Carregando acompanhamento…</div>';
  try{
    const rows=await api('/pedidos/api/factory/orders');
    if(request!==overviewRequest||current!=='overview'||user!==session)return;
    overviewRows=rows;overviewUpdated=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});renderOverview();
  }catch(error){
    if(request!==overviewRequest||current!=='overview'||user!==session)return;
    $('#workspace').innerHTML=`<div class="card"><p class="error" role="alert">${esc(error.message)}</p><button class="secondary" id="retry-overview">Tentar novamente</button></div>`;
    $('#retry-overview').onclick=showOverview;
  }
}
function renderOverview(){
  if(user?.role!=='gestao')return;
  const all=overviewEntries(),activeOrders=overviewRows.filter(o=>!o.items.length||o.items.some(i=>!i.test_flow?.delivered)).length;
  const metrics=[['active','Pedidos em aberto',activeOrders,'pedidos ainda não entregues'],['running','Artes em execução',all.filter(e=>e.state.running.length).length,'impressão, transferência, corte ou costura'],['pcp','Aguardando PCP',all.filter(e=>e.state.pcp).length,'artes para liberar'],['late','Artes com prazo vencido',all.filter(e=>overviewLate(e.order,e.item)).length,'ainda não entregues']];
  $('#workspace').innerHTML=`<div class="ov-dashboard">${heading('Visão geral','Acompanhe as artes, identifique pendências e veja o próximo passo de cada pedido.','EXCLUSIVO GESTÃO')}<div class="ov-update"><span>${testMode?'Ambiente de testes · confirmações simuladas':'Sem integração de apontamentos de produção'} · atualizado às ${overviewUpdated}</span><button class="secondary" id="ov-refresh" type="button">Atualizar dados ↻</button></div><div class="ov-metrics">${metrics.map(([status,label,count,hint])=>`<button type="button" class="ov-metric ${status==='late'?'attention':''}" data-ov-status="${status}" aria-pressed="${overviewFilters.status===status}"><span>${label}</span><strong>${count}</strong><small>${hint}</small></button>`).join('')}</div><section class="ov-section"><div class="ov-section-head"><div><h2>Onde estão as artes</h2><p>Clique em um setor para ver sua fila e o que está em execução.</p></div></div><div class="ov-sectors">${Object.entries(overviewNames).map(([id,name])=>{const count=all.filter(e=>[...e.state.ready,...e.state.running].some(s=>s.id===id)).length;return `<button type="button" data-ov-sector="${id}" aria-pressed="${overviewFilters.sector===id}"><span>${name}</span><strong>${count}</strong></button>`;}).join('')}</div><p class="ov-hint">Uma arte pode aparecer em Estoque e Digital ao mesmo tempo. Os números acima consideram todos os pedidos carregados.</p></section><section class="ov-section"><div class="ov-section-head"><div><h2>Pedidos e artes</h2><p>Pesquise, filtre e abra os detalhes sem perder o acompanhamento.</p></div><div class="ov-view-toggle" aria-label="Forma de visualização"><button data-ov-view="orders" type="button" aria-pressed="${overviewFilters.view==='orders'}">Por pedido</button><button data-ov-view="arts" type="button" aria-pressed="${overviewFilters.view==='arts'}">Galeria de artes</button></div></div><div class="ov-filters"><label class="ov-search">Buscar<input id="ov-search" type="search" value="${esc(overviewFilters.query)}" placeholder="Cliente, pedido, arte, OP ou tecido"></label><label>Situação<select id="ov-status">${[['active','Em aberto'],['all','Todas'],['running','Em execução'],['pcp','Aguardando PCP'],['late','Prazo vencido'],['done','Entregues']].map(([id,label])=>`<option value="${id}" ${overviewFilters.status===id?'selected':''}>${label}</option>`).join('')}</select></label><label>Serviço<select id="ov-service"><option value="all">Todos os serviços</option>${[...new Set(overviewRows.map(o=>o.service).filter(Boolean))].sort().map(s=>`<option ${overviewFilters.service===s?'selected':''}>${esc(s)}</option>`).join('')}</select></label><label>Ordenar<select id="ov-sort"><option value="due">Entrega mais próxima</option><option value="recent" ${overviewFilters.sort==='recent'?'selected':''}>Cadastro mais recente</option></select></label></div><div class="ov-results-heading"><span id="ov-results-count" role="status" aria-live="polite"></span><button id="ov-clear" type="button" class="ov-detail-button">Limpar filtros</button></div><div id="ov-results"></div></section><dialog id="ov-art-dialog" class="art-dialog"><button type="button" class="secondary" id="ov-close-art">Fechar ×</button><h2 id="ov-art-title"></h2><img id="ov-art-image" alt="Arte ampliada"></dialog><dialog id="ov-detail-dialog" class="ov-dialog"><div id="ov-detail-content"></div></dialog></div>`;
  $('#ov-refresh').onclick=showOverview;
  $('#ov-close-art').onclick=()=>$('#ov-art-dialog').close();
  $('#ov-search').oninput=()=>{overviewFilters.query=$('#ov-search').value;renderOverviewResults();};
  for(const key of ['status','service','sort'])$('#ov-'+key).onchange=()=>{overviewFilters[key]=$('#ov-'+key).value;renderOverviewResults();};
  $('#ov-clear').onclick=()=>{overviewFilters={...overviewDefaults,status:'all',view:overviewFilters.view};renderOverview();};
  $('#workspace').onclick=event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.ovStatus){overviewFilters={...overviewDefaults,status:button.dataset.ovStatus,view:overviewFilters.view};renderOverview();}
    if(button.dataset.ovSector){const sector=button.dataset.ovSector;overviewFilters={...overviewDefaults,sector:overviewFilters.sector===sector?'all':sector,view:overviewFilters.view};renderOverview();}
    if(button.dataset.ovView){overviewFilters.view=button.dataset.ovView;renderOverview();}
    if(button.dataset.preview){$('#ov-art-title').textContent=button.dataset.art;$('#ov-art-image').src=button.dataset.preview;$('#ov-art-dialog').showModal();}
    if(button.dataset.ovDetail)showOverviewDetail(Number(button.dataset.ovDetail));
    if(button.hasAttribute('data-ov-close'))$('#ov-detail-dialog').close();
    if(button.dataset.ovOpen){$('#ov-detail-dialog').close();navigate(button.dataset.ovOpen);}
  };
  renderOverviewResults();
}
function renderOverviewResults(){
  const filtered=overviewSort(overviewEntries().filter(e=>overviewMatches(e)));
  const numbers=[...new Set(filtered.map(e=>e.order.number))];
  $('#ov-results-count').textContent=`${numbers.length} pedido(s) · ${filtered.length} arte(s)${overviewFilters.sector!=='all'?' · setor: '+overviewNames[overviewFilters.sector]:''}`;
  document.querySelectorAll('[data-ov-status]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.ovStatus===overviewFilters.status)));
  const empty=overviewRows.length?'Nenhuma arte corresponde aos filtros. Limpe os filtros ou selecione outra situação.':'Nenhum pedido cadastrado. Use a aba Pedidos para começar.';
  $('#ov-results').className=overviewFilters.view==='arts'?'ov-gallery':'ov-orders';
  $('#ov-results').innerHTML=filtered.length?(overviewFilters.view==='arts'?filtered.map(e=>overviewArt(e)).join(''):numbers.map(number=>{const entries=filtered.filter(e=>e.order.number===number);return overviewOrder(entries[0].order,entries);}).join('')):`<div class="ov-empty"><strong>Nada para mostrar por aqui</strong><p>${empty}</p></div>`;
}
function showOverviewDetail(id){
  const entry=overviewEntries().find(e=>e.item.id===id);if(!entry)return;
  const {order,item,state}=entry,f=item.test_flow||{};
  const stateLabel={done:'Concluído',running:'Em execução',ready:'Na fila',blocked:'Aguardando etapa anterior'};
  const events=[...(item.stage_history||[]).map(e=>({...e,label:operationActionNames[e.action]||e.action})),...(item.test_events||[]).filter(e=>!['quick:','button:'].some(prefix=>String(e.request_key||'').startsWith(prefix))).map(e=>({...e,label:`${overviewNames[e.sector]||e.sector} · ${fmt(e.quantity)} ${item.unit} · ${e.reference||''}`}))].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  $('#ov-detail-content').innerHTML=`<header><div><span class="eyebrow">${esc(order.number)} · ${esc(item.test_op||'Sem OP')}</span><h2 id="ov-detail-title">${esc(item.art)}</h2><p>${esc(order.client||'Cliente não informado')}</p></div><button type="button" class="secondary" data-ov-close aria-label="Fechar detalhes">Fechar ×</button></header><div class="ov-detail-top">${artThumbnail(item)}<div><div class="ov-badges">${overviewBadges(entry)}</div><dl><dt>Quantidade</dt><dd>${esc(fmt(item.quantity))} ${esc(item.unit)}</dd><dt>Serviço</dt><dd>${esc(order.service)}</dd><dt>Entrega prometida</dt><dd>${esc(date(order.delivery))}</dd><dt>Proprietário do tecido</dt><dd>${esc(f.needs_fabric?item.fabric_owner||'A confirmar no Estoque':'Não se aplica')}</dd></dl>${item.sewing_plan?.enabled?`<p><strong>Costura · ${item.sewing_plan.pieces} peças previstas</strong><br>${esc(item.sewing_plan.instructions)}</p>`:''}</div></div>${replenishmentSummary(item)}<h3>Percurso desta arte</h3><p class="ov-hint">Estoque e Digital podem trabalhar em paralelo. As etapas seguintes respeitam a liberação dos materiais.</p><ol class="ov-route">${state.stages.map(stage=>`<li class="${stage.state}"><span>${stage.state==='done'?'✓':stage.state==='running'?'●':'○'}</span><div><strong>${esc(stage.name)}</strong><small>${stateLabel[stage.state]}${stage.id==='expedicao'&&f.packed&&!f.delivered?' · volume pronto':''}</small></div>${['running','ready'].includes(stage.state)?`<button class="ov-detail-button" data-ov-open="${stage.id}" type="button">Abrir setor ↗</button>`:''}</li>`).join('')||'<li>Sem apontamentos de produção disponíveis.</li>'}</ol><h3>Últimos registros</h3><div class="ov-history">${events.slice(0,30).map(e=>`<p><strong>${esc(e.label)}</strong><small>${esc(e.actor)} · ${esc(timestamp(e.created_at))}</small></p>`).join('')||'<p>Nenhuma execução registrada para esta arte.</p>'}</div>`;
  $('#ov-detail-dialog').setAttribute('aria-labelledby','ov-detail-title');$('#ov-detail-dialog').showModal();
}
