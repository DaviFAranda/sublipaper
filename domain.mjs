export const LOSS_PERCENT=5;
export function text(value,label,max=160){const s=String(value??'').trim();if(!s||s.length>max)throw new Error(`${label}: preencha até ${max} caracteres.`);return s;}
export function number(value,label,{integer=false,min=0,max=1000000}={}){if(value===null||value===undefined||String(value).trim()==='')throw new Error(`${label}: informe um número.`);const n=Number(String(value).replace(',','.'));if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isSafeInteger(n)))throw new Error(`${label}: valor inválido${integer?' (use peças inteiras)':''}.`);return n;}
export const ceilMeters=n=>Math.ceil((n-1e-10)*1000)/1000;
export function validatePlan(raw){
 const rows=raw.rows;if(!Array.isArray(rows)||rows.length<1||rows.length>200)throw new Error('Inclua de 1 a 200 tamanhos/componentes.');
 const plan={order:text(raw.order,'Pedido'),client:text(raw.client,'Cliente'),art:text(raw.art,'Arte'),fabric:text(raw.fabric,'Tecido'),grade:text(raw.grade,'Grade'),revision:String(raw.revision||'1'),cutFile:text(raw.cutFile||raw.artFilename||raw.art,'Arquivo de corte',500),notes:String(raw.notes||'').slice(0,2000),width:raw.gradeWidthCm!==undefined?number(raw.gradeWidthCm,'Largura útil (cm)',{min:1,max:1000})/100:number(raw.width,'Largura útil',{min:.01,max:10}),length:raw.gradeLengthCm!==undefined?number(raw.gradeLengthCm,'Comprimento da grade (cm)',{min:.1,max:100000})/100:number(raw.length,'Comprimento da grade',{min:.001,max:1000}),rows:rows.map((r,i)=>({id:String(i+1),product:text(r.product,'Produto'),size:r.widthCm&&r.heightCm?`${number(r.widthCm,'Largura da peça (cm)',{min:.01,max:10000})} × ${number(r.heightCm,'Comprimento da peça (cm)',{min:.01,max:100000})} cm`:text(r.size||'Sem medidas','Medidas',80),component:text(r.component||'Peça inteira','Componente'),target:number(r.target,'Meta de peças',{integer:true,min:1}),yield:number(r.yield,'Peças por grade',{integer:true,min:1}),widthCm:r.widthCm?number(r.widthCm,'Largura da peça (cm)',{min:.01,max:10000}):null,heightCm:r.heightCm?number(r.heightCm,'Comprimento da peça (cm)',{min:.01,max:100000}):null}))};
 plan.artFilename=String(raw.artFilename||plan.art).slice(0,300);plan.thumbnailId=raw.thumbnailId||null;
 if(plan.thumbnailId&&!/^[a-f0-9]{64}$/.test(plan.thumbnailId))throw new Error('Miniatura inválida.');
 for(const r of plan.rows){if(Boolean(r.widthCm)!==Boolean(r.heightCm))throw new Error('Informe as duas medidas da peça ou deixe ambas vazias.');if(r.widthCm&&!((r.widthCm<=plan.width*100&&r.heightCm<=plan.length*100)||(r.heightCm<=plan.width*100&&r.widthCm<=plan.length*100)))throw new Error('As medidas da peça não cabem nos limites da grade informada.');} const labels=plan.rows.map(r=>`${r.product}|${r.size}|${r.component}`.toLocaleLowerCase());if(new Set(labels).size!==labels.length)throw new Error('Produto, tamanho e componente repetidos. Una as quantidades na mesma linha.');
 return plan;
}
export function calculate(plan,targets=null){
 const rows=plan.rows.map(r=>({...r,needed:targets?Number(targets[r.id]||0):r.target}));
 const repeats=Math.max(0,...rows.map(r=>Math.ceil(r.needed/r.yield)));
 const base=ceilMeters(repeats*plan.length),total=ceilMeters(base*1.05);
 return {repeats,base,total,extra:ceilMeters(total-base),lossPercent:LOSS_PERCENT,rows:rows.map(r=>({...r,planned:repeats*r.yield}))};
}
export function summary(job){
 const totals=Object.fromEntries(job.plan.rows.map(r=>[r.id,{good:0,rejected:0,reserved:0}]));
 for(const e of job.measurements)for(const r of e.rows){totals[r.id].good+=r.good;totals[r.id].rejected+=r.rejected;}
 for(const req of job.reprints.filter(r=>r.status==='open'))for(const [id,q] of Object.entries(req.targets))totals[id].reserved+=q;
 const rows=job.plan.rows.map(r=>({...r,...totals[r.id],missing:Math.max(0,r.target-totals[r.id].good),available:Math.max(0,r.target-totals[r.id].good-totals[r.id].reserved)}));
 return {rows,meters:ceilMeters(job.measurements.reduce((n,e)=>n+e.meters,0)),good:rows.reduce((n,r)=>n+r.good,0),missing:rows.reduce((n,r)=>n+r.missing,0),status:job.status==='draft'?'draft':rows.every(r=>r.missing===0)?'complete':job.measurements.length?'partial':'ready'};
}
export function measurement(job,raw){
 if(job.status==='draft')throw new Error('O designer precisa liberar a grade antes do corte.');
 const source=raw.reprintId?job.reprints.find(r=>r.id===raw.reprintId&&r.status==='open'):null;
 if(raw.reprintId&&!source)throw new Error('Reimpressão não está aberta.');
 if(!Array.isArray(raw.rows)||raw.rows.length!==job.plan.rows.length)throw new Error('Confira todos os tamanhos da grade.');
 const ids=new Set();const rows=raw.rows.map(r=>{if(ids.has(r.id)||!job.plan.rows.some(p=>p.id===r.id))throw new Error('Linha inválida ou repetida.');ids.add(r.id);return {id:r.id,good:number(r.good,'Peças boas',{integer:true}),rejected:number(r.rejected,'Peças rejeitadas',{integer:true})};});
 const meters=raw.meters===undefined||raw.meters===''?0:number(raw.meters,'Metragem processada',{min:.001,max:100000});
 if(!rows.some(r=>r.good+r.rejected>0))throw new Error('Informe ao menos uma peça cortada.');
 const before=summary(job);for(const r of rows){const line=before.rows.find(x=>x.id===r.id);if(source&&r.good>(source.targets[r.id]||0))throw new Error('Peças boas excedem a meta desta reimpressão.');if(!source&&line.reserved&&r.good>line.available)throw new Error('Há peças reservadas em reimpressão. Selecione esse lote ou cancele a solicitação.');}
 return {meters,rows,reprintId:source?.id||null,notes:String(raw.notes||'').slice(0,1000)};
}
export function reprintTargets(job){if(job.status==='draft')throw new Error('Libere a grade primeiro.');const s=summary(job);const targets=Object.fromEntries(s.rows.map(r=>[r.id,r.available]));if(!Object.values(targets).some(n=>n>0))throw new Error('Não há faltas disponíveis; confira as reimpressões já abertas.');if(!job.measurements.length)throw new Error('Registre a contagem do corte antes de solicitar reimpressão.');return targets;}

