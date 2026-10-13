import {ordersTemplate} from './app/orders-template.mjs';
import {orderState,overviewState,mergeProductionOrders} from './app/order-model.mjs';
export function mount(root,onPrepare){
root.innerHTML=ordersTemplate;
const $=s=>root.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const num=v=>Number(v).toLocaleString('pt-BR',{maximumFractionDigits:3});
const date=v=>v?v.slice(0,10).split('-').reverse().join('/'):'—';
const key=s=>s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ');
let data={orders:[],prices:[],services:[]},requestKey='',busy=false,clientFolders=[],detailOrder=null;
const clientInput=$('#form [name=client]');
function selectedClient(){return clientFolders.find(c=>c.name===clientInput.value);}
function validateClient(){const client=selectedClient();clientInput.setCustomValidity(client?'':'Selecione um cliente existente na lista de pastas.');return client;}
async function loadClients(){
  try{
    const response=await fetch('/pedidos/api/clients');if(!response.ok)throw Error('Falha ao consultar clientes.');
    const result=await response.json();clientFolders=result.clients;
    $('#clients').innerHTML=clientFolders.map(c=>`<option value="${esc(c.name)}">`).join('');
    $('#client-status').textContent=result.error?'Pasta de rede indisponível. Usando a última lista salva.':clientFolders.length?`${clientFolders.length} clientes · lista de pastas atualizada automaticamente.`:'Carregando as pastas de clientes…';
    if(clientInput.value)validateClient();
  }catch(error){$('#client-status').textContent=clientFolders.length?'Usando a lista já carregada. Tentando atualizar em segundo plano.':error.message;}
}
async function refresh(){
  const response=await fetch('/pedidos/api/data');if(!response.ok)throw Error('Não foi possível carregar os pedidos.');
  data=await response.json();
  const productionResponse=await fetch('/pedidos/api/factory/orders');if(!productionResponse.ok)throw Error('Os pedidos carregaram, mas o acompanhamento está indisponível. Atualize para tentar novamente.');
  const productionRows=await productionResponse.json();
  data.orders=mergeProductionOrders(data.orders,productionRows);
  const filter=$('#filter').value;
  $('#filter').innerHTML='<option value="">Todos os serviços</option>'+data.services.map(s=>`<option>${esc(s)}</option>`).join('');
  $('#order-service').innerHTML=data.services.map(s=>`<option ${s==='Transferência digital'?'selected':''}>${esc(s)}</option>`).join('');
  $('#filter').value=filter;render();
}
function render(){
 const states=data.orders.map(order=>({order,state:orderState(order)}));
 $('#stats').innerHTML=[['Pedidos em aberto',states.filter(x=>!x.state.done).length],['Em execução',states.filter(x=>x.state.running).length],['Entregues',states.filter(x=>x.state.done).length]].map(([label,n])=>`<div class="stat"><span>${label}</span><strong>${n}</strong></div>`).join('');
 const q=key($('#search').value),service=$('#filter').value,status=$('#order-state').value;
 const rows=states.filter(({order:o,state:t})=>key([o.number,o.client,...o.items.map(x=>x.art)].join(' ')).includes(q)&&(!service||o.items.some(i=>i.service===service))&&(status==='all'||status==='open'&&!t.done||status==='pcp'&&o.items.some(i=>overviewState(i).pcp)||status==='running'&&t.running||status==='done'&&t.done));
 $('#order-count').textContent=`${rows.length} pedido(s)`;
 $('#orders').innerHTML=rows.length?`<div class="order-catalog">${rows.map(({order:o,state:t})=>`<article class="order-catalog-card"><div class="order-catalog-art">${o.items[0]?.asset_id?`<img src="/pedidos/miniaturas/${esc(o.items[0].asset_id)}.jpg" alt="Arte do pedido" loading="lazy">`:'<span>▧</span>'}</div><div class="order-catalog-body"><div class="order-catalog-head"><div><small>${esc(o.number)}</small><h2>${esc(o.client)}</h2></div><span class="state-chip ${t.done?'done':''}">${t.done?'Entregue':t.running?'Em execução':t.released?'Na produção':'Aguardando PCP'}</span></div><p>${esc([...new Set(o.items.map(i=>i.service))].join(' · '))} · ${o.items.length} arte(s)</p><div class="order-catalog-meta"><span>Entrega <b>${date(o.delivery)}</b></span><span>Valor <b>${o.pending_prices===o.items.length?'A definir':money(o.total)}</b>${o.pending_prices?' · parcial':''}</span></div><div class="order-catalog-progress"><span style="width:${o.items.length?100*t.delivered/o.items.length:0}%"></span></div><footer><small>${t.delivered}/${o.items.length} artes entregues</small><button class="ghost view" data-id="${o.id}">Abrir pedido →</button></footer></div></article>`).join('')}</div>`:`<div class="empty"><h3>${data.orders.length?'Nenhum pedido neste filtro':'Comece pelo primeiro pedido'}</h3><p>${data.orders.length?'Ajuste a busca ou a situação.':'Escolha o cliente e selecione as artes para preparar a produção.'}</p></div>`;
}

const field=(name,label,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
function addItem(){
  const el=document.createElement('section');el.className='item';
  el.innerHTML=`<div class="item-head"><strong>ARTE DO PEDIDO</strong><button type="button" class="ghost remove">Remover</button></div><div class="grid">${field('art','Nome da arte *','text','required maxlength="200"')}${field('quantity','Quantidade *','number','required min="0.001" step="0.001"')}</div>`;
  $('#items').append(el);
  el.querySelector('.remove').onclick=()=>{if($('#items').children.length>1)el.remove();else toast('O pedido precisa de pelo menos uma arte.');};
}
function suggestPrice(force=false){
  const input=$('#form [name=unit_price]');if(input.dataset.manual==='yes'&&!force)return;
  const p=data.prices.find(p=>p.client_key===key(clientInput.value));input.value=p?p.price:'';input.dataset.manual='';
  $('#unit-price-note').textContent=p?'Padrão deste cliente. Você pode ajustar neste pedido.':'O primeiro preço salvo será o padrão deste cliente.';
}
function toast(s){$('#commercial-toast').textContent=s;$('#commercial-toast').style.display='block';setTimeout(()=>$('#commercial-toast').style.display='none',4000);}
$('#new').onclick=()=>{
  $('#form').reset();clientInput.setCustomValidity('');clientInput.dataset.selected='';$('#items').innerHTML='';$('#error').textContent='';
  requestKey=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const today=new Date(),delivery=new Date(today);delivery.setDate(today.getDate()+7);
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  $('#order-date').textContent=date(iso(today));$('#automatic-delivery').textContent=date(iso(delivery));
  addItem();$('#editor').showModal();loadClients();
  $('#order-service').onchange=()=>$('#order-flow').classList.toggle('hidden',$('#order-service').value!=='Transferência direta');
  $('#order-service').onchange();
  suggestPrice(true);$('#form [name=unit_price]').oninput=e=>e.target.dataset.manual='yes';
  fetch('/pedidos/api/data').then(r=>r.json()).then(fresh=>{if($('#editor').open){$('#order-date').textContent=date(fresh.today);$('#automatic-delivery').textContent=date(fresh.default_delivery);}}).catch(()=>{});
};
$('#add').onclick=addItem;
root.querySelectorAll('.close').forEach(b=>b.onclick=()=>{if(!busy)b.closest('dialog').close();});
$('#editor').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
clientInput.oninput=()=>validateClient();
clientInput.addEventListener('change',()=>{
  const client=validateClient(),previous=clientInput.dataset.selected||'';
  if(previous!==clientInput.value){
    root.querySelectorAll('.item').forEach(el=>{
      const id=el.querySelector('[name=asset_id]');if(id?.value){id.value='';el.querySelector('[name=art]').value='';}
      const path=el.querySelector('[name=original_path]');if(path){path.value='';path.required=false;}
      const preview=el.querySelector('.preview');if(preview)preview.innerHTML='';
      el.querySelector('.shared-browser')?.classList.add('hidden');
    });
  }
  clientInput.dataset.selected=client?client.name:'';
  suggestPrice(true);
  if(client)fetch('/pedidos/api/art-files?relative='+encodeURIComponent(client.relative)).catch(()=>{});
});
$('#search').oninput=render;$('#filter').onchange=render;$('#order-state').onchange=render;$('#refresh-orders').onclick=()=>refresh().catch(e=>toast(e.message));
$('#form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const client=validateClient();if(!client){clientInput.reportValidity();return;}
  busy=true;$('#save').disabled=true;$('#error').textContent='';
  const form=$('#form'),payload={request_key:requestKey,client:client.name,client_folder:client.relative,service:form.elements.service.value,fabric:form.elements.fabric.value,width_m:form.elements.width_m.value,unit:form.elements.unit.value,unit_price:form.elements.unit_price.value,nf:form.elements.nf.value,notes:form.elements.notes.value,items:[...root.querySelectorAll('.item')].map(el=>Object.fromEntries([...el.querySelectorAll('input,select')].filter(x=>x.name).map(x=>[x.name,x.disabled?'':x.value])))};
  try{
    const r=await fetch('/pedidos/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),order=await r.json();if(!r.ok)throw Error(order.error);
    $('#editor').close();await refresh();showDetail(order);toast('Pedido '+order.number+' registrado.');
  }catch(error){$('#error').textContent=error.message;toast(error.message);}
  finally{busy=false;$('#save').disabled=false;}
};
$('#orders').onclick=e=>{const button=e.target.closest('.view');if(button)showDetail(data.orders.find(o=>o.id===Number(button.dataset.id)));};
function showDetail(o){
  detailOrder=o;
  const chunks=[];for(let start=0;start<o.items.length;start+=8)chunks.push(o.items.slice(start,start+8));
  const header=(page,total)=>`<div class="detail-summary"><span class="eyebrow">PEDIDO · PÁGINA ${page}/${total}</span><h3>${esc(o.number)}</h3><strong class="detail-client">${esc(o.client)}</strong><p>Data do pedido: ${date(o.created_at)} · Previsão de entrega: ${date(o.delivery)}</p><p><strong>Serviço:</strong> ${esc(o.service||'Múltiplos (legado)')} · <strong>Tecido:</strong> ${esc(o.fabric||'Não informado')} · <strong>Largura:</strong> ${o.width_m?num(Number(o.width_m))+' m':'Não informada'} · <strong>Unidade:</strong> ${esc(o.unit||'Legado')} · <strong>Preço por Unidade de Medida:</strong> ${o.unit_price===null?'A definir':money(o.unit_price)} · <strong>NF:</strong> ${esc(o.nf||'Não informada')}</p></div>`;
  $('#detail-body').innerHTML=chunks.map((chunk,page)=>`<section class="romaneio-page count-${chunk.length}">${header(page+1,chunks.length)}<div class="romaneio-grid">${chunk.map((i,index)=>`<article class="detail-card"><div class="art-thumb-slot"></div><div class="art-info"><h3>${page*8+index+1}. ${esc(i.art)}</h3><p class="item-quantity">${num(i.quantity)} ${o.unit||i.unit}</p><p>Subtotal: ${i.total===null?'A definir':money(i.total)}</p></div></article>`).join('')}</div>${page===chunks.length-1?`<div class="romaneio-footer"><p class="total">${o.pending_prices?'Total parcial':'Total'}: ${money(o.total)}</p>${o.pending_prices?'<p>Há itens sem preço definido.</p>':''}${o.notes?`<h3>Observações</h3><p class="notes">${esc(o.notes)}</p>`:''}</div>`:''}<p class="footnote">Documento de conferência · Não é nota fiscal.</p></section>`).join('');
  $('#detail').showModal();
}
$('#print').onclick=()=>{if(detailOrder)window.open(`/pedidos/api/orders/${encodeURIComponent(detailOrder.number)}/romaneio.pdf`,'_blank','noopener');};
$('#delete-order').onclick=async()=>{
  if(!detailOrder||busy)return;
  if(!confirm(`Você deseja mesmo excluir o pedido ${detailOrder.number}?`))return;
  busy=true;$('#delete-order').disabled=true;
  try{
    const response=await fetch('/pedidos/api/orders/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number:detailOrder.number})});
    const result=await response.json();if(!response.ok)throw Error(result.error);
    $('#detail').close();detailOrder=null;await refresh();toast(`Pedido ${result.number} excluído.`);
  }catch(error){toast(error.message);}
  finally{busy=false;$('#delete-order').disabled=false;}
};
refresh().catch(error=>$('#orders').textContent=error.message);loadClients();

// Arte de referência: o original só permanece durante a conversão no servidor.
const originalAddItem = addItem;
let conversions = 0;
addItem = function () {
  originalAddItem();
  const item = $('#items').lastElementChild;
  const section = document.createElement('section');
  section.className = 'art-reference';
  section.innerHTML = `<h4>Referência visual da arte</h4>
    <button type="button" class="secondary shared-select">Selecionar na pasta compartilhada</button>
    <div class="shared-browser hidden"></div>
    <details class="alternative-upload"><summary>Alternativa: selecionar uma cópia reduzida</summary><label>Selecionar imagem ou PDF<input type="file" accept=".tif,.tiff,.jpg,.jpeg,.png,.webp,.bmp,.pdf" class="art-file"></label><label>Caminho da arte original<input class="manual-path" maxlength="2000" placeholder="Necessário apenas nesta alternativa"></label></details>
    <p class="hint">Aceita TIFF, PDF e imagens. A primeira página vira uma miniatura leve de até 480 px.</p>
    <input type="hidden" name="asset_id" value="">
    <input type="hidden" name="original_path" value="">
    <div class="preview" role="status"></div>`;
  item.append(section);
  section.querySelector('.manual-path').oninput=e=>section.querySelector('[name=original_path]').value=e.target.value;
  section.querySelector('.shared-select').onclick=()=>{
    const client=validateClient();
    if(!client){clientInput.reportValidity();toast('Selecione o cliente antes de escolher a arte.');return;}
    browseShared(section,item,client.relative);
  };
  section.querySelector('.art-file').onchange = async e => {
    const file=e.target.files[0]; if(!file)return;
    const status=section.querySelector('.preview'), id=section.querySelector('[name=asset_id]');
    id.value='';section.querySelector('.manual-path').required=true;
    if(file.size>256*1024*1024){status.textContent='Arquivo acima de 256 MB. Selecione uma cópia reduzida e informe o caminho do original.';e.target.value='';return;}
    conversions++; $('#save').disabled=true; e.target.disabled=true;clientInput.disabled=true;
    status.textContent='Enviando e gerando miniatura…';
    try {
      const response=await fetch('/pedidos/api/thumbnail',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});
      const asset=await response.json(); if(!response.ok)throw Error(asset.error);
      id.value=asset.id;
      status.innerHTML=`<img src="/pedidos/miniaturas/${asset.id}.jpg" alt="Prévia da arte selecionada"><span>${esc(asset.name)}<br>${(asset.bytes/1024).toFixed(1)} KB · Referência visual</span>`;
      if(!item.querySelector('[name=art]').value)item.querySelector('[name=art]').value=file.name.replace(/\.[^.]+$/,'').slice(0,200);
    } catch(error){status.textContent=error.message;e.target.value='';}
    finally{conversions--;e.target.disabled=false;$('#save').disabled=busy||conversions>0;clientInput.disabled=conversions>0;}
  };
};
async function browseShared(section,item,relative){
  const panel=section.querySelector('.shared-browser');panel.classList.remove('hidden');panel.textContent='Lendo pasta compartilhada…';
  try{
    const response=await fetch('/pedidos/api/art-files?relative='+encodeURIComponent(relative)),listing=await response.json();
    if(!response.ok)throw Error(listing.error);
    if(relative===selectedClient()?.relative)listing.parent=null;
    panel.innerHTML=`<div class="folder-actions"><button type="button" class="ghost folder-close">Fechar seleção</button>${listing.parent!==null?'<button type="button" class="secondary folder-up">↑ Pasta anterior</button>':''}</div><input class="file-search" placeholder="Filtrar nomes nesta pasta" aria-label="Filtrar arquivos"><div class="file-list"></div><div class="selection-preview hidden"></div>${listing.limited?'<p>Exibindo até 1.000 entradas. Organize as artes em subpastas para facilitar a localização.</p>':''}`;
    panel.querySelector('.folder-close').onclick=()=>panel.classList.add('hidden');
    if(listing.parent!==null)panel.querySelector('.folder-up').onclick=()=>browseShared(section,item,listing.parent);
    function draw(){const q=key(panel.querySelector('.file-search').value);const list=panel.querySelector('.file-list');list.innerHTML='';listing.entries.filter(x=>key(x.name).includes(q)).forEach(entry=>{const button=document.createElement('button');button.type='button';button.className='ghost';button.dataset.relative=entry.relative;button.dataset.directory=entry.directory?'1':'0';button.textContent=(entry.directory?'▸ ':'▧ ')+entry.name;button.onclick=()=>entry.directory?browseShared(section,item,entry.relative):previewShared(section,item,entry.relative,button);list.append(button);});if(!list.children.length)list.textContent='Nenhuma arte ou pasta encontrada.';}
    panel.onkeydown=event=>{if(!['ArrowUp','ArrowDown'].includes(event.key))return;const buttons=[...panel.querySelectorAll('.file-list button[data-directory="0"]')];if(!buttons.length)return;const current=buttons.findIndex(button=>button.classList.contains('previewing'));let index=current<0?(event.key==='ArrowDown'?0:buttons.length-1):current+(event.key==='ArrowDown'?1:-1);index=Math.max(0,Math.min(buttons.length-1,index));event.preventDefault();previewShared(section,item,buttons[index].dataset.relative,buttons[index]);};
    panel.querySelector('.file-search').oninput=draw;draw();
  }catch(error){panel.textContent=error.message;}
}
async function previewShared(section,item,relative,button){
  const panel=section.querySelector('.shared-browser'),preview=panel.querySelector('.selection-preview');
  panel.querySelectorAll('.file-list button').forEach(b=>b.classList.remove('previewing'));if(button){button.classList.add('previewing');button.focus();button.scrollIntoView({block:'nearest'});}
  preview.classList.remove('hidden');preview.textContent='Preparando pré-visualização…';
  try{
    const response=await fetch('/pedidos/api/art-preview?relative='+encodeURIComponent(relative)),result=await response.json();if(!response.ok)throw Error(result.error);
    preview.innerHTML=`<img src="${result.url}" alt="Pré-visualização de ${esc(result.name)}"><div><strong>${esc(result.name)}</strong><p>Confira a imagem antes de usar no pedido.</p><button type="button" class="use-art">Usar esta arte</button></div>`;
    preview.querySelector('.use-art').onclick=()=>selectShared(section,item,relative,result.preview_id);
  }catch(error){preview.textContent=error.message;}
}
async function selectShared(section,item,relative,previewId){
  if(conversions){toast('Aguarde a conversão em andamento.');return;}
  const status=section.querySelector('.preview');conversions++;$('#save').disabled=true;clientInput.disabled=true;
  status.textContent='Lendo a arte na rede e gerando miniatura…';
  try{
    const response=await fetch('/pedidos/api/shared-thumbnail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({relative,preview_id:previewId})}),asset=await response.json();
    if(!response.ok)throw Error(asset.error);
    section.querySelector('[name=asset_id]').value=asset.id;
    section.querySelector('[name=original_path]').value=asset.original_path;
    status.innerHTML=`<img src="/pedidos/miniaturas/${asset.id}.jpg" alt="Prévia da arte selecionada"><span>${esc(asset.name)}<br>${(asset.bytes/1024).toFixed(1)} KB · Referência visual</span>`;
    if(!item.querySelector('[name=art]').value)item.querySelector('[name=art]').value=asset.name.replace(/\.[^.]+$/,'').slice(0,200);
    section.querySelector('.shared-browser').classList.add('hidden');
  }catch(error){status.textContent=error.message;}
  finally{conversions--;$('#save').disabled=busy||conversions>0;clientInput.disabled=conversions>0;}
}
$('#add').onclick=addItem;
$('#form').addEventListener('submit',event=>{if(conversions){event.preventDefault();event.stopImmediatePropagation();toast('Aguarde a conversão da arte.');}},true);
const originalShowDetail=showDetail;
showDetail=function(order){
  originalShowDetail(order);
  $('#detail .dialog-head h2').textContent='Romaneio do pedido';
  $('#detail-body').querySelectorAll('.detail-card').forEach((card,index)=>{
    const item=order.items[index];
    if(!item.asset_id&&!item.original_path)return;
    const block=document.createElement('div');block.className='reference-detail';
    block.innerHTML=`${item.asset_id?`<img src="/pedidos/miniaturas/${esc(item.asset_id)}.jpg" alt="Referência visual: ${esc(item.art)}">`:''}<button type="button" class="secondary copy-path">Localizar original</button>`;
    card.querySelector('.art-thumb-slot').append(block);
    block.querySelector('.copy-path').onclick=()=>{
      const input=document.createElement('textarea');input.value=item.original_path;block.append(input);input.select();
      const copied=document.execCommand('copy');input.remove();toast(copied?'Caminho copiado. Cole no Explorador do Windows.':'Selecione e copie o caminho exibido.');
    };
  });
  if(order.service==='Corte a laser'&&onPrepare){
    $('#detail-body').querySelectorAll('.detail-card').forEach((card,index)=>{
      const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Preparar grade desta arte';
      button.onclick=()=>{$('#detail').close();onPrepare(order.id,order.items[index].id);};card.append(button);
    });
  }
};

}
