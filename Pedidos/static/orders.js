const $=s=>document.querySelector(s);
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
  data=await response.json();const filter=$('#filter').value;
  $('#filter').innerHTML='<option value="">Todos os serviços</option>'+data.services.map(s=>`<option>${esc(s)}</option>`).join('');
  $('#order-service').innerHTML=data.services.map(s=>`<option ${s==='Transferência digital'?'selected':''}>${esc(s)}</option>`).join('');
  $('#filter').value=filter;render();
}
function render(){
  const all=data.orders.flatMap(o=>o.items),sum=u=>all.filter(x=>x.unit===u).reduce((s,x)=>s+Number(x.quantity),0);
  $('#stats').innerHTML=[['Pedidos registrados',data.orders.length],['Metragem solicitada',num(sum('m'))+' m'],['Peso solicitado',num(sum('kg'))+' kg']].map(([a,b])=>`<div class="stat"><span>${a}</span><strong>${b}</strong></div>`).join('');
  const q=key($('#search').value),service=$('#filter').value;
  const rows=data.orders.filter(o=>key([o.number,o.client,...o.items.map(x=>x.art)].join(' ')).includes(q)&&(!service||o.items.some(i=>i.service===service)));
  $('#orders').innerHTML=rows.length?`<table><thead><tr><th>PEDIDO / CLIENTE</th><th>ARTES E SERVIÇOS</th><th>DATA DO PEDIDO</th><th>PREVISÃO DE ENTREGA</th><th>VALOR</th><th></th></tr></thead><tbody>${rows.map(o=>`<tr><td><strong>${esc(o.number)}</strong><small>${esc(o.client)}</small></td><td>${o.items.length} arte(s)<small>${esc([...new Set(o.items.map(i=>i.service))].join(' · '))}</small></td><td>${date(o.created_at)}</td><td>${date(o.delivery)}</td><td>${money(o.total)}${o.pending_prices?'<small>Parcial · valores pendentes</small>':''}</td><td><button class="ghost view" data-id="${o.id}">Ver pedido ↗</button></td></tr>`).join('')}</tbody></table>`:`<div class="empty"><div class="symbol">▧</div><h3>${data.orders.length?'Nenhum pedido encontrado':'O próximo pedido começa aqui.'}</h3><p>${data.orders.length?'Tente outro cliente, arte ou serviço.':'Selecione o cliente, adicione as artes e combine a entrega.'}</p></div>`;
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
function toast(s){$('#toast').textContent=s;$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',4000);}
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
document.querySelectorAll('.close').forEach(b=>b.onclick=()=>{if(!busy)b.closest('dialog').close();});
$('#editor').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
clientInput.oninput=()=>validateClient();
clientInput.addEventListener('change',()=>{
  const client=validateClient(),previous=clientInput.dataset.selected||'';
  if(previous!==clientInput.value){
    document.querySelectorAll('.item').forEach(el=>{
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
$('#search').oninput=render;$('#filter').onchange=render;
$('#form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const client=validateClient();if(!client){clientInput.reportValidity();return;}
  busy=true;$('#save').disabled=true;$('#error').textContent='';
  const form=$('#form'),payload={request_key:requestKey,client:client.name,client_folder:client.relative,service:form.elements.service.value,fabric:form.elements.fabric.value,width_m:form.elements.width_m.value,unit:form.elements.unit.value,unit_price:form.elements.unit_price.value,nf:form.elements.nf.value,notes:form.elements.notes.value,items:[...document.querySelectorAll('.item')].map(el=>Object.fromEntries([...el.querySelectorAll('input,select')].filter(x=>x.name).map(x=>[x.name,x.disabled?'':x.value])))};
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
  const header=(page,total)=>`<div class="detail-summary"><span class="eyebrow">PEDIDO · PÁGINA ${page}/${total}</span><h3>${esc(o.number)}</h3><strong class="detail-client">${esc(o.client)}</strong><p>Data do pedido: ${date(o.created_at)} · Previsão de entrega: ${date(o.delivery)}</p><p><strong>Serviço:</strong> ${esc(o.service||'Múltiplos (legado)')} · <strong>Tecido:</strong> ${esc(o.fabric||'Não informado')} · <strong>Largura:</strong> ${o.width_m?num(o.width_m)+' m':'Não informada'} · <strong>Unidade:</strong> ${esc(o.unit||'Legado')} · <strong>Preço por Unidade de Medida:</strong> ${o.unit_price===null?'A definir':money(o.unit_price)} · <strong>NF:</strong> ${esc(o.nf||'Não informada')}</p></div>`;
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
refresh().catch(error=>$('#orders').textContent=error.message);loadClients();setInterval(loadClients,10000);
