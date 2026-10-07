/* Interfaces operacionais: os dados e as permissões continuam validados no servidor. */
const boardPreferences = {};
const operationViews = {
  estoque:{description:'Identifique o proprietário e separe o tecido de cada OP.',labels:['A separar','Tecido disponível','Separados']},
  digital:{description:'Selecione a impressora e o papel. Confira a arte antes de iniciar.',labels:['Na fila','Imprimindo','Impressos']},
  preparacao:{description:'Prepare o tecido separado pelo Estoque e libere o conjunto.',labels:['Aguardando',null,'Concluídos']},
  calandra:{description:'Confira papel e tecido da mesma OP antes da transferência.',labels:['Na fila','Em transferência','Concluídos']},
  corte:{description:'Receba as OPs da Calandra e acompanhe o corte de cada arte.',labels:['A cortar','Em corte','Concluídos']},
  costura:{description:'Siga a montagem definida pelo PCP e confira as peças previstas.',labels:['A costurar','Em costura','Concluídos']},
  revisao:{description:'Confira a arte, o tecido e a quantidade antes de aprovar a OP.',labels:['A conferir',null,'Aprovados']},
  expedicao:{description:'Identifique o volume, prepare a saída e registre o recebimento.',labels:['A embalar','Prontos para entrega','Entregues']},
};
const operationActionNames={available:'Tecido disponível',separated:'Tecido separado',printing:'Impressão iniciada',printed:'Papel impresso',prepared:'Tecido preparado',calandra_running:'Transferência iniciada',calandra_done:'Transferência concluída',cutting:'Corte iniciado',cut_done:'Corte concluído',sewing:'Costura iniciada',sewn:'Costura concluída',review_done:'Revisão aprovada',packed:'Volume preparado',delivered:'Entrega registrada'};
const money=value=>value===null||value===undefined?'Preço pendente':Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const timestamp=value=>value?new Date(value).toLocaleString('pt-BR'):'—';

function sewingPlanning(order){
  if(order.service==='Venda de Papel')return '';
  return `<details class="sewing-planning"><summary>Planejar Costura por arte</summary><p class="muted">Inclua somente nas OPs que precisam de montagem. A Costura entra depois do Corte, da Calandra ou da separação, antes da Revisão.</p>${order.items.map(item=>{
    const plan=item.sewing_plan||{},f=item.test_flow||{};
    if(f.sewing||f.sewn||f.review_done||f.packed||f.delivered)return `<p><strong>${esc(item.art)}</strong> · ${plan.enabled?'Com Costura':'Sem Costura'} · rota já em execução.</p>`;
    return `<form data-sewing-form data-number="${esc(order.number)}" data-item="${item.id}"><strong>${esc(item.art)}</strong><label>Passa pela Costura?<select name="enabled"><option value="false">Não</option><option value="true" ${plan.enabled?'selected':''}>Sim</option></select></label><label>Peças previstas (se houver Costura)<input name="pieces" type="number" min="1" max="1000000" step="1" value="${plan.pieces||''}"></label><label>Instruções de montagem<textarea name="instructions" maxlength="1000" rows="3">${esc(plan.instructions||'')}</textarea></label><button class="secondary" type="submit">Salvar planejamento</button><p class="card-feedback error" role="alert"></p></form>`;
  }).join('')}</details>`;
}
function bindSewingPlanning(){
  $('#workspace').onsubmit=async event=>{
    const form=event.target.closest('[data-sewing-form],[data-production-plan]');if(!form)return;event.preventDefault();
    const values=Object.fromEntries(new FormData(form)),button=form.querySelector('button');button.disabled=true;
    try{await post('/pedidos/api/test/configure',{...values,kind:form.hasAttribute('data-production-plan')?'production':'sewing',number:form.dataset.number,item_id:Number(form.dataset.item),enabled:values.enabled==='true'});if(current==='pcp')await showSector('pcp');}
    catch(error){form.querySelector('.card-feedback').textContent=error.message;button.disabled=false;}
  };
}

function boardEligible(role,item){
  if(!item.test_op)return false;
  const f=item.test_flow||{};
  return {estoque:f.needs_fabric,digital:f.needs_print,preparacao:f.needs_preparation&&f.separated,
    calandra:f.needs_calandra&&f.prepared,corte:f.needs_cut&&f.calandra_done&&(!f.exhausted||f.cut_done),costura:f.sewing_ready&&!f.exhausted,
    revisao:f.review_ready,expedicao:f.expedition_ready}[role];
}
function boardColumn(role,item){
  const f=item.test_flow||{};
  const states={estoque:[f.separated,f.available],digital:[f.printed,f.printing],preparacao:[f.prepared,false],
    calandra:[f.calandra_done,f.calandra_running],corte:[f.cut_done,f.cutting],costura:[f.sewn,f.sewing],
    revisao:[f.review_done,false],expedicao:[f.delivered,f.packed]};
  return states[role][0]?2:states[role][1]?1:0;
}
function operationSelect(name,label,options,value='',locked=false){
  return `<label>${label}<select name="${name}" required ${locked?'disabled':''}><option value="">Selecione</option>${options.map(option=>`<option value="${esc(option)}" ${value===option?'selected':''}>${esc(option)}</option>`).join('')}</select></label>`;
}
function artThumbnail(item){
  if(!item.asset_id)return '<div class="art-placeholder">Sem prévia<br>cadastrada</div>';
  const src='/pedidos/miniaturas/'+encodeURIComponent(item.asset_id)+'.jpg';
  return `<button class="art-preview-button" type="button" data-preview="${src}" data-art="${esc(item.art)}" aria-label="Ampliar arte ${esc(item.art)}"><img class="art-preview" src="${src}" alt="${esc(item.art)}" loading="lazy" onerror="this.hidden=true;this.parentElement.textContent='Imagem indisponível'"><span>Ampliar ↗</span></button>`;
}
function boardActions(role,order,item){
  const f=item.test_flow||{},plan=item.sewing_plan||{},dispatch=item.dispatch||{};
  const button=(action,label,disabled=false)=>`<button type="button" class="primary" data-transition="${action}" ${disabled?'disabled':''}>${label}</button>`;
  let html='';
  if(role==='estoque'&&!f.separated)html=(!f.available?button('available','Tecido em estoque'):'')+button('separated','Confirmar separação',!item.fabric_owner);
  if(role==='preparacao'&&!f.prepared)html=button('prepared','Tecido preparado');
  if(role==='digital'&&!f.printed)html=operationSelect('machine','Impressora',digitalMachines,f.digital_machine,f.printing&&!!f.digital_machine)+operationSelect('reference','Largura do papel',paperWidths,f.paper_width,f.printing&&!!f.paper_width)+(f.printing?button('printed','Papel impresso'):button('printing','Iniciar impressão'));
  if(role==='calandra'&&!f.calandra_done)html=f.calandra_ready?operationSelect('machine','Calandra',calandras,f.calandra_machine,f.calandra_running)+(f.calandra_running?button('calandra_done','Concluir transferência'):button('calandra_running','Iniciar Calandra')):`<p class="card-warning">${f.exhausted?'Sem quantidade útil neste trabalho. Confira a perda e a reposição antes de continuar.':'Aguardando impressão do papel desta OP.'}</p>`;
  if(role==='corte'&&!f.cut_done)html=f.cutting?button('cut_done','Concluir corte'):button('cutting','Iniciar corte');
  if(role==='costura'&&!f.sewn)html=f.sewing?`<label>Peças concluídas<input name="pieces" type="number" min="1" max="${Number(plan.pieces)}" step="1" required placeholder="${Number(plan.pieces)} peças previstas"></label>`+button('sewn','Concluir Costura'):button('sewing','Iniciar Costura');
  if(role==='revisao'&&!f.review_done)html=button('review_done','Aprovar na Revisão');
  if(role==='expedicao'&&!f.delivered)html=f.packed?'<label>Quem recebeu<input name="machine" required maxlength="120" autocomplete="off" placeholder="Nome do recebedor"></label>'+button('delivered','Confirmar entrega'):'<label>Identificação do volume<input name="reference" required maxlength="120" placeholder="Ex.: Volume 01 / OP"></label>'+operationSelect('machine','Forma de saída',['Retirada','Entrega'])+'<label>Destino / retirada<input name="destination" maxlength="300" placeholder="Endereço ou local combinado"></label>'+button('packed','Preparar volume');
  return html?`<form class="board-actions" data-stage-form>${measurementInputs(role,item)}${html}</form>`:'';
}
function operationCard(role,order,item){
  const f=item.test_flow||{},col=boardColumn(role,item),plan=item.sewing_plan||{},dispatch=item.dispatch||{};
  const canAct=user.role===role||user.role==='gestao';
  const identity=role==='estoque'?`<div class="owner-panel"><small>CLIENTE DO PEDIDO</small><strong>${esc(order.client||'Não informado')}</strong><small>PROPRIETÁRIO DO TECIDO</small><strong class="${item.fabric_owner?'':'pending-text'}">${esc(item.fabric_owner||'A confirmar')}</strong>${!item.owner_confirmed&&canAct?`<form data-owner-form><label>Confirme o nome do proprietário<input name="owner" maxlength="120" required value="${esc(item.fabric_owner||order.client||'')}" placeholder="Cliente, Sublipaper ou terceiro"></label><button class="secondary" type="submit">Confirmar proprietário</button></form>`:''}</div>`:role==='expedicao'?`<div class="owner-panel"><small>CLIENTE / DESTINATÁRIO</small><strong>${esc(order.client||'Não informado')}</strong></div>`:'';
  const specs=[['Meta do pedido',`${fmt(item.production_plan?.final_qty??item.quantity)} ${unitName(item.production_plan?.final_unit??item.unit)}`],['Quantidade desta etapa',`${fmt(item.measurement_spec?.expected??item.quantity)} ${unitName(item.measurement_spec?.unit??item.unit)}`],f.needs_fabric?['Tecido',item.fabric||order.fabric||'Não informado']:['Material','Papel impresso']];
  if(item.production_plan?.final_unit==='pc')specs.push(['Metragem planejada do pedido',`${fmt(item.production_plan.print_m)} m`]);
  if(role==='digital'&&!f.needs_fabric&&(item.fabric||order.fabric))specs.push(['Tecido de destino',item.fabric||order.fabric]);
  if(item.width_m||order.width_m)specs.push(['Largura',`${fmt(item.width_m||order.width_m)} m`]);
  if(['digital','calandra'].includes(role)&&item.production_plan?.final_unit==='pc')specs.push(['Meta do produto',`${fmt(item.production_plan.final_qty)} peças`]);
  if(role==='digital'&&item.unit==='pc')specs.push(['Metragem planejada',`${fmt(item.production_plan?.print_m)} m`]);
  if(role==='digital'&&f.digital_machine)specs.push(['Impressora',f.digital_machine],['Papel',f.paper_width]);
  if(role==='calandra'&&f.calandra_machine)specs.push(['Equipamento',f.calandra_machine]);
  if(plan.enabled&&['costura','revisao','expedicao'].includes(role))specs.push(['Peças previstas',`${plan.pieces} peças`]);
  if(plan.completed_pieces&&['costura','revisao','expedicao'].includes(role))specs.push(['Peças concluídas',`${plan.completed_pieces} peças`]);
  if(role==='preparacao')specs.push(['Proprietário',item.fabric_owner||'Não confirmado no Estoque']);
  const sewing=role==='costura'?`<div class="work-instructions"><small>INSTRUÇÕES DE MONTAGEM</small><p>${esc(plan.instructions||'PCP ainda não informou as instruções.')}</p><small>A quantidade em peças é informada pelo PCP; não é uma conversão automática da metragem.</small></div>`:'';
  const packing=role==='expedicao'&&f.packed?`<div class="work-instructions"><strong>${esc(dispatch.volume||'Volume legado')}</strong><p>${esc(dispatch.method||'Saída não informada')} ${dispatch.destination?'· '+esc(dispatch.destination):''}</p>${f.delivered?`<p>Recebido por <strong>${esc(dispatch.recipient)}</strong><br>${esc(timestamp(dispatch.delivered_at))}</p>`:''}</div>`:'';
  const history=(item.stage_history||[]).length?`<details class="operation-history"><summary>Histórico desta etapa</summary>${item.stage_history.map(event=>`<p><strong>${esc(operationActionNames[event.action]||event.action)}</strong><br>${esc(event.actor)} · ${esc(timestamp(event.created_at))}</p>`).join('')}</details>`:'';
  const state=operationViews[role].labels[col];
  return `<article class="production-card state-${col}" data-number="${esc(order.number)}" data-batch="${esc(order.batch_token||'')}" data-item="${item.id}" data-column="${col}" data-search="${esc([order.number,order.client,item.art,item.fabric,order.fabric,item.fabric_owner,item.test_op].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR'))}"><div class="card-topline"><span class="eyebrow">${esc(item.test_op)}</span><span class="state-chip state-${col}">${esc(state)}</span></div><div class="production-card-main ${role==='estoque'?'without-art':''}">${role==='estoque'?'':artThumbnail(item)}<div><h3>${esc(order.number)}</h3><strong class="art-name">${esc(item.art)}</strong>${order.delivery?`<p class="due-date">Prazo do pedido · ${esc(date(order.delivery))}</p>`:''}</div></div>${identity}<dl class="operation-specs">${specs.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${sewing}${packing}${measurementHistory(role,order,item)}${role==='revisao'?replenishmentSummary(item):''}<p class="next-sector">${role==='expedicao'?(f.delivered?'Entrega registrada':'Destino: cliente / recebedor'):`Próximo: <strong>${esc(nextSector(role,item))}</strong>`}</p>${canAct?boardActions(role,order,item):''}<p class="card-feedback error" role="alert"></p>${history}</article>`;
}
function renderBoard(role){
  const view=operationViews[role];
  const cards=orders.flatMap(order=>order.items.filter(item=>boardEligible(role,item)).map(item=>({order,item})));
  const columns=view.labels.map((label,index)=>({label,index})).filter(column=>column.label);
  const preferences=boardPreferences[role]||{query:'',state:'all'};
  $('#workspace').innerHTML=heading(sectorInfo[role].name,view.description,'OPERAÇÃO DE TESTE')+
    `<div class="sector-summary">${columns.map(({label,index})=>`<div class="summary-item state-${index}"><span>${esc(label)}</span><strong>${cards.filter(({item})=>boardColumn(role,item)===index).length}</strong><small>OPs nesta etapa</small></div>`).join('')}</div>`+
    `<div class="board-toolbar"><label>Buscar nesta fila<input id="board-search" type="search" value="${esc(preferences.query)}" placeholder="Pedido, arte, tecido${['estoque','expedicao'].includes(role)?' ou cliente':''}"></label><label>Exibir<select id="board-state"><option value="all">Todas as OPs</option><option value="active" ${preferences.state==='active'?'selected':''}>Somente pendentes</option><option value="done" ${preferences.state==='done'?'selected':''}>Somente concluídas</option></select></label><button class="secondary" id="refresh-board" type="button">Atualizar fila ↻</button></div><p class="operational-note">Medições de saída conferidas por trabalho. ${role==='costura'?'Inclua a etapa e as peças previstas pela aba PCP. ':''}Registros salvos somente no ambiente de testes.</p><p id="board-feedback" class="error" role="alert"></p>`+
    `<div class="production-board ${columns.length===2?'two-columns':''}">${columns.map(({label,index})=>`<section class="board-column state-${index}"><h2>${esc(label)} <span data-column-count="${index}">${cards.filter(({item})=>boardColumn(role,item)===index).length}</span></h2>${cards.filter(({item})=>boardColumn(role,item)===index).map(({order,item})=>operationCard(role,order,item)).join('')}<p class="column-empty" ${cards.some(({item})=>boardColumn(role,item)===index)?'hidden':''}>Nenhuma OP nesta coluna.</p></section>`).join('')}</div><dialog id="art-dialog" class="art-dialog"><button type="button" id="close-art-dialog" class="secondary">Fechar ×</button><h2 id="art-dialog-title"></h2><img id="art-dialog-image" alt="Arte ampliada"></dialog>`;
  bindMeasurementInputs();
  $('#refresh-board').onclick=()=>showSector(role);
  $('#close-art-dialog').onclick=()=>$('#art-dialog').close();
  const filter=()=>{
    const query=$('#board-search').value.toLocaleLowerCase('pt-BR').trim(),state=$('#board-state').value;
    boardPreferences[role]={query:$('#board-search').value,state};
    document.querySelectorAll('.production-card[data-search]').forEach(card=>{card.hidden=(!card.dataset.search.includes(query))||(state==='active'&&card.dataset.column==='2')||(state==='done'&&card.dataset.column!=='2');});
    document.querySelectorAll('.board-column').forEach(column=>{const visible=[...column.querySelectorAll('.production-card')].filter(card=>!card.hidden).length;column.querySelector('[data-column-count]').textContent=visible;column.querySelector('.column-empty').hidden=visible>0;});
  };
  $('#board-search').oninput=filter;$('#board-state').onchange=filter;
  if(preferences.query||preferences.state!=='all')filter();
  $('#workspace').onsubmit=async event=>{
    if(event.target.matches('[data-stage-form]')){event.preventDefault();return;}
    const replacement=event.target.closest('[data-replenishment]');
    if(replacement){event.preventDefault();const card=replacement.closest('[data-item]'),button=replacement.querySelector('button');button.disabled=true;try{await post('/pedidos/api/test/replenishment',{...Object.fromEntries(new FormData(replacement)),number:card.dataset.number,batch_token:card.dataset.batch,item_id:Number(card.dataset.item),source_action:replacement.dataset.sourceAction});if(current===role)await showSector(role);}catch(error){card.querySelector('.card-feedback').textContent=error.message;button.disabled=false;}return;}
    const form=event.target.closest('[data-owner-form]');if(!form)return;event.preventDefault();
    const card=form.closest('[data-item]'),button=form.querySelector('button');button.disabled=true;
    try{await post('/pedidos/api/test/configure',{number:card.dataset.number,batch_token:card.dataset.batch,item_id:Number(card.dataset.item),kind:'owner',owner:form.querySelector('[name=owner]').value});if(current===role)await showSector(role);}
    catch(error){card.querySelector('.card-feedback').textContent=error.message;button.disabled=false;}
  };
  $('#workspace').onclick=async event=>{
    const previewButton=event.target.closest('[data-preview]');
    if(previewButton){$('#art-dialog-title').textContent=previewButton.dataset.art;$('#art-dialog-image').src=previewButton.dataset.preview;$('#art-dialog').showModal();return;}
    const target=event.target.closest('[data-transition]');if(!target||target.disabled)return;
    const card=target.closest('[data-item]'),form=target.closest('form');if(!form.reportValidity())return;
    const values=Object.fromEntries([...form.querySelectorAll('[name]')].map(field=>[field.name,field.value]));
    const controls=[...card.querySelectorAll('button')].map(button=>({button,disabled:button.disabled}));controls.forEach(({button})=>button.disabled=true);
    try{await post('/pedidos/api/test/transition',{...values,number:card.dataset.number,batch_token:card.dataset.batch,item_id:Number(card.dataset.item),action:target.dataset.transition});if(current===role)await showSector(role);}
    catch(error){card.querySelector('.card-feedback').textContent=error.message;controls.forEach(({button,disabled})=>button.disabled=disabled);}
  };
}

function renderFinance(){
  const billingStatus=order=>order.billing?.status==='paid'?'Recebido':order.billing?.status==='invoiced'?'Faturado':order.billing?.ready?'A faturar':'Em conferência';
  const billed=order=>order.billing?.events?.find(event=>event.action==='invoiced')?.amount??order.total;
  const sum=status=>orders.filter(order=>billingStatus(order)===status).reduce((total,order)=>total+Number(billed(order)||0),0);
  $('#workspace').innerHTML=heading('Financeiro / faturamento','Confira valores por pedido e acompanhe faturamento e recebimento.','SIMULAÇÃO FINANCEIRA')+
    `<div class="sector-summary">${['A faturar','Faturado','Recebido'].map((status,index)=>`<div class="summary-item state-${index}"><span>${status}</span><strong class="money-metric">${money(sum(status))}</strong><small>${orders.filter(order=>billingStatus(order)===status).length} pedidos</small></div>`).join('')}</div><div class="board-toolbar"><label>Buscar pedido ou cliente<input id="finance-search" type="search" placeholder="Número do pedido ou nome do cliente"></label><button class="secondary" id="refresh-finance">Atualizar ↻</button></div><p class="operational-note">Neste teste, o pedido fica disponível para faturar após todas as OPs serem entregues e os preços estarem preenchidos. Estes registros não emitem nota fiscal nem movimentam contas bancárias.</p><div class="finance-list">${orders.map(order=>{
      const status=billingStatus(order),delivered=order.items.filter(item=>item.test_flow?.delivered).length;
      const history=order.billing?.events||[],missing=order.items.some(item=>item.total===null||item.total===undefined);
      return `<article class="finance-card" data-billing-order="${esc(order.number)}" data-search="${esc((order.number+' '+(order.client||'')).toLocaleLowerCase('pt-BR'))}"><header><div><span class="eyebrow">${esc(order.number)} · ${esc(order.service)}</span><h2>${esc(order.client||'Cliente não informado')}</h2><p>${delivered}/${order.items.length} OPs entregues · ${esc(order.unit||'')}</p></div><div class="finance-total"><span class="state-chip">${status}</span><strong>${missing?'Valor pendente':money(billed(order))}</strong></div></header><details><summary>Conferir artes e valores</summary><div class="history-scroll"><table class="art-table"><thead><tr><th>Arte / OP</th><th>Quantidade</th><th>Preço unitário</th><th>Subtotal</th><th>Entrega</th></tr></thead><tbody>${order.items.map(item=>`<tr><td>${esc(item.art)}<small>${esc(item.test_op||'Sem OP')}</small></td><td>${fmt(item.quantity)} ${esc(item.unit)}</td><td>${money(item.price)}</td><td>${money(item.total)}</td><td>${item.test_flow?.delivered?'Entregue':'Pendente'}</td></tr>`).join('')}</tbody></table></div></details>${order.items.map(item=>replenishmentSummary(item)).join('')}${status==='Em conferência'?`<p class="card-warning">${missing?'Há preço ou quantidade faturável pendente. ':''}${delivered<order.items.length?'Aguardando entrega de todas as OPs.':''}</p>`:''}${['A faturar','Faturado'].includes(status)?`<form class="finance-form"><label>${status==='A faturar'?'Referência do faturamento de teste':'Referência do recebimento de teste'}<input name="reference" required maxlength="120" placeholder="Identificação para conferência"></label><button type="submit" class="primary" data-billing="${status==='A faturar'?'invoiced':'paid'}">${status==='A faturar'?'Registrar faturamento':'Confirmar recebimento'}</button></form>`:''}<p class="card-feedback error" role="alert"></p>${history.length?`<div class="finance-history">${history.map(event=>`<p><strong>${event.action==='paid'?'Recebimento':'Faturamento'} · ${money(event.amount)}</strong><br>${esc(event.reference)} · ${esc(event.actor)} · ${esc(timestamp(event.created_at))}</p>`).join('')}</div>`:''}</article>`;
    }).join('')||'<div class="card empty">Nenhum pedido cadastrado.</div>'}</div>`;
  $('#refresh-finance').onclick=()=>showSector('financeiro');
  $('#finance-search').oninput=()=>{const query=$('#finance-search').value.toLocaleLowerCase('pt-BR').trim();document.querySelectorAll('[data-billing-order]').forEach(card=>card.hidden=!card.dataset.search.includes(query));};
  $('#workspace').onsubmit=async event=>{
    const form=event.target.closest('.finance-form');if(!form)return;event.preventDefault();
    const card=form.closest('[data-billing-order]'),button=form.querySelector('[data-billing]');button.disabled=true;
    try{await post('/pedidos/api/test/billing',{number:card.dataset.billingOrder,action:button.dataset.billing,reference:form.querySelector('[name=reference]').value});if(current==='financeiro')await showSector('financeiro');}
    catch(error){card.querySelector('.card-feedback').textContent=error.message;button.disabled=false;}
  };
}
