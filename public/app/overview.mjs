import {overviewNames,overviewToday,overviewStages,overviewState,overviewLate,overviewMatches,overviewSort} from './order-model.mjs';
export function createOverview(ctx){
const {$,esc,fmt,date,heading,api,navigate,artThumbnail,replenishmentSummary,unitName,unitValue,operationActionNames,timestamp}=ctx;
/* Acompanhamento da fábrica: somente leitura, disponível apenas à Gestão. */
let overviewRows=[], overviewUpdated='', overviewRequest=0;
const overviewDefaults={query:'',status:'active',sector:'all',service:'all',sort:'due',view:'orders'};
let overviewFilters={...overviewDefaults};





function overviewEntries(rows=overviewRows){return rows.flatMap(order=>order.items.map(item=>({order,item,state:overviewState(item)})));}


function overviewBadges(entry){
  const {state,item}=entry;
  if(state.done)return '<span class="ov-badge done">✓ Entregue</span>';
  if(item.laser_progress){const l=item.laser_progress;return `<span class="ov-badge">${esc({draft:'Grades em preparação',ready:'Corte na fila',partial:'Corte parcial',complete:'Corte concluído'}[l.status])} · ${fmt(l.good)} boas · ${fmt(l.calculatedCm)} cm${l.openReprints?' · '+l.openReprints+' reposições abertas':''}</span>`;}if(!item.test_flow)return '<span class="ov-badge">Sem apontamentos</span>';
  return [...state.running,...state.ready].map(stage=>`<span class="ov-badge ${stage.state}">${stage.state==='running'?'● ':''}${esc(stage.name)}${stage.state==='running'?' em execução':stage.id==='expedicao'&&item.test_flow.packed?' · volume pronto':' · na fila'}</span>`).join('')||'<span class="ov-badge">Aguardando próxima etapa</span>';
}
function overviewArt(entry,compact=false){
  const {order,item,state}=entry;
  const machine=state.running.some(s=>s.id==='digital'&&!s.replacement)?item.test_flow.digital_machine:state.running.some(s=>s.id==='calandra'&&!s.replacement)?item.test_flow.calandra_machine:'';
  return `<article class="ov-art ${compact?'compact':''}">${artThumbnail(item)}<div class="ov-art-info"><small>${esc(compact?item.test_op||'Sem OP':order.number+' · '+(order.client||'Cliente não informado'))}</small><h3>${esc(item.art)}</h3><p>${unitValue(item.quantity,item.unit)} ${unitName(item.unit)} · ${esc(item.test_flow?.needs_fabric===false?'Papel impresso':item.fabric||order.fabric||order.service||'Material não informado')}</p><div class="ov-badges">${overviewBadges(entry)}</div>${machine?`<p class="ov-machine">${esc(machine)}${item.test_flow.paper_width&&state.running.some(s=>s.id==='digital')?' · papel '+esc(item.test_flow.paper_width):''}</p>`:''}${!compact?`<p class="${overviewLate(order,item)?'ov-late':'ov-due'}">Entrega ${esc(date(order.delivery))}${overviewLate(order,item)?' · prazo vencido':''}</p>`:''}${replenishmentSummary(item)}${[...state.running,...state.ready].slice(0,1).map(stage=>`<button class="primary ov-next" data-ov-open="${stage.id}" type="button">Abrir ${esc(stage.name)} →</button>`).join("")}<button class="ov-detail-button" data-ov-detail="${item.id}" type="button">Ver percurso e detalhes ↗</button></div></article>`;
}
function overviewOrder(order,entries){
  const delivered=order.items.filter(i=>i.test_flow?.delivered).length;
  const late=entries.some(e=>overviewLate(order,e.item));
  return `<section class="ov-order"><header><div><span class="eyebrow">${esc(order.number)} · ${esc(order.service)}</span><h2>${esc(order.client||'Cliente não informado')}</h2><p>${order.items.length} arte(s) · ${delivered} entregue(s)${entries.length<order.items.length?' · '+entries.length+' neste filtro':''}</p></div><div class="ov-order-deadline ${late?'ov-late':''}"><small>ENTREGA PROMETIDA</small><strong>${esc(date(order.delivery))}</strong>${late?'<span>Prazo vencido</span>':''}</div></header><div class="ov-delivery-progress" role="progressbar" aria-label="Artes entregues do pedido ${esc(order.number)}" aria-valuemin="0" aria-valuemax="${order.items.length}" aria-valuenow="${delivered}"><span style="width:${order.items.length?100*delivered/order.items.length:0}%"></span></div><div class="ov-order-arts">${entries.map(e=>overviewArt(e,true)).join('')}</div></section>`;
}
async function showOverview(){
  if(ctx.user()?.role!=='gestao')return;
  const request=++overviewRequest,session=ctx.user();
  $('#workspace').innerHTML=heading('Visão geral','Pedidos, artes e próximos passos em um só lugar.','ACOMPANHAMENTO DA FÁBRICA')+'<div class="card" role="status">Carregando acompanhamento…</div>';
  try{
    const rows=await api('/pedidos/api/factory/orders');
    if(request!==overviewRequest||ctx.current()!=='overview'||ctx.user()!==session)return;
    overviewRows=rows;overviewUpdated=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});renderOverview();
  }catch(error){
    if(request!==overviewRequest||ctx.current()!=='overview'||ctx.user()!==session)return;
    $('#workspace').innerHTML=`<div class="card"><p class="error" role="alert">${esc(error.message)}</p><button class="secondary" id="retry-overview">Tentar novamente</button></div>`;
    $('#retry-overview').onclick=showOverview;
  }
}
function renderOverview(){
  if(ctx.user()?.role!=='gestao')return;
  const all=overviewEntries(),activeOrders=overviewRows.filter(o=>!o.items.length||o.items.some(i=>!i.test_flow?.delivered)).length;
  const metrics=[['active','Pedidos em aberto',activeOrders,'pedidos ainda não entregues'],['running','Artes em execução',all.filter(e=>e.state.running.length).length,'impressão, transferência, corte ou costura'],['pcp','Aguardando PCP',all.filter(e=>e.state.pcp).length,'artes para liberar'],['late','Artes com prazo vencido',all.filter(e=>overviewLate(e.order,e.item)).length,'ainda não entregues']];
  $('#workspace').innerHTML=`<div class="ov-dashboard">${heading('Visão geral','Acompanhe as artes, identifique pendências e veja o próximo passo de cada pedido.','ACOMPANHAMENTO')}<div class="ov-update"><span>${ctx.testMode()?'Ambiente de testes · confirmações simuladas':'Pedidos e etapas atualizados pelos apontamentos da fábrica'} · atualizado às ${overviewUpdated}</span><button class="secondary" id="ov-refresh" type="button">Atualizar dados ↻</button></div><div class="ov-quick-actions"><button class="primary" data-ov-open="pedidos" type="button">Cadastrar / consultar pedido</button><button class="secondary" data-ov-open="pcp" type="button">Preparar a produção →</button><button class="secondary" data-ov-open="corte" type="button">Grades e romaneios do Laser →</button></div><div class="ov-metrics">${metrics.map(([status,label,count,hint])=>`<button type="button" class="ov-metric ${status==='late'?'attention':''}" data-ov-status="${status}" aria-pressed="${overviewFilters.status===status}"><span>${label}</span><strong>${count}</strong><small>${hint}</small></button>`).join('')}</div><section class="ov-section"><div class="ov-section-head"><div><h2>Onde estão as artes</h2><p>Clique em um setor para ver sua fila e o que está em execução.</p></div></div><div class="ov-sectors">${Object.entries(overviewNames).map(([id,name])=>{const count=all.filter(e=>[...e.state.ready,...e.state.running].some(s=>s.id===id)).length;return `<button type="button" data-ov-sector="${id}" aria-pressed="${overviewFilters.sector===id}"><span>${name}</span><strong>${count}</strong></button>`;}).join('')}</div><p class="ov-hint">Uma arte pode aparecer em Estoque e Digital ao mesmo tempo. Os números acima consideram todos os pedidos carregados.</p></section><section class="ov-section"><div class="ov-section-head"><div><h2>Pedidos e artes</h2><p>Pesquise, filtre e abra os detalhes sem perder o acompanhamento.</p></div><div class="ov-view-toggle" aria-label="Forma de visualização"><button data-ov-view="orders" type="button" aria-pressed="${overviewFilters.view==='orders'}">Por pedido</button><button data-ov-view="arts" type="button" aria-pressed="${overviewFilters.view==='arts'}">Galeria de artes</button></div></div><div class="ov-filters"><label class="ov-search">Buscar<input id="ov-search" type="search" value="${esc(overviewFilters.query)}" placeholder="Cliente, pedido, arte, OP ou tecido"></label><label>Situação<select id="ov-status">${[['active','Em aberto'],['all','Todas'],['running','Em execução'],['pcp','Aguardando PCP'],['late','Prazo vencido'],['done','Entregues']].map(([id,label])=>`<option value="${id}" ${overviewFilters.status===id?'selected':''}>${label}</option>`).join('')}</select></label><label>Serviço<select id="ov-service"><option value="all">Todos os serviços</option>${[...new Set(overviewRows.map(o=>o.service).filter(Boolean))].sort().map(s=>`<option ${overviewFilters.service===s?'selected':''}>${esc(s)}</option>`).join('')}</select></label><label>Ordenar<select id="ov-sort"><option value="due">Entrega mais próxima</option><option value="recent" ${overviewFilters.sort==='recent'?'selected':''}>Cadastro mais recente</option></select></label></div><div class="ov-results-heading"><span id="ov-results-count" role="status" aria-live="polite"></span><button id="ov-clear" type="button" class="ov-detail-button">Limpar filtros</button></div><div id="ov-results"></div></section><details class="ov-data-export"><summary>Dados operacionais para as planilhas</summary><p>Baixe os registros para conferência. As planilhas mantêm seus cálculos e preços.</p><div>${[["pedidos","Pedidos"],["consumos","Consumos e preços pendentes"],["etapas","Histórico de etapas"],["medicoes","Saídas boas e perdas"],["entregas","Entregas"],["grades","Grades e metragens"],["reimpressoes","Reimpressões"],["romaneios","Romaneios"]].map(([key,label])=>`<a href="/api/integration/planilhas/${key}.csv">${label} ↓</a>`).join("")}</div></details><dialog id="ov-art-dialog" class="art-dialog"><button type="button" class="secondary" id="ov-close-art">Fechar ×</button><h2 id="ov-art-title"></h2><img id="ov-art-image" alt="Arte ampliada"></dialog><dialog id="ov-detail-dialog" class="ov-dialog"><div id="ov-detail-content"></div></dialog></div>`;
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
  const filtered=overviewSort(overviewEntries().filter(e=>overviewMatches(e,overviewFilters)),overviewFilters.sort);
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


return {showOverview,invalidate:()=>overviewRequest++};
}
