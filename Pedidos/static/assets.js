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
};
