import {mount as mountOrders} from './commercial.mjs';
import {mount as mountLaser} from './laser.mjs';
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
    try{await post('/pedidos/api/production/configure',{...values,kind:form.hasAttribute('data-production-plan')?'production':form.hasAttribute('data-reference-plan')?'references':'sewing',number:form.dataset.number,item_id:Number(form.dataset.item),enabled:values.enabled==='true'});if(current==='pcp')await showSector('pcp');}
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
  const canAct=user.role===role||user.role==='gestao';
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
    const usage=event.target.closest('[data-consumption-form]');if(usage){event.preventDefault();const card=usage.closest('[data-item]'),button=usage.querySelector('button');button.disabled=true;try{await post('/pedidos/api/production/consumption',{...Object.fromEntries(new FormData(usage)),number:card.dataset.number,batch_token:card.dataset.batch,item_id:Number(card.dataset.item),action:usage.dataset.action});if(current===role)await showSector(role);}catch(error){card.querySelector('.card-feedback').textContent=error.message;button.disabled=false;}return;}
    const replacement=event.target.closest('[data-replenishment]');
    if(replacement){event.preventDefault();const card=replacement.closest('[data-item]'),button=replacement.querySelector('button');button.disabled=true;try{await post('/pedidos/api/production/replenishment',{...Object.fromEntries(new FormData(replacement)),number:card.dataset.number,batch_token:card.dataset.batch,item_id:Number(card.dataset.item),source_action:replacement.dataset.sourceAction});if(current===role)await showSector(role);}catch(error){card.querySelector('.card-feedback').textContent=error.message;button.disabled=false;}return;}
    const form=event.target.closest('[data-owner-form]');if(!form)return;event.preventDefault();
    const card=form.closest('[data-item]'),button=form.querySelector('button');button.disabled=true;
    try{await post('/pedidos/api/production/configure',{number:card.dataset.number,batch_token:card.dataset.batch,item_id:Number(card.dataset.item),kind:'owner',owner:form.querySelector('[name=owner]').value});if(current===role)await showSector(role);}
    catch(error){card.querySelector('.card-feedback').textContent=error.message;button.disabled=false;}
  };
  $('#workspace').onclick=async event=>{
    const previewButton=event.target.closest('[data-preview]');
    if(previewButton){$('#art-dialog-title').textContent=previewButton.dataset.art;$('#art-dialog-image').src=previewButton.dataset.preview;$('#art-dialog').showModal();return;}
    const target=event.target.closest('[data-transition]');if(!target||target.disabled)return;
    const card=target.closest('[data-item]'),form=target.closest('form');if(!form.reportValidity())return;
    const values=Object.fromEntries([...form.querySelectorAll('[name]')].map(field=>[field.name,field.value]));
    const controls=[...card.querySelectorAll('button')].map(button=>({button,disabled:button.disabled}));controls.forEach(({button})=>button.disabled=true);
    try{await post('/pedidos/api/production/transition',{...values,number:card.dataset.number,batch_token:card.dataset.batch,item_id:Number(card.dataset.item),action:target.dataset.transition});if(current===role)await showSector(role);}
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
    try{await post('/pedidos/api/production/billing',{number:card.dataset.billingOrder,action:button.dataset.billing,reference:form.querySelector('[name=reference]').value});if(current==='financeiro')await showSector('financeiro');}
    catch(error){card.querySelector('.card-feedback').textContent=error.message;button.disabled=false;}
  };
}

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
  if(!f){const l=item.laser_progress;return l?[{id:'corte',name:overviewNames.corte,state:l.status==='complete'?'done':l.status==='partial'?'running':l.status==='ready'?'ready':'blocked'}]:[];}
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
  if(item.laser_progress&&released&&f.calandra_done){const l=item.laser_progress;const cut=stages.find(s=>s.id==='corte');if(cut)cut.state=l.status==='complete'?'done':l.status==='partial'?'running':l.status==='ready'?'ready':'blocked';}
  return stages;
}
function overviewState(item){
  const stages=overviewStages(item),f=item.test_flow||{};
  const running=stages.filter(s=>s.state==='running');
  for(const lot of item.replenishment?.batches||[])for(const id of lot.running||[])if(!running.some(s=>s.id===id))running.push({id,name:overviewNames[id]+' · reposição',state:'running',replacement:true});
  const ready=stages.filter(s=>s.state==='ready');
  for(const lot of item.replenishment?.batches||[])for(const id of lot.waiting||[])if(!ready.some(s=>s.id===id)&&!running.some(s=>s.id===id))ready.push({id,name:overviewNames[id]+' · reposição',state:'ready',replacement:true});
  return {stages,running,ready,done:!!f.delivered,pcp:!!item.test_flow&&!item.test_op,
    label:!item.test_flow?(item.laser_progress?({draft:'Grades em preparação',ready:'Corte na fila',partial:'Corte parcial',complete:'Corte concluído'}[item.laser_progress.status]):'Sem apontamentos'):f.delivered?'Entregue':!item.test_op?'Aguardando PCP':f.packed?'Pronto para entrega':running.length?running.map(s=>s.name+' em execução').join(' · '):ready.length?ready.map(s=>s.name).join(' + '):'Aguardando próxima etapa'};
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
  $('#workspace').innerHTML=`<div class="ov-dashboard">${heading('Visão geral','Acompanhe as artes, identifique pendências e veja o próximo passo de cada pedido.','ACOMPANHAMENTO')}<div class="ov-update"><span>${testMode?'Ambiente de testes · confirmações simuladas':'Pedidos e etapas atualizados pelos apontamentos da fábrica'} · atualizado às ${overviewUpdated}</span><button class="secondary" id="ov-refresh" type="button">Atualizar dados ↻</button></div><div class="ov-quick-actions"><button class="primary" data-ov-open="pedidos" type="button">Cadastrar / consultar pedido</button><button class="secondary" data-ov-open="pcp" type="button">Preparar a produção →</button><button class="secondary" data-ov-open="corte" type="button">Grades e romaneios do Laser →</button></div><div class="ov-metrics">${metrics.map(([status,label,count,hint])=>`<button type="button" class="ov-metric ${status==='late'?'attention':''}" data-ov-status="${status}" aria-pressed="${overviewFilters.status===status}"><span>${label}</span><strong>${count}</strong><small>${hint}</small></button>`).join('')}</div><section class="ov-section"><div class="ov-section-head"><div><h2>Onde estão as artes</h2><p>Clique em um setor para ver sua fila e o que está em execução.</p></div></div><div class="ov-sectors">${Object.entries(overviewNames).map(([id,name])=>{const count=all.filter(e=>[...e.state.ready,...e.state.running].some(s=>s.id===id)).length;return `<button type="button" data-ov-sector="${id}" aria-pressed="${overviewFilters.sector===id}"><span>${name}</span><strong>${count}</strong></button>`;}).join('')}</div><p class="ov-hint">Uma arte pode aparecer em Estoque e Digital ao mesmo tempo. Os números acima consideram todos os pedidos carregados.</p></section><section class="ov-section"><div class="ov-section-head"><div><h2>Pedidos e artes</h2><p>Pesquise, filtre e abra os detalhes sem perder o acompanhamento.</p></div><div class="ov-view-toggle" aria-label="Forma de visualização"><button data-ov-view="orders" type="button" aria-pressed="${overviewFilters.view==='orders'}">Por pedido</button><button data-ov-view="arts" type="button" aria-pressed="${overviewFilters.view==='arts'}">Galeria de artes</button></div></div><div class="ov-filters"><label class="ov-search">Buscar<input id="ov-search" type="search" value="${esc(overviewFilters.query)}" placeholder="Cliente, pedido, arte, OP ou tecido"></label><label>Situação<select id="ov-status">${[['active','Em aberto'],['all','Todas'],['running','Em execução'],['pcp','Aguardando PCP'],['late','Prazo vencido'],['done','Entregues']].map(([id,label])=>`<option value="${id}" ${overviewFilters.status===id?'selected':''}>${label}</option>`).join('')}</select></label><label>Serviço<select id="ov-service"><option value="all">Todos os serviços</option>${[...new Set(overviewRows.map(o=>o.service).filter(Boolean))].sort().map(s=>`<option ${overviewFilters.service===s?'selected':''}>${esc(s)}</option>`).join('')}</select></label><label>Ordenar<select id="ov-sort"><option value="due">Entrega mais próxima</option><option value="recent" ${overviewFilters.sort==='recent'?'selected':''}>Cadastro mais recente</option></select></label></div><div class="ov-results-heading"><span id="ov-results-count" role="status" aria-live="polite"></span><button id="ov-clear" type="button" class="ov-detail-button">Limpar filtros</button></div><div id="ov-results"></div></section><details class="ov-data-export"><summary>Dados operacionais para as planilhas</summary><p>Baixe os registros para conferência. As planilhas mantêm seus cálculos e preços.</p><div>${[["pedidos","Pedidos"],["consumos","Consumos e preços pendentes"],["etapas","Histórico de etapas"],["medicoes","Saídas boas e perdas"],["entregas","Entregas"],["grades","Grades e metragens"],["reimpressoes","Reimpressões"],["romaneios","Romaneios"]].map(([key,label])=>`<a href="/api/integration/planilhas/${key}.csv">${label} ↓</a>`).join("")}</div></details><dialog id="ov-art-dialog" class="art-dialog"><button type="button" class="secondary" id="ov-close-art">Fechar ×</button><h2 id="ov-art-title"></h2><img id="ov-art-image" alt="Arte ampliada"></dialog><dialog id="ov-detail-dialog" class="ov-dialog"><div id="ov-detail-content"></div></dialog></div>`;
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
  financeiro: {name:'Financeiro / faturamento',icon:'¤',see:'Cliente, pedido, serviços, preço e quantidade faturável',write:'Valor final e situação do faturamento'},
  pcp: {name:'PCP / planejamento',icon:'▤',see:'Pedidos, artes, quantidades, tecido, serviço, prazo e OPs',write:'Liberação do pedido, criação de OPs e prioridade'},
};
const fieldNames={client:'Cliente',service:'Serviço',fabric:'Tecido',width_m:'Largura (m)',unit:'Unidade',unit_price:'Preço por unidade',delivery:'Entrega prometida',nf:'NF',notes:'Observações',total:'Total',art:'Arte',quantity:'Quantidade',price:'Preço por arte',billing_meters:'Metros para cobrança',asset_id:'Referência da arte',original_name:'Arquivo original',original_path:'Arquivo / referência da arte'};
let user=null, setup=false, preview=false, testMode=false, workflowEnabled=false, current='overview', selected=0, orders=[], pageRequest=0;

async function api(path, options={}) {
  const response=await fetch(path,{credentials:'same-origin',...options});
  let result;
  try{result=await response.json();}catch{result={error:'Resposta inválida do servidor'};}
  if(!response.ok)throw Error(result.error || 'Não foi possível concluir a operação');
  return result;
}
const pendingPosts=new Map();
async function post(path,data){const operator=localStorage.getItem('sublipaper-operator')||'';if(path.includes('/production/')&&!operator.trim())throw Error('Informe o responsável no topo da tela.');const key=path+JSON.stringify(data);let token=pendingPosts.get(key);if(!token){token=crypto.randomUUID();pendingPosts.set(key,token);}try{const result=await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,operator,request_key:token})});pendingPosts.delete(key);return result;}catch(e){throw e;}}
function pages(){
  const list=user.role==='gestao'?[['overview','Visão geral','◫']]:[];
  if(['comercial','gestao'].includes(user.role))list.push(['pedidos','Pedidos','▧']);

  if(['pcp','gestao'].includes(user.role))list.push(['pcp',sectorInfo.pcp.name,sectorInfo.pcp.icon]);
  for(const [role,info] of Object.entries(sectorInfo))if(!['comercial','pcp','financeiro'].includes(role)&&(user.role==='gestao'||user.role===role))list.push([role,info.name,info.icon]);

  return list;
}
function heading(title,subtitle,badge='OPERAÇÃO'){
  return `<div class="page-head"><div><span class="eyebrow">FLUXO DA FÁBRICA</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><span class="tag warn">${esc(badge)}</span></div>`;
}
async function navigate(page){
  if(!pages().some(item=>item[0]===page))return;
  pageRequest++;overviewRequest++;current=page;if(location.hash!=='#'+page)location.hash=page;$('.sidebar').classList.remove('open');
  window.scrollTo({top:0,behavior:'instant'});
  $('#workspace').onclick=null;$('#workspace').onsubmit=null;$('#workspace').oninput=null;$('#workspace').onchange=null;
  document.querySelectorAll('.nav-button').forEach(button=>button.classList.toggle('active',button.dataset.page===page));
  $('#breadcrumb').textContent=pages().find(item=>item[0]===page)[1];
  if(page==='pedidos')return showPedidos();
  if(page==='corte')return showLaser();

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
  const previous=orders[selected]?.number;
  $('#workspace').innerHTML=heading(info.name,'Carregando a fila deste setor.')+'<div class="card">Carregando pedidos…</div>';
  try{
    const loaded=await api('/pedidos/api/factory/orders?sector='+encodeURIComponent(role));if(current!==role||request!==pageRequest||user!==session)return;orders=loaded;
    if(workflowEnabled&&role==='pcp')return renderPcp();
    if(workflowEnabled&&role==='financeiro')return renderFinance();
    if(workflowEnabled&&['estoque','digital','preparacao','calandra','corte','costura','revisao','expedicao'].includes(role))return renderBoard(role);
    selected=Math.max(0,orders.findIndex(row=>row.number===previous));renderSector(role);
  }catch(error){if(current===role&&request===pageRequest&&user===session)$('#workspace').innerHTML=`<p class="error">${esc(error.message)}</p>`;}
}
function field(label,value){return `<div class="info-cell"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`;}
function renderPcp(){
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
  $('#workspace').onclick=async event=>{const button=event.target.closest('[data-release]');if(!button||button.disabled)return;button.disabled=true;try{await post('/pedidos/api/production/release',{number:button.dataset.release});if(current==='pcp')await showSector('pcp');}catch(error){if(current==='pcp'){$('#pcp-feedback').textContent=error.message;button.disabled=false;}}};
}
function renderSector(role){
  const info=sectorInfo[role],order=orders[selected];
  const list=orders.length?orders.map((row,index)=>`<button class="order-choice ${selected===index?'active':''}" data-index="${index}"><strong>${esc(row.number)}</strong><small>${row.items.length} arte(s) · ${esc(date(row.created_at))}</small></button>`).join(''):'<p class="empty">Nenhum pedido disponível.</p>';
  let detail='<div class="empty">Selecione um pedido para ver o romaneio do setor.</div>';
  if(order){
    const general=Object.entries(order).filter(([key])=>!['items','number','created_at','stage_status','test_status','notes','total','pending_prices'].includes(key))
      .map(([key,value])=>field(fieldNames[key]||key,value)).join('');
    const items=order.items.map((item,index)=>{
      const extra=Object.entries(item).filter(([key])=>!['id','art','quantity','unit','test_op','test_events','test_totals','test_flow'].includes(key)&&item[key]!==null&&item[key]!=='').map(([key,value])=>`${esc(fieldNames[key]||key)}: ${esc(value)}`).join(' · ');
      const totals=item.test_totals||{};const progress=testMode?`<small>${role==='estoque'?`Estoque: ${esc(totals.estoque||'0')}`:role==='digital'?`Digital: ${esc(totals.digital||'0')}`:`Estoque: ${esc(totals.estoque||'0')} · Digital: ${esc(totals.digital||'0')}`}</small>`:'';
      return `<tr><td><strong>${index+1}. ${esc(item.art)}</strong>${extra?`<small>${extra}</small>`:''}${progress}</td><td>${esc(fmt(item.quantity))} ${esc(item.unit)}</td><td><span class="tag">${esc(item.test_op||'Aguardando OP')}</span></td></tr>`;
    }).join('');
    const actions=testMode?testActions(role,order):`<div class="prototype"><h3>Registro previsto nesta etapa</h3><p>${esc(info.write)}</p><button disabled>Registrar execução · em desenvolvimento</button></div>`;
    detail=`<section class="card"><span class="eyebrow">ROMANEIO POR SETOR · ${esc(info.name.toUpperCase())}</span><h2 style="font-size:26px;margin-top:8px">${esc(order.number)}</h2><span class="tag warn">${esc(order.test_status||order.stage_status)}</span><div class="info-grid">${general||'<p class="muted">Sem dados gerais adicionais para este perfil.</p>'}</div><h2>Artes e quantidades</h2><table class="art-table"><thead><tr><th>ARTE / INFORMAÇÕES</th><th>PREVISTO</th><th>OP</th></tr></thead><tbody>${items}</tbody></table>${order.notes?`<div class="notice">Observações: ${esc(order.notes)}</div>`:''}${actions}</section>`;
  }
  $('#workspace').innerHTML=heading(info.name,'Carregando a fila deste setor.')+
    `<div class="stage-grid"><section class="card"><h2>Pedidos cadastrados</h2><p class="muted">${orders.length} pedido(s) · origem Pedidos</p><div class="order-list">${list}</div></section>${detail}</div>
    <section class="card" style="margin-top:18px"><h2>Contrato visual do setor</h2><p><strong>Informações necessárias:</strong> ${esc(info.see)}</p><p><strong>Registro futuro:</strong> ${esc(info.write)}</p><p class="muted">Campos ainda sem fonte confiável aparecem como pendentes; não são preenchidos por suposição.</p></section>`;
  $('#workspace').querySelector('.order-list').onclick=event=>{const button=event.target.closest('[data-index]');if(button){selected=Number(button.dataset.index);renderSector(role);}};
  const release=$('#release-test');if(release)release.onclick=async()=>{try{await post('/pedidos/api/production/release',{number:order.number});await showSector(role);}catch(error){$('#test-action-feedback').textContent=error.message;}};
  const eventForm=$('#record-test');if(eventForm)eventForm.onsubmit=async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(eventForm));try{await post('/pedidos/api/production/record',{...values,number:order.number,sector:role,request_key:crypto.randomUUID()});await showSector(role);}catch(error){$('#test-action-feedback').textContent=error.message;}};
}
function testActions(role,order){
  const history=order.items.flatMap(item=>(item.test_events||[]).map(event=>({art:item.art,...event})));
  const historyHtml=history.length?`<h3>Histórico de teste</h3><div class="history-scroll"><table class="art-table"><thead><tr><th>ARTE</th><th>SETOR</th><th>QUANTIDADE</th><th>ROLO / PAPEL</th><th>PROPRIETÁRIO / MÁQUINA</th><th>OPERADOR</th><th>DATA</th></tr></thead><tbody>${history.map(event=>`<tr><td>${esc(event.art)}</td><td>${esc(event.sector)}</td><td>${esc(event.quantity)}</td><td>${esc(event.reference)}</td><td>${esc(event.secondary_reference)}</td><td>${esc(event.actor)}</td><td>${esc(new Date(event.created_at).toLocaleString('pt-BR'))}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Ainda não há apontamentos de teste.</p>';
  if(role==='pcp')return `<div class="prototype"><h3>PCP · liberação de teste</h3><p>Confirme a arte pronta. A liberação cria uma OP por arte para este teste.</p>${order.test_status==='Aguardando PCP'?'<button id="release-test" type="button">Liberar pedido e criar OPs</button>':'<p>OPs já criadas.</p>'}<p id="test-action-feedback" class="error"></p>${historyHtml}</div>`;
  if(!['estoque','digital'].includes(role))return '<div class="prototype"><p>Esta área permanece em prévia visual.</p></div>';
  if(user.role!==role&&user.role!=='gestao')return `<div class="prototype"><p>Acesso restrito ao setor.</p>${historyHtml}</div>`;
  if(role==='estoque'&&order.service==='Venda de Papel')return '<div class="prototype"><p>Este pedido é somente de papel; não há separação de tecido.</p></div>';
  if(role==='digital'&&!['Transferência digital','Venda de Papel'].includes(order.service))return '<div class="prototype"><p>Este serviço não exige impressão de papel neste teste.</p></div>';
  const eligible=order.items.filter(item=>item.test_op);
  if(!eligible.length)return '<div class="prototype"><p>Aguardando liberação do PCP e criação das OPs.</p></div>';
  const stock=role==='estoque';
  return `<div class="prototype"><h3>${stock?'Separação de tecido de teste':'Impressão de papel de teste'}</h3><p>Apontamento simulado, sem movimento no sistema operacional.</p><form id="record-test" class="form-grid"><label>Arte / OP<select name="item_id">${eligible.map(item=>`<option value="${item.id}">${esc(item.art)} · ${esc(item.test_op)}</option>`).join('')}</select></label><label>Quantidade (${esc(order.unit)})<input name="quantity" type="number" min="0.001" step="0.001" required></label><label>${stock?'Código do rolo':'Identificação do papel'}<input name="reference" required maxlength="120"></label><label>${stock?'Proprietário do tecido':'Máquina'}<input name="secondary_reference" required maxlength="120"></label><div class="form-wide"><button class="primary">Registrar ${stock?'separação':'impressão'} de teste</button><p id="test-action-feedback" class="error"></p></div></form>${historyHtml}</div>`;
}
function flowText(item){
  const f=item.test_flow||{};
  if(!item.test_op)return 'Aguardando PCP';
  if(f.delivered)return 'Entregue';
  if(f.packed)return 'Volume pronto para entrega';
  if(f.sewn&&!f.review_done)return 'Costura concluída · pronto para Revisão';
  if(f.sewing)return 'Em Costura';
  if(f.sewing_ready&&!f.sewn)return 'Pronto para Costura';
  if(f.review_done)return 'Revisado · pronto para Expedição';
  if(f.cut_done)return 'Cortado · pronto para Revisão';
  if(f.cutting)return 'Em corte a laser';
  if(f.calandra_done)return f.needs_cut?'Pronto para Corte a laser':'Pronto para Revisão';
  if(f.calandra_running)return `Em andamento · ${f.calandra_machine}`;
  if(f.calandra_ready)return 'Disponível para Calandra';
  if(f.prepared)return 'Tecido preparado · aguardando papel';
  if(!f.needs_fabric)return f.printed?'Pronto para Expedição':f.printing?'Em impressão':'Aguardando impressão';
  if(f.separated)return !f.needs_preparation?'Pronto para Revisão':f.printed?'Tecido separado e papel impresso':'Tecido separado';
  return f.available?'Tecido em estoque':'Aguardando tecido';
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
 try{const s=await api('/pedidos/api/access/status');preview=Boolean(s.preview);testMode=Boolean(s.test_workflow);workflowEnabled=testMode||Boolean(s.production_workflow);$('#operator-name').value=localStorage.getItem('sublipaper-operator')||'';$('#operator-name').oninput=e=>localStorage.setItem('sublipaper-operator',e.target.value.trim());const list=pages();$('#navigation').innerHTML=list.map(([id,name,icon])=>`<button class="nav-button" data-page="${id}"><span>${icon}</span>${esc(name)}</button>`).join('');$('#navigation').onclick=e=>{const b=e.target.closest('[data-page]');if(b)navigate(b.dataset.page);};$('#menu-toggle').onclick=()=>{if(window.matchMedia?.('(max-width:720px)').matches){$('.sidebar').classList.toggle('open');}else{document.body.classList.toggle('navigation-collapsed');localStorage.setItem('factory-sidebar-collapsed',String(document.body.classList.contains('navigation-collapsed')));}$('#menu-toggle').setAttribute('aria-expanded',String(!document.body.classList.contains('navigation-collapsed')));};document.body.classList.toggle('navigation-collapsed',localStorage.getItem('factory-sidebar-collapsed')==='true');const requested=location.hash.slice(1);navigate(list.some(x=>x[0]===requested)?requested:'overview');}catch(e){$('#workspace').textContent=e.message;}
}
boot();

