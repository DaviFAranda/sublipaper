export function createProduction(ctx){
const {$,esc,fmt,date,heading,post,showSector,sectorInfo,digitalMachines,paperWidths,calandras,nextSector}=ctx;
const measuredActions={digital:'printed',calandra:'calandra_done',corte:'cut_done',revisao:'review_done'};
const unitName=unit=>unit==='pc'?'peças':unit==='kg'?'kg':'cm';
const unitValue=(value,unit)=>fmt(Number(value)*(unit==='m'?100:1));
function productionPlanning(order){
  if(order.items.some(i=>i.test_op))return '';
  return `<details class="production-planning"><summary>Unidades e meta de produção</summary><p>Comprimento em cm e peças são informados separadamente. Não há conversão automática. Para metro corrido, a meta acompanha o pedido.</p>${order.items.map(item=>{const plan=item.production_plan||{};return `<form data-production-plan data-number="${esc(order.number)}" data-item="${item.id}"><strong>${esc(item.art)}</strong><label>Medir o produto final em<select name="final_unit"><option value="m">Comprimento (cm)</option><option value="pc" ${(plan.final_unit||order.unit)==='pc'?'selected':''}>Peças</option></select></label><label>Quantidade final necessária<input name="final_qty" data-final-unit data-input-unit="${plan.final_unit||order.unit}" type="number" min="${(plan.final_unit||order.unit)==="pc"?1:0.1}" step="${(plan.final_unit||order.unit)==="pc"?1:0.1}" required value="${order.unit==='kg'&&!item.production_configured?'':esc(Number(plan.final_qty||item.quantity)*(plan.final_unit==='pc'||order.unit==='pc'?1:100))}"></label><label>Comprimento para imprimir / preparar (cm)<input name="print_cm" type="number" min="0.1" step="0.1" required value="${['pc','kg'].includes(order.unit)&&!item.production_configured?'':esc(Number(plan.print_m||item.quantity)*100)}"></label><button type="submit" class="secondary">Salvar unidades</button><p class="card-feedback error" role="alert"></p></form>`;}).join('')}</details>`;
}
function referencePlanning(order){
 const fields=[['ft_id','Ficha técnica (FT)'],['sku_id','SKU do produto'],['route_id','Código do roteiro'],['prep_id','Código da preparação'],['color','Cor'],['lot_id','Lote do material']];
 return `<details class="production-planning"><summary>Referências para as planilhas (opcional)</summary><p>Preencha os códigos existentes nas planilhas antes de liberar. Estes campos não bloqueiam a operação quando estiverem em branco.</p>${order.items.map(item=>item.test_op?`<p>${esc(item.art)} · referências preservadas após liberação.</p>`:`<form data-reference-plan data-number="${esc(order.number)}" data-item="${item.id}"><strong>${esc(item.art)}</strong>${fields.map(([key,label])=>`<label>${label}<input name="${key}" maxlength="120" value="${esc(item.production_references?.[key]||'')}"></label>`).join('')}<button class="secondary" type="submit">Salvar referências</button><p class="card-feedback error" role="alert"></p></form>`).join('')}</details>`;
}
function measurementInputs(role,item){
  const f=item.test_flow||{},needed={digital:f.printing&&!f.printed,calandra:f.calandra_running&&!f.calandra_done,corte:f.cutting&&!f.cut_done,revisao:!f.review_done}[role];
  if(!needed)return '';
  const spec=item.measurement_spec||{unit:item.unit,expected:item.quantity};
  return `<fieldset class="measurement-fields" data-measurement data-expected="${esc(Number(spec.expected)*(spec.unit==='m'?100:1))}" data-unit="${esc(spec.unit)}"><legend>Quantidade de saída · ${unitName(spec.unit)}</legend><p>Meta desta etapa: <strong>${unitValue(spec.expected,spec.unit)} ${unitName(spec.unit)}</strong>${spec.available!==null&&spec.available!==undefined?` · disponível: ${unitValue(spec.available,spec.unit)} ${unitName(spec.unit)}`:''}</p><input type="hidden" name="measurement_unit" value="${esc(spec.unit)}"><label>Quantidade que saiu desta etapa<input name="${spec.unit==='m'?'output_cm':'output'}" type="number" min="0" max="${esc(Number(spec.available??100000000)*(spec.unit==='m'?100:1))}" step="${spec.unit==='pc'?'1':'0.1'}" required placeholder="Informe a saída em ${unitName(spec.unit)}"></label><label>Perda / rejeição (${unitName(spec.unit)})<input name="${spec.unit==='m'?'loss_cm':'loss'}" type="number" min="0" step="${spec.unit==='pc'?'1':'0.1'}" value="0"></label><div class="measurement-result" aria-live="polite">Informe a saída para comparar com a meta.</div><label>Motivo da perda / falta (se houver)<textarea name="reason" maxlength="500" rows="2" placeholder="Ex.: perda na máquina ou peça rejeitada"></textarea></label></fieldset>`;
}
function measurementHistory(role,order,item){
  const action=measuredActions[role],record=(item.measurements||[]).find(m=>m.action===action),issue=item.quantity_issue;
  if(!record)return '';
  let html=`<div class="measurement-receipt"><strong>Saída registrada: ${unitValue(record.good,record.unit)} ${unitName(record.unit)}</strong>${Number(record.loss)>0?`<p>Perda registrada: ${unitValue(record.loss,record.unit)} ${unitName(record.unit)}</p>`:''}${record.reason?`<small>${esc(record.reason)}</small>`:''}</div>`;
  if(Number(issue?.missing)>0)html+=`<div class="quantity-shortage"><strong>Faltam ${unitValue(issue.missing,issue.unit)} ${unitName(issue.unit)} nesta etapa</strong>${issue.requested?'<p>Pedido de Reposição registrado. O novo trabalho foi enviado à rota de produção.</p>':issue.can_request?`<details><summary>Pedido de Reposição</summary><form data-replenishment data-source-action="${action}"><p>Opcional. Informe quanto deseja repor; o trabalho seguirá separado pela rota deste serviço.</p><label>Quantidade para repor (${unitName(issue.unit)})<input name="${issue.unit==='m'?'requested_cm':'requested_qty'}" type="number" min="${issue.unit==='pc'?'1':'0.1'}" max="${esc(Number(item.measurement_spec?.expected??100000000)*(issue.unit==='m'?100:1))}" step="${issue.unit==='pc'?'1':'0.1'}" required value="${esc(Number(issue.missing)*(issue.unit==='m'?100:1))}"></label>${issue.unit==='pc'?'<label>Comprimento para imprimir essa quantidade (cm)<input name="print_cm" type="number" min="0.1" max="100000000" step="0.1" required placeholder="Comprimento em cm, conforme a grade"></label>':''}${issue.unit==='m'&&item.production_plan?.final_unit==='pc'?'<label>Peças que essa reposição deve produzir<input name="final_qty" data-final-unit type="number" min="1" max="100000000" step="1" required placeholder="Sem conversão automática"></label>':''}${item.sewing_requirement?.enabled&&item.production_plan?.final_unit!=='pc'?`<label>Peças que a Costura deverá montar<input name="sewing_pieces" type="number" min="1" max="${esc(item.sewing_requirement.pieces_remaining)}" step="1" required placeholder="Informe as peças, sem converter metros"></label>`:''}<button class="secondary" type="submit">Solicitar reposição</button></form></details>`:'<p>A quantidade faltante permanece visível para acompanhamento nesta etapa.</p>'}</div>`;
  return html;
}
function replenishmentSummary(item){
  const summary=item.replenishment;
  const hasShortage=(item.measurements||[]).some(m=>Number(m.good)<Number(m.expected));
  if(!summary||(!summary.batches.length&&!hasShortage))return '';
  const names={printing:'Digital em execução',printed:'Impressão concluída',calandra_running:'Calandra em execução',calandra_done:'Transferência concluída',cutting:'Corte em execução',cut_done:'Corte concluído',sewing:'Costura em execução',sewn:'Costura concluída',review_done:'Conferido'};
  const stage=lot=>lot.complete?'Conferido':Object.keys(names).reverse().find(k=>lot.actions.includes(k));
  return `<details class="replenishment-summary" ${summary.batches.length?'open':''}><summary>${summary.batches.length?'Reposições':'Conferência'} · ${esc(item.art)} · ${summary.batches.length} trabalho(s)</summary><p><strong>${unitValue(summary.approved,summary.unit)} / ${unitValue(summary.target,summary.unit)} ${unitName(summary.unit)} aprovados</strong>${Number(summary.missing)>0?` · faltam ${unitValue(summary.missing,summary.unit)} ${unitName(summary.unit)}`:''}</p>${summary.batches.map(lot=>`<div class="replenishment-line"><strong>${esc(lot.work)} · ${unitValue(lot.quantity,lot.unit)} ${unitName(lot.unit)}</strong><span>${esc(lot.complete?'Conferido':names[stage(lot)]||'Na fila de produção')} · ${unitValue(lot.print_m,"m")} cm de impressão</span><small>${esc(lot.source)} · ${esc(lot.reason)}</small></div>`).join('')}${!summary.ready?'<small>A entrega aguarda quantidade suficiente e conferência de todos os trabalhos.</small>':'<small>Quantidade completa para entrega. A reposição não acrescenta cobrança automaticamente.</small>'}</details>`;
}
function bindMeasurementInputs(){
  $('#workspace').oninput=event=>{
    const fieldset=event.target.closest('[data-measurement]');if(!fieldset)return;
    const raw=fieldset.querySelector('[name=output],[name=output_cm]').value,output=Number(raw),missing=Math.max(0,Number(fieldset.dataset.expected)-output);
    fieldset.querySelector('.measurement-result').textContent=raw===''?'Informe a saída para comparar com a meta.':`Saída: ${fmt(output)} ${unitName(fieldset.dataset.unit)} · falta nesta etapa: ${fmt(missing)} ${unitName(fieldset.dataset.unit)}`;
  };
}

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
  $('#workspace').onchange=event=>{if(event.target.name==='final_unit'){const input=event.target.form.querySelector('[name=final_qty]');input.value='';input.step=event.target.value==='pc'?'1':'0.1';input.min=input.step;}};
  $('#workspace').onsubmit=async event=>{
    const form=event.target.closest('[data-sewing-form],[data-production-plan],[data-reference-plan]');if(!form)return;event.preventDefault();
    const values=Object.fromEntries(new FormData(form)),button=form.querySelector('button');if(form.hasAttribute('data-production-plan')&&values.final_unit==='m'){values.final_cm=values.final_qty;delete values.final_qty;}button.disabled=true;
    try{await post('/pedidos/api/production/configure',{...values,kind:form.hasAttribute('data-production-plan')?'production':form.hasAttribute('data-reference-plan')?'references':'sewing',number:form.dataset.number,item_id:Number(form.dataset.item),enabled:values.enabled==='true'});if(ctx.current()==='pcp')await showSector('pcp');}
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
  return `<label>${label}<select name="${name}" required ${locked?'disabled':''}><option value="">Selecione</option>${options.map(option=>`<option value="${esc(option)}" ${value===option?'selected':''}>${esc(name==='reference'&&option==='1,60 m'?'160 cm':name==='reference'&&option==='1,80 m'?'180 cm':option)}</option>`).join('')}</select></label>`;
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
  if(role==='costura'&&!f.sewn)html=f.sewing?`<label>Peças concluídas<input name="pieces" type="number" min="0" max="${Number(plan.pieces)}" step="1" required placeholder="${Number(plan.pieces)} peças previstas"></label>`+button('sewn','Concluir Costura'):button('sewing','Iniciar Costura');
  if(role==='revisao'&&!f.review_done)html=button('review_done','Aprovar na Revisão');
  if(role==='expedicao'&&!f.delivered)html=f.packed?'<label>Quem recebeu<input name="machine" required maxlength="120" autocomplete="off" placeholder="Nome do recebedor"></label>'+button('delivered','Confirmar entrega'):'<label>Identificação do volume<input name="reference" required maxlength="120" placeholder="Ex.: Volume 01 / OP"></label>'+operationSelect('machine','Forma de saída',['Retirada','Entrega'])+'<label>Destino / retirada<input name="destination" maxlength="300" placeholder="Endereço ou local combinado"></label>'+button('packed','Preparar volume');
  return html?`<form class="board-actions" data-stage-form>${measurementInputs(role,item)}${html}${['printed','calandra_done','sewn','review_done','delivered'].some(a=>html.includes('data-transition="'+a+'"'))?consumptionInputs():''}</form>`:'';
}
function consumptionInputs(){return `<details class="consumption-fields"><summary>Consumo adicional (opcional)</summary><p>Papel e tecido processados são registrados pela medição. Informe aqui tinta, energia, mão de obra ou outro material efetivamente usado.</p><div class="consumption-grid"><label>Material<select name="usage_material"><option value="Tinta">Tinta</option><option value="Papel">Papel (medição específica)</option><option value="Tecido">Tecido (medição específica)</option><option value="Energia">Energia</option><option value="Mão de obra">Mão de obra</option><option value="Outro">Outro</option></select></label><label>Quantidade usada<input name="usage_quantity" type="number" min="0.001" step="0.001"></label><label>Unidade<select name="usage_unit"><option>ml</option><option>kWh</option><option>min</option><option>kg</option><option>m2</option><option>cm</option><option>un</option></select></label><label>Lote / código<input name="usage_lot" maxlength="120"></label><label>Custo por unidade, se conhecido<input name="usage_unit_cost" type="number" min="0" step="0.001"></label><label>Referência / material<input name="usage_reference" maxlength="200"></label></div></details>`;}
function operationCard(role,order,item){
  const f=item.test_flow||{},col=boardColumn(role,item),plan=item.sewing_plan||{},dispatch=item.dispatch||{};
  const canAct=ctx.user().role===role||ctx.user().role==='gestao';
  const identity=role==='estoque'?`<div class="owner-panel"><small>CLIENTE DO PEDIDO</small><strong>${esc(order.client||'Não informado')}</strong><small>PROPRIETÁRIO DO TECIDO</small><strong class="${item.fabric_owner?'':'pending-text'}">${esc(item.fabric_owner||'A confirmar')}</strong>${!item.owner_confirmed&&canAct?`<form data-owner-form><label>Confirme o nome do proprietário<input name="owner" maxlength="120" required value="${esc(item.fabric_owner||order.client||'')}" placeholder="Cliente, Sublipaper ou terceiro"></label><button class="secondary" type="submit">Confirmar proprietário</button></form>`:''}</div>`:role==='expedicao'?`<div class="owner-panel"><small>CLIENTE / DESTINATÁRIO</small><strong>${esc(order.client||'Não informado')}</strong></div>`:'';
  const specs=[['Meta do pedido',`${unitValue(item.production_plan?.final_qty??item.quantity,item.production_plan?.final_unit??item.unit)} ${unitName(item.production_plan?.final_unit??item.unit)}`],['Quantidade desta etapa',`${unitValue(item.measurement_spec?.expected??item.quantity,item.measurement_spec?.unit??item.unit)} ${unitName(item.measurement_spec?.unit??item.unit)}`],f.needs_fabric?['Tecido',item.fabric||order.fabric||'Não informado']:['Material','Papel impresso']];
  if(!['digital','calandra'].includes(role)&&item.production_plan?.final_unit==='pc')specs.push(['Metragem planejada do pedido',`${fmt(Number(item.production_plan.print_m)*100)} cm`]);
  if(role==='digital'&&!f.needs_fabric&&(item.fabric||order.fabric))specs.push(['Tecido de destino',item.fabric||order.fabric]);
  if(item.width_m||order.width_m)specs.push(['Largura',`${fmt(Number(item.width_m||order.width_m)*100)} cm`]);
  
  
  if(role==='digital'&&f.digital_machine)specs.push(['Impressora',f.digital_machine],['Papel',f.paper_width==='1,80 m'?'180 cm':'160 cm']);
  if(role==='calandra'&&f.calandra_machine)specs.push(['Equipamento',f.calandra_machine]);
  if(plan.enabled&&['costura','revisao','expedicao'].includes(role))specs.push(['Peças previstas',`${plan.pieces} peças`]);
  if(plan.completed_pieces&&['costura','revisao'].includes(role))specs.push(['Montadas neste trabalho',`${plan.completed_pieces} peças`]);
  if(role==='preparacao')specs.push(['Proprietário',item.fabric_owner||'Não confirmado no Estoque']);
  if(specs[0][1]===specs[1][1])specs.splice(1,1);
  const sewing=role==='costura'?`<div class="work-instructions"><small>INSTRUÇÕES DE MONTAGEM</small><p>${esc(plan.instructions||'PCP ainda não informou as instruções.')}</p><small>A quantidade em peças é informada pelo PCP; não é uma conversão automática da metragem.</small></div>`:'';
  const packing=role==='expedicao'&&f.packed?`<div class="work-instructions"><strong>${esc(dispatch.volume||'Volume legado')}</strong><p>${esc(dispatch.method||'Saída não informada')} ${dispatch.destination?'· '+esc(dispatch.destination):''}</p>${f.delivered?`<p>Recebido por <strong>${esc(dispatch.recipient)}</strong><br>${esc(timestamp(dispatch.delivered_at))}</p>`:''}</div>`:'';
  const history=(item.stage_history||[]).length?`<details class="operation-history"><summary>Histórico desta etapa</summary>${item.stage_history.map(event=>`<p><strong>${esc(operationActionNames[event.action]||event.action)}</strong><br>${esc(event.actor)} · ${esc(timestamp(event.created_at))}</p>`).join('')}</details>`:'';
  const state=operationViews[role].labels[col];
  return `<article class="production-card state-${col}" data-number="${esc(order.number)}" data-batch="${esc(order.batch_token||'')}" data-item="${item.id}" data-column="${col}" data-search="${esc([order.number,order.client,item.art,item.fabric,order.fabric,item.fabric_owner,item.test_op].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR'))}"><div class="card-topline"><span class="eyebrow">${esc(item.test_op)}</span><span class="state-chip state-${col}">${esc(state)}</span></div><div class="production-card-main ${role==='estoque'?'without-art':''}">${role==='estoque'?'':artThumbnail(item)}<div><h3>${esc(order.number)}</h3><strong class="art-name">${esc(item.art)}</strong>${order.delivery?`<p class="due-date">Prazo do pedido · ${esc(date(order.delivery))}</p>`:''}</div></div>${identity}<dl class="operation-specs">${specs.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${sewing}${packing}${measurementHistory(role,order,item)}${['revisao','expedicao'].includes(role)?replenishmentSummary(item):''}<p class="next-sector">${role==='expedicao'?(f.delivered?'Entrega registrada':'Destino: cliente / recebedor'):`Próximo: <strong>${esc(nextSector(role,item))}</strong>`}</p>${canAct?boardActions(role,order,item):''}${canAct&&col===2&&['digital','calandra','costura','revisao','expedicao'].includes(role)?`<form data-consumption-form data-action="${({digital:'printed',calandra:'calandra_done',costura:'sewn',revisao:'review_done',expedicao:'delivered'})[role]}">${consumptionInputs().replace('Consumo adicional (opcional)','Registrar consumo complementar').replace('Papel e tecido processados são registrados pela medição. Informe aqui tinta, energia, mão de obra ou outro material efetivamente usado.','Registre somente consumo medido que ainda não foi registrado, por exemplo papel ou tecido extra de uma reimpressão. Não repita o consumo já calculado nas etapas.')}<button class="secondary consumption-submit" type="submit">Salvar consumo complementar</button></form>`:''}<p class="card-feedback error" role="alert"></p>${history}</article>`;
}
function renderBoard(role){
 const orders=ctx.orders();
  const view=operationViews[role];
  const cards=orders.flatMap(order=>order.items.filter(item=>boardEligible(role,item)).map(item=>({order,item})));
  const columns=view.labels.map((label,index)=>({label,index})).filter(column=>column.label);
  const preferences=boardPreferences[role]||{query:'',state:'active'};
  $('#workspace').innerHTML=heading(sectorInfo[role].name,view.description,'OPERAÇÃO')+
    `<div class="sector-summary">${columns.map(({label,index})=>`<div class="summary-item state-${index}"><span>${esc(label)}</span><strong>${cards.filter(({item})=>boardColumn(role,item)===index).length}</strong><small>OPs nesta etapa</small></div>`).join('')}</div>`+
    `<div class="board-toolbar"><label>Buscar nesta fila<input id="board-search" type="search" value="${esc(preferences.query)}" placeholder="Pedido, arte, tecido${['estoque','expedicao'].includes(role)?' ou cliente':''}"></label><label>Exibir<select id="board-state"><option value="all">Todas as OPs</option><option value="active" ${preferences.state==='active'?'selected':''}>Somente pendentes</option><option value="done" ${preferences.state==='done'?'selected':''}>Somente concluídas</option></select></label><button class="secondary" id="refresh-board" type="button">Atualizar fila ↻</button></div><p class="operational-note">Medições de saída conferidas por trabalho. ${role==='costura'?'Inclua a etapa e as peças previstas pela aba PCP. ':''}Registre a saída boa e as perdas. O próximo setor é liberado conforme a rota desta OP.</p><p id="board-feedback" class="error" role="alert"></p>`+
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
    const usage=event.target.closest('[data-consumption-form]');if(usage){event.preventDefault();const card=usage.closest('[data-item]'),button=usage.querySelector('button');button.disabled=true;try{await post('/pedidos/api/production/consumption',{...Object.fromEntries(new FormData(usage)),number:card.dataset.number,batch_token:card.dataset.batch,item_id:Number(card.dataset.item),action:usage.dataset.action});if(ctx.current()===role)await showSector(role);}catch(error){card.querySelector('.card-feedback').textContent=error.message;button.disabled=false;}return;}
    const replacement=event.target.closest('[data-replenishment]');
    if(replacement){event.preventDefault();const card=replacement.closest('[data-item]'),button=replacement.querySelector('button');button.disabled=true;try{await post('/pedidos/api/production/replenishment',{...Object.fromEntries(new FormData(replacement)),number:card.dataset.number,batch_token:card.dataset.batch,item_id:Number(card.dataset.item),source_action:replacement.dataset.sourceAction});if(ctx.current()===role)await showSector(role);}catch(error){card.querySelector('.card-feedback').textContent=error.message;button.disabled=false;}return;}
    const form=event.target.closest('[data-owner-form]');if(!form)return;event.preventDefault();
    const card=form.closest('[data-item]'),button=form.querySelector('button');button.disabled=true;
    try{await post('/pedidos/api/production/configure',{number:card.dataset.number,batch_token:card.dataset.batch,item_id:Number(card.dataset.item),kind:'owner',owner:form.querySelector('[name=owner]').value});if(ctx.current()===role)await showSector(role);}
    catch(error){card.querySelector('.card-feedback').textContent=error.message;button.disabled=false;}
  };
  $('#workspace').onclick=async event=>{
    const previewButton=event.target.closest('[data-preview]');
    if(previewButton){$('#art-dialog-title').textContent=previewButton.dataset.art;$('#art-dialog-image').src=previewButton.dataset.preview;$('#art-dialog').showModal();return;}
    const target=event.target.closest('[data-transition]');if(!target||target.disabled)return;
    const card=target.closest('[data-item]'),form=target.closest('form');if(!form.reportValidity())return;
    const values=Object.fromEntries([...form.querySelectorAll('[name]')].map(field=>[field.name,field.value]));
    const controls=[...card.querySelectorAll('button')].map(button=>({button,disabled:button.disabled}));controls.forEach(({button})=>button.disabled=true);
    try{await post('/pedidos/api/production/transition',{...values,number:card.dataset.number,batch_token:card.dataset.batch,item_id:Number(card.dataset.item),action:target.dataset.transition});if(ctx.current()===role)await showSector(role);}
    catch(error){card.querySelector('.card-feedback').textContent=error.message;controls.forEach(({button,disabled})=>button.disabled=disabled);}
  };
}


function renderPcp(){
 const orders=ctx.orders();
  const pending=orders.filter(order=>!order.items.some(item=>item.test_op));
  const released=orders.filter(order=>order.items.some(item=>item.test_op));
  const card=order=>{
    const missing=[];
    if(!order.items.length)missing.push('Adicione ao menos uma arte');
    if(!['m','pc'].includes(order.unit))missing.push('Unidade ainda não validada para produção');
    if(['pc','kg'].includes(order.unit)&&order.items.some(item=>!item.production_configured))missing.push('Informe a metragem de impressão de cada arte em Unidades e meta de produção');
    if(['Transferência digital','Venda de Papel','Corte a laser'].includes(order.service))order.items.forEach(item=>{if(!item.original_path)missing.push(`Arte ${item.art}: informe o arquivo da arte pronta`);});
    const isReleased=order.items.some(item=>item.test_op);
    return `<article class="production-card" data-number="${esc(order.number)}"><span class="eyebrow">${esc(order.number)}</span><h3>${esc(order.client||'Cliente não informado')}</h3><p>${esc(order.service||'Serviço não informado')} · ${order.items.length} arte(s) · entrega ${esc(date(order.delivery))}</p><p>${order.items.map(item=>`${esc(item.art)}: ${esc(fmt(item.quantity))} ${esc(item.unit)}${item.test_op?` · ${esc(item.test_op)}`:''}`).join('<br>')}</p>${missing.length&&!isReleased?`<p class="error">${missing.map(esc).join('<br>')}</p>`:''}${isReleased?'<span class="tag">OPs criadas</span>':`<button class="primary" data-release="${esc(order.number)}" ${missing.length?'disabled':''}>Liberar pedido e criar OPs</button>`}${productionPlanning(order)}${sewingPlanning(order)}${referencePlanning(order)}</article>`;
  };
  $('#workspace').innerHTML=heading('PCP / planejamento','Confira as artes prontas e libere o pedido para gerar uma OP por arte.','PLANEJAMENTO')+
    `<div class="metric-grid"><div class="metric"><span>Aguardando PCP</span><strong>${pending.length}</strong></div><div class="metric"><span>Liberados</span><strong>${released.length}</strong></div><div class="metric"><span>OPs criadas</span><strong>${released.reduce((sum,order)=>sum+order.items.filter(item=>item.test_op).length,0)}</strong></div></div>`+
    '<button id="refresh-pcp" type="button">Atualizar fila</button><p id="pcp-feedback" class="error" role="alert"></p>'+
    `<div class="production-board two-columns"><section class="board-column"><h2>Aguardando liberação <span>${pending.length}</span></h2>${pending.map(card).join('')||'<p class="muted">Nenhum pedido pendente.</p>'}</section><section class="board-column"><h2>OPs criadas <span>${released.length}</span></h2>${released.map(card).join('')||'<p class="muted">Nenhuma OP criada.</p>'}</section></div>`;
  $('#refresh-pcp').onclick=()=>showSector('pcp');
  bindSewingPlanning();
  $('#workspace').onclick=async event=>{const button=event.target.closest('[data-release]');if(!button||button.disabled)return;button.disabled=true;try{await post('/pedidos/api/production/release',{number:button.dataset.release});if(ctx.current()==='pcp')await showSector('pcp');}catch(error){if(ctx.current()==='pcp'){$('#pcp-feedback').textContent=error.message;button.disabled=false;}}};
}

return {renderBoard,renderPcp,artThumbnail,replenishmentSummary,unitName,unitValue,operationActionNames,timestamp};
}
