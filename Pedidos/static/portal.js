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
let user=null, setup=false, preview=false, testMode=false, current='overview', selected=0, orders=[], pageRequest=0;

async function api(path, options={}) {
  const response=await fetch(path,{credentials:'same-origin',...options});
  let result;
  try{result=await response.json();}catch{result={error:'Resposta inválida do servidor'};}
  if(!response.ok)throw Error(result.error || 'Não foi possível concluir a operação');
  return result;
}
async function post(path, data){return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
function authMode(first){
  setup=first;
  $('#auth-title').textContent=first?'Criar acesso de Gestão':'Entrar no sistema';
  $('#auth-description').textContent=first?'Configure a primeira conta neste computador. Depois, gerencie os demais usuários pela página.':'Use sua conta para ver os pedidos e as áreas autorizadas.';
  $('#setup-hint').textContent=first?'A primeira conta deve ser criada neste computador. Escolha qualquer senha não vazia.':'';
  $('#auth-password').autocomplete=first?'new-password':'current-password';
}
async function boot(){
  try{
    const status=await api('/pedidos/api/access/status');
    preview=Boolean(status.preview);testMode=Boolean(status.test_workflow);
    authMode(status.setup_required);
    if(!status.setup_required){try{user=await api('/pedidos/api/access/me');}catch{}}
    if(user)enter();else $('#auth').classList.remove('hidden');
  }catch(error){$('#auth-error').textContent=error.message;}
}
$('#auth-form').addEventListener('submit',async event=>{
  event.preventDefault();$('#auth-error').textContent='';
  const username=$('#auth-user').value.trim(),password=$('#auth-password').value;
  try{
    if(setup)await post('/pedidos/api/access/bootstrap',{username,password});
    user=await post('/pedidos/api/access/login',{username,password});
    $('#auth-password').value='';enter();
  }catch(error){$('#auth-error').textContent=error.message;}
});
$('#logout').onclick=async()=>{try{await post('/pedidos/api/access/logout',{});}catch{}pageRequest++;overviewRequest++;user=null;orders=[];overviewRows=[];$('#workspace').innerHTML='';$('#shell').classList.add('hidden');$('#auth').classList.remove('hidden');authMode(false);$('#auth-form').reset();};
$('#menu-toggle').onclick=()=>$('.sidebar').classList.toggle('open');

function pages(){
  const list=user.role==='gestao'?[['overview','Visão geral','◫']]:[];
  if(['comercial','gestao'].includes(user.role))list.push(['pedidos','Pedidos','▧']);
  if(['comercial','financeiro','gestao'].includes(user.role))list.push(['financeiro','Faturamento','¤']);
  if(['pcp','gestao'].includes(user.role))list.push(['pcp',sectorInfo.pcp.name,sectorInfo.pcp.icon]);
  for(const [role,info] of Object.entries(sectorInfo))if(!['comercial','pcp','financeiro'].includes(role)&&(user.role==='gestao'||user.role===role))list.push([role,info.name,info.icon]);
  if(user.role==='gestao')list.push(['users','Contas e acesso','♙']);
  return list;
}
function enter(){
  $('#auth').classList.add('hidden');$('#shell').classList.remove('hidden');
  $('#account-name').textContent=user.username;$('#account-role').textContent=user.role==='gestao'?'Gestão':sectorInfo[user.role]?.name||user.role;
  if(preview)$('.sidebar-foot').innerHTML=testMode?'<span class="status-dot"></span> Ambiente de testes isolado<br><small>Sem baixa no Estoque ou Digital reais</small>':'<span class="status-dot"></span> Prévia com cópia dos pedidos<br><small>Alterações de pedidos desativadas</small>';
  const list=pages();$('#navigation').innerHTML=list.map(([id,name,icon])=>`<button class="nav-button" data-page="${id}"><span>${icon}</span>${esc(name)}</button>`).join('');
  $('#navigation').onclick=event=>{const button=event.target.closest('[data-page]');if(button)navigate(button.dataset.page);};
  const requested=new URLSearchParams(location.search).get('next')==='faturamento'?'financeiro':location.hash.slice(1);
  navigate(requested && list.some(page=>page[0]===requested)?requested:list[0][0]);
}
function heading(title,subtitle,badge='PRÉVIA PARA APROVAÇÃO'){
  return `<div class="page-head"><div><span class="eyebrow">FLUXO DA FÁBRICA</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><span class="tag warn">${esc(badge)}</span></div>`;
}
async function navigate(page){
  if(!pages().some(item=>item[0]===page))return;
  pageRequest++;overviewRequest++;current=page;if(location.hash!=='#'+page)location.hash=page;$('.sidebar').classList.remove('open');
  window.scrollTo({top:0,behavior:'instant'});
  $('#workspace').onclick=null;$('#workspace').onsubmit=null;$('#workspace').oninput=null;
  document.querySelectorAll('.nav-button').forEach(button=>button.classList.toggle('active',button.dataset.page===page));
  $('#breadcrumb').textContent=pages().find(item=>item[0]===page)[1];
  if(page==='pedidos')return showPedidos();
  if(page==='financeiro')return showBilling();
  if(page==='users')return showUsers();
  if(page==='overview')return showOverview();
  return showSector(page);
}
function showBilling(){
  $('#workspace').innerHTML=heading('Conferência para faturamento','Pedido, romaneio e reposições vinculados ao número original.','CONFERÊNCIA')+'<div class="iframe-wrap"><iframe title="Faturamento" src="/pedidos/faturamento"></iframe></div>';
}
function showPedidos(){
  $('#workspace').innerHTML=heading('Central de pedidos',testMode?'Cadastro de pedidos com clientes e artes da pasta compartilhada, usando a base isolada de testes.':preview?'Cópia dos pedidos para aprovação visual; alterações estão desativadas.':'Cadastro atual de pedidos e artes, dentro da plataforma da fábrica.',testMode?'CADASTRO DE TESTE':preview?'CÓPIA PARA TESTES':'CADASTRO ATIVO')+`<div class="iframe-wrap"><iframe title="Cadastro de Pedidos" src="/pedidos/pedidos"></iframe></div>`;
  const frame=$('#workspace iframe');
  frame.onload=()=>{
    const style=frame.contentDocument.createElement('style');
    style.textContent='aside,header{display:none!important}main{margin-left:0!important;max-width:none!important;padding:18px 28px!important}.heading{margin:0 0 16px!important;justify-content:flex-end!important}.heading>div{display:none!important}'+(preview&&!testMode?'#new,#delete-order{display:none!important}':testMode?'#delete-order{display:none!important}':'');
    frame.contentDocument.head.append(style);
  };
}
async function showSector(role){
  const info=sectorInfo[role];if(!info)return;
  const request=++pageRequest,session=user;
  const previous=orders[selected]?.number;
  $('#workspace').innerHTML=heading(info.name,'Veja o romaneio do setor e os registros previstos para sua execução.')+'<div class="card">Carregando pedidos…</div>';
  try{
    const loaded=await api('/pedidos/api/factory/orders?sector='+encodeURIComponent(role));if(current!==role||request!==pageRequest||user!==session)return;orders=loaded;
    if(testMode&&role==='pcp')return renderPcp();
    if(testMode&&role==='financeiro')return renderFinance();
    if(testMode&&['estoque','digital','preparacao','calandra','corte','costura','revisao','expedicao'].includes(role))return renderBoard(role);
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
    if(order.unit==='pc'&&order.items.some(item=>!item.production_configured))missing.push('Informe a metragem de impressão de cada arte em Unidades e meta de produção');
    if(['Transferência digital','Venda de Papel','Corte a laser'].includes(order.service))order.items.forEach(item=>{if(!item.original_path)missing.push(`Arte ${item.art}: informe o arquivo da arte pronta`);});
    const isReleased=order.items.some(item=>item.test_op);
    return `<article class="production-card" data-number="${esc(order.number)}"><span class="eyebrow">${esc(order.number)}</span><h3>${esc(order.client||'Cliente não informado')}</h3><p>${esc(order.service||'Serviço não informado')} · ${order.items.length} arte(s) · entrega ${esc(date(order.delivery))}</p><p>${order.items.map(item=>`${esc(item.art)}: ${esc(fmt(item.quantity))} ${esc(item.unit)}${item.test_op?` · ${esc(item.test_op)}`:''}`).join('<br>')}</p>${missing.length&&!isReleased?`<p class="error">${missing.map(esc).join('<br>')}</p>`:''}${isReleased?'<span class="tag">OPs criadas</span>':`<button class="primary" data-release="${esc(order.number)}" ${missing.length?'disabled':''}>Liberar pedido e criar OPs</button>`}${productionPlanning(order)}${sewingPlanning(order)}</article>`;
  };
  $('#workspace').innerHTML=heading('PCP / planejamento','Confira as artes prontas e libere o pedido para gerar uma OP por arte.','FILA DE TESTE')+
    `<div class="metric-grid"><div class="metric"><span>Aguardando PCP</span><strong>${pending.length}</strong></div><div class="metric"><span>Liberados</span><strong>${released.length}</strong></div><div class="metric"><span>OPs criadas</span><strong>${released.reduce((sum,order)=>sum+order.items.filter(item=>item.test_op).length,0)}</strong></div></div>`+
    '<button id="refresh-pcp" type="button">Atualizar fila</button><p id="pcp-feedback" class="error" role="alert"></p>'+
    `<div class="production-board two-columns"><section class="board-column"><h2>Aguardando liberação <span>${pending.length}</span></h2>${pending.map(card).join('')||'<p class="muted">Nenhum pedido pendente.</p>'}</section><section class="board-column"><h2>OPs criadas <span>${released.length}</span></h2>${released.map(card).join('')||'<p class="muted">Nenhuma OP criada.</p>'}</section></div>`;
  $('#refresh-pcp').onclick=()=>showSector('pcp');
  bindSewingPlanning();
  $('#workspace').onclick=async event=>{const button=event.target.closest('[data-release]');if(!button||button.disabled)return;button.disabled=true;try{await post('/pedidos/api/test/release',{number:button.dataset.release});if(current==='pcp')await showSector('pcp');}catch(error){if(current==='pcp'){$('#pcp-feedback').textContent=error.message;button.disabled=false;}}};
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
  $('#workspace').innerHTML=heading(info.name,'Veja o romaneio do setor e os registros previstos para sua execução.')+
    `<div class="stage-grid"><section class="card"><h2>Pedidos cadastrados</h2><p class="muted">${orders.length} pedido(s) · origem Pedidos</p><div class="order-list">${list}</div></section>${detail}</div>
    <section class="card" style="margin-top:18px"><h2>Contrato visual do setor</h2><p><strong>Informações necessárias:</strong> ${esc(info.see)}</p><p><strong>Registro futuro:</strong> ${esc(info.write)}</p><p class="muted">Campos ainda sem fonte confiável aparecem como pendentes; não são preenchidos por suposição.</p></section>`;
  $('#workspace').querySelector('.order-list').onclick=event=>{const button=event.target.closest('[data-index]');if(button){selected=Number(button.dataset.index);renderSector(role);}};
  const release=$('#release-test');if(release)release.onclick=async()=>{try{await post('/pedidos/api/test/release',{number:order.number});await showSector(role);}catch(error){$('#test-action-feedback').textContent=error.message;}};
  const eventForm=$('#record-test');if(eventForm)eventForm.onsubmit=async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(eventForm));try{await post('/pedidos/api/test/record',{...values,number:order.number,sector:role,request_key:crypto.randomUUID()});await showSector(role);}catch(error){$('#test-action-feedback').textContent=error.message;}};
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
  if(role==='revisao')return item.work_label?'Conferência conjunta do pedido':'Expedição';
  return 'Entrega registrada';
}
async function showUsers(){
  $('#workspace').innerHTML=heading('Contas e acesso','Crie contas individuais e defina o setor de cada pessoa.','GESTÃO')+
    `<section class="card"><h2>Nova conta</h2><form id="user-form" class="form-grid"><label>Usuário<input name="username" required maxlength="80"></label><label>Senha inicial<input name="password" type="password" required autocomplete="new-password"></label><label>Perfil<select name="role">${Object.entries(sectorInfo).map(([key,info])=>`<option value="${key}">${esc(info.name)}</option>`).join('')}<option value="gestao">Gestão</option></select></label><button class="primary">Criar conta</button></form><p id="user-feedback" class="feedback"></p></section><section class="card" style="margin-top:18px"><h2>Contas cadastradas</h2><div id="user-list">Carregando…</div></section>`;
  $('#user-form').onsubmit=async event=>{
    event.preventDefault();const form=event.target,data=Object.fromEntries(new FormData(form));
    try{await post('/pedidos/api/access/users',data);form.reset();$('#user-feedback').textContent='Conta criada.';await loadUsers();}
    catch(error){$('#user-feedback').textContent=error.message;$('#user-feedback').classList.add('error');}
  };
  await loadUsers();
}
async function loadUsers(){
  const session=user;
  try{
    const users=await api('/pedidos/api/access/users');if(current!=='users'||user!==session)return;
    $('#user-list').innerHTML=`<table class="users-table"><thead><tr><th>USUÁRIO</th><th>PERFIL</th><th>ESTADO</th><th>AÇÕES</th></tr></thead><tbody>${users.map(item=>`<tr><td>${esc(item.username)}</td><td>${esc(item.role==='gestao'?'Gestão':sectorInfo[item.role]?.name||item.role)}</td><td>${item.active?'Ativa':'Inativa'}</td><td><button data-id="${item.id}" data-action="password">Redefinir senha</button> <button data-id="${item.id}" data-action="active" data-active="${item.active?0:1}">${item.active?'Desativar':'Ativar'}</button></td></tr>`).join('')}</tbody></table>`;
    $('#user-list').onclick=async event=>{
      const button=event.target.closest('[data-action]');if(!button)return;
      let payload={id:button.dataset.id};
      if(button.dataset.action==='password'){
        const password=prompt('Nova senha (não pode ficar vazia):');if(password===null)return;payload.password=password;
      }else{payload.active=button.dataset.active==='1';if(!confirm(`Confirma ${payload.active?'ativar':'desativar'} esta conta?`))return;}
      try{await post('/pedidos/api/access/users/change',payload);await loadUsers();}
      catch(error){alert(error.message);}
    };
  }catch(error){if(current==='users'&&user===session&&$('#user-list'))$('#user-list').textContent=error.message;}
}
window.addEventListener('hashchange',()=>{
  if(!user)return;
  const page=location.hash.slice(1),allowed=pages();
  if(!allowed.some(entry=>entry[0]===page)){navigate(allowed[0][0]);return;}
  if(page!==current)navigate(page);
});
boot();
